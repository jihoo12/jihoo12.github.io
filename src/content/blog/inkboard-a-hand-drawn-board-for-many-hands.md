---
title: "Inkboard: A Hand-Drawn Board for Many Hands"
description: "A collaborative whiteboard that sketches like Excalidraw, tidies like Figma, and syncs in real time on Cloudflare Workers, Durable Objects and D1, with one merge rule shared by browser and server."
pubDate: 2026-11-03
heroImage: "../../assets/nixchan/nixchan-whiteboard-01.png"
---

I like whiteboards that look hand-drawn. A wobbly rectangle says "this is a sketch, argue with it" in a way a perfect one doesn't. I also like the tools that make a mess look tidy: smart guides, snapping, align and distribute. And I want both while other people are drawing on the same board.

**[Inkboard](https://github.com/jihoo12/board)** is that board. You draw rough shapes, arrows that stick to them, freehand ink, sticky notes, images, frames and LaTeX formulas on an infinite canvas, and everyone with the link sees each change as it happens, along with each other's cursors and selections.

It runs entirely on Cloudflare: a Worker serves the app and the API, **one Durable Object per board** holds the live state and relays edits, and D1 stores users, boards and images. The whole thing is about 5,700 lines of TypeScript, and the editor engine doesn't depend on React.

This post is about the parts that turned out to matter: how edits merge, where they're stored, why the wobbles look the same on every screen, and what it took to run all of it on NixOS.

## What's on the board

- **Shapes**: rectangle, diamond, ellipse, line, arrow, pen, text, sticky note, image and frame.
- **Sketchy style** with [roughjs](https://roughjs.com/): a roughness slider, hachure, cross-hatch or solid fills, and solid, dashed or dotted strokes.
- **Arrows that bind**: start or end an arrow on a shape and it stays attached when the shape moves. Drag the midpoint to add a bend, or switch the arrow to a curve.
- **Tidying**: smart guides, grid snap, align and distribute, groups, locking, layer order, and frames that carry their contents along.
- **Text** inside shapes and sticky notes, with wrapping that works for Korean, and hand-drawn, sans or monospace fonts.
- **Math**: press `M` and type TeX, or paste `$...$` and `$$...$$` text.
- **Real-time collaboration**: live cursors, selections and a laser pointer. Click someone's avatar to jump to where they are.
- **Sharing**: private, view by link (no login needed), or edit by link (login required), with invite-only login on top.
- And the rest you'd expect: undo and redo, copy and paste (including pasting or dropping images), Alt-drag to duplicate, PNG and JSON export, dark mode, templates and dashboard thumbnails.

## One flat element

Everything on the board is the same type:

```ts
interface El {
  id: string;
  type: "rectangle" | "ellipse" | "diamond" | "line" | "arrow"
      | "freedraw" | "text" | "sticky" | "image" | "frame";
  x: number; y: number; w: number; h: number;
  strokeColor: string; fillColor: string; roughness: number; /* ... */
  seed: number;     // the shape's wobble
  version: number;  // incremented on every change
  nonce: number;    // random tie-breaker
  z: number;        // paint order
  isDeleted?: boolean;
  // optional per-type fields: text, points, startBind, endBind, assetId, ...
}
```

There are no nested trees and no per-type classes, just one record with optional fields. Groups are a `groupId`, frames are elements, and arrows point at shapes by id. That keeps the sync protocol tiny, because the unit of change is always "here is the new version of element X". Deleting is a change too: `isDeleted: true` is a tombstone that syncs like any other edit.

## The merge rule

Two people drag the same rectangle at once. Who wins?

Inkboard doesn't use a CRDT or operational transforms. Each element is a last-writer-wins register, ordered by a version number:

```ts
export function shouldReplace(existing: El | undefined, incoming: El): boolean {
  if (!existing) return true;
  if (incoming.version > existing.version) return true;
  if (incoming.version === existing.version && incoming.nonce < existing.nonce) return true;
  return false;
}
```

Every local edit sets `version` to the old version plus one and picks a fresh random `nonce`. A higher version wins. If two clients bump the same element to the same version, the lower nonce wins, and because both sides compare the same two numbers, **everyone picks the same winner without talking to each other**.

The important part is that this function lives in `shared/types.ts` and is imported by both the browser and the Durable Object. There's exactly one definition of "newer", so the server and clients can't drift apart on it.

It's coarse on purpose. If you recolor a shape while I move it, one of those edits is lost, because the unit is the whole element. For a whiteboard that's the right trade. Conflicts on the same shape within the same fraction of a second are rare, the loser sees the result right away, and the rule is ten lines instead of a library.

## One room per board

Each board gets its own Durable Object, `BoardRoom`. Every client opens a WebSocket to it, and it's the single place where edits for that board get ordered.

```
browser ──ws──▶ Worker ──▶ BoardRoom (one per board) ──alarm──▶ D1
browser ──ws──┘                │
                               └─ its own storage: el:<id> for every element
```

The Worker checks the session and the board's share mode, then hands the socket to the room along with who the user is and whether they can edit. The room accepts it with the **WebSocket hibernation API** and stores the peer info in the socket's attachment, so an idle board can be evicted from memory without dropping anyone's connection.

When an `upsert` arrives, the room runs `shouldReplace` on each element. Accepted elements are stored and broadcast to everyone else. Rejected ones are answered too: the room sends the sender **the newer version it lost to**, so a client that was behind catches up right away instead of drawing a state that no longer exists.

Cursors, selections and the laser pointer go through the same socket but are never stored. They're relayed and forgotten.

### Two places to store a board

D1 is where boards live for listing, copying, thumbnails and view-only snapshots. A board is a single row, with its elements as a JSON string in `boards.data`. Writing that row on every pointer move would be wasteful, so the room batches:

1. Every accepted change is written **immediately** into the Durable Object's own storage, one key per element (`el:<id>`).
2. If no alarm is set, the room sets one for **two seconds** later.
3. When the alarm fires, the room writes all live elements into D1 in one `UPDATE`.

If the object is evicted before the alarm runs, nothing is lost, because its own storage already has every element. On the next load the room reads from there (it remembers that it has been "hydrated") rather than from the possibly stale D1 row.

### The client side

The browser's `Sync` class is under a hundred lines. Local changes go into a map keyed by element id and are flushed every 35 ms, so dragging a shape across the screen sends one message per frame or so, and only the latest version of each element. When the socket drops, it reconnects with exponential backoff capped at ten seconds.

Offline edits fall out of the merge rule. While disconnected, edits keep bumping versions locally. On reconnect, the room sends its full state in an `init` message. The client merges it with `shouldReplace` and then **resends every element where its own copy would win**. There's no special offline queue. It's the same comparison run in the other direction.

## Undo is just another edit

Undo in a multiplayer editor is trickier than it looks. If undo simply restores the old element, its version goes *down*, and every other client will reject it as stale.

So Inkboard's history stores `before` and `after` snapshots, and undo applies the snapshot as a **new** edit:

```ts
const target = dir === "undo" ? (it.before ?? { ...it.after, isDeleted: true }) : it.after;
const next = { ...target, version: Math.max(cur?.version ?? 0, target.version) + 1, nonce: randomSeed() };
```

The content goes back in time, but the version goes forward, so the undo wins against whatever is on the server and reaches everyone else. Undoing a creation turns into a deletion, and redo brings the element back the same way.

## Every wobble is a seed

Roughjs draws a rectangle as a pair of slightly shaky strokes, and the shake comes from a random number generator. If each client used its own randomness, the same rectangle would look different on every screen and would jitter every time it was redrawn.

The fix is the `seed` field. It's chosen once when the shape is created and stored on the element, so it syncs like the color does. Every client feeds the same seed into roughjs and gets **the same wobble, stroke for stroke**.

Generating roughjs drawables isn't cheap, so the renderer caches them per element under a key made of everything that affects the shape: type, size, colors, fill, stroke, roughness, seed, roundness and arrowheads. Moving a shape doesn't change the key, so it's a translate and a cache hit. Resizing it regenerates once per new size.

Freehand strokes use [perfect-freehand](https://github.com/steveruizok/perfect-freehand) with simulated pressure, which turns a list of mouse points into a filled outline that thins and thickens like ink. The points are simplified before they're stored, so a long scribble doesn't become a huge element.

## Arrows that hold on

An arrow stores `startBind` and `endBind`, the ids of the shapes it's attached to. Whenever a bound shape moves, the editor finds the arrows that point at it and recomputes their endpoints. Each end goes to the point on the shape's border facing the next point along the arrow, or facing the other shape's center when the arrow is a single segment. The arrow follows the shape around instead of pointing at where it used to be.

Bindings are just ids, so they need care when the ids change. Copy and paste remaps them to the new ids. If an arrow is copied without the shape it was attached to, the binding is cleared, so the pasted arrow doesn't reach back to the original.

Smart guides work the way they do in Figma. While you drag, the left, center and right of the moving box are compared against the left, center and right of every other visible element (and the same for top, middle and bottom). The closest match within six screen pixels wins. The box snaps to it and a guide line is drawn along it. The threshold is divided by the zoom level, so snapping feels the same at any zoom.

## Text, in Korean

Wrapping text in a canvas is your job, not the browser's. Inkboard splits each paragraph on whitespace and measures greedily. Korean usually has spaces between words, so this mostly works. When a single token is wider than the box, as with a long URL or a long run of Hangul without spaces, it falls back to breaking **character by character**, which is how Korean text normally wraps anyway.

Shapes grow to fit their labels. An ellipse needs about 1.42 times the text height and a diamond about 1.8 times, since their usable interior is smaller than their bounding box.

## Formulas on a canvas

Math was added in the second commit, and it was the most fun part. The goal was LaTeX that behaves like any other element: you can move it, resize it, recolor it, export it, and it shows up in thumbnails.

The pipeline:

1. **MathJax** with SVG output turns TeX into an `<svg>`. The option `fontCache: "none"` makes each SVG include its own glyph paths, so it renders standalone with no shared `<defs>`.
2. That SVG is set to `color="..."` and loaded into an `<img>` through a `data:` URL. Glyphs use `currentColor`, so recoloring a formula is just a different cache key.
3. The image is drawn onto the canvas with `drawImage`, scaled from MathJax's units (1000 per em) times the font size.

MathJax is about 2.2 MB, which is too much to load for boards that don't use it. It's loaded with a `?url` import and a script tag **the first time any board element needs a formula**. Until it arrives, formulas keep their previous box, and the canvas repaints when MathJax is ready. PNG export and thumbnails wait on `img.decode()` so formulas never come out blank.

## Who gets in

Login is GitHub or Google OAuth (plus a name-only dev login, which must never be set in production). For a small group, open signup is more than I want, so there's an `ALLOWED_USERS` secret:

```sh
npx wrangler secret put ALLOWED_USERS
# me@gmail.com, github:jihoo12, friend@example.com
```

Entries are either an email address or `provider:login`. A few details mattered more than I expected:

- Email entries are matched only against **verified** emails. GitHub's public profile email isn't necessarily verified, so Inkboard asks the API for the primary verified address, and for Google it checks `email_verified`.
- Uninvited users are rejected **before anything is written**, so trying to log in doesn't leave a row in the database.
- The check runs on every request, not only at login, so removing someone from the list ends their existing sessions too.
- View-only links still work without logging in, which is how you show a board to someone you haven't invited.

Session tokens are stored as SHA-256 hashes, so a leaked database doesn't hand out working cookies.

## NixOS and a binary that wouldn't start

Local development uses the Cloudflare Vite plugin, which runs the real `workerd` runtime. npm downloads a prebuilt `workerd` for generic Linux, and on NixOS it won't start: there's no `/lib64/ld-linux-x86-64.so.2` for it to load.

The fix is a short `postinstall` script. On NixOS only, it finds each `workerd` binary that fails to run and patches it with `patchelf` to use glibc from nixpkgs:

```sh
GLIBC="$(nix eval --raw nixpkgs#glibc.outPath)"
nix shell nixpkgs#patchelf -c patchelf \
  --set-interpreter "$GLIBC/lib/ld-linux-x86-64.so.2" \
  --set-rpath "$GLIBC/lib" "$B"
```

On other systems it exits immediately, and it skips any binary that already runs, so running `npm install` again is safe. It isn't elegant, but it means `npm install && npm run dev` works on my machine the same way it does everywhere else.

## Limits

- Images are stored in D1 as BLOBs. They're downscaled in the browser to at most 1600 px and re-encoded as WebP first, up to about 1.9 MB each. If you use a lot of images, they belong in R2.
- A board is one D1 row of JSON, so very large boards (several MB) will hit limits.
- Shapes can't be rotated yet.
- Merging is per element, so two people editing different properties of the same shape at the same moment keep only one of the edits.

## What I'd keep

The thing I'd do again is the shared merge rule. Once "which version is newer" was one function imported on both sides, the rest followed from it: offline edits, undo, conflict replies and reconnects are all the same comparison used in different places. A Durable Object per board gives that comparison a single place to run, and D1 only has to be eventually up to date.

The thing I'd change first is storage. One JSON row per board was the fastest way to get started, and it will also be the first thing to break when a board gets big.

**Source code:** [github.com/jihoo12/board](https://github.com/jihoo12/board)
