# Making a game with Nixchan

Anyone can add a game to this site. A game is a folder in `src/games/`. Open a pull request that
adds one, and once it's merged the game gets its own page at `/games/<id>/` and a portal in
[the gallery](https://jihoo12.github.io/gallery/), where Nixchan can walk into it.

You don't need to know three.js, or this site. Games are made with **Nixkit** (`src/lib/nixkit/`),
which already has Nixchan, how she walks, runs, jumps and glides, the camera, keyboard and touch
controls, and blocks to build with. Vibe coding is welcome: point your AI assistant at this file
(there's a prompt for it [below](#for-ai-assistants)).

> **한국어 요약**: `src/games/_template/`을 `src/games/<게임-id>/`로 복사하고, `meta.ts`(제목, 만든
> 사람, 색)와 `game.ts`(게임)를 고친 다음 PR을 보내면 돼요. 그 폴더 밖의 파일은 건드리지 않아도
> 돼요. 머지되면 `/games/<id>/` 페이지와 갤러리 포털이 자동으로 생겨요. AI로 만든다면 아래
> [For AI assistants](#for-ai-assistants)의 프롬프트를 그대로 붙여넣으세요.

## Quick start

```sh
git clone https://github.com/jihoo12/jihoo12.github.io
cd jihoo12.github.io
npm ci
cp -r src/games/_template src/games/my-game   # your game's id: lower case, numbers, dashes
npx astro dev                                 # then open http://localhost:4321/games/my-game/
```

1. Fill in `src/games/my-game/meta.ts`: the title, a few words for the portal, a description, your
   name and GitHub username, the portal's two colours, and today's date.
2. Make the game in `src/games/my-game/game.ts`. The template is a tiny game to start from.
   `src/games/cloudhop/` is a bigger one.
3. Run `npm run check:games` and `npm run build`. Both should pass.
4. Open a pull request. One game per pull request, please.

## How a game works

`game.ts` exports one function. It's given `createGame`, which sets up Nixchan, the camera, the
controls and the HUD, and `store`, for remembering things between visits.

```ts
import * as THREE from 'three';
import type { GameContext } from '../../lib/nixkit/meta';

export default function start({ createGame, store }: GameContext) {
	const game = createGame({ spawn: { pos: new THREE.Vector3(0, 0, 0), heading: 0 } });
	if (!game) return; // no WebGL: the page says so

	game.parts.add({ at: [0, -0.5, 0], size: [8, 1, 8] });                                   // somewhere to stand
	game.parts.add({ at: [0, -0.5, 9], size: [3, 1, 3], move: { by: [6, 0, 0], period: 4 } }); // a moving platform
	game.parts.add({ at: [0, -0.5, 14], size: [3, 1, 3], kill: true });                       // lava

	game.onUpdate((dt, time) => {
		// your rules, every frame
	});
	game.start();
}
```

The world is built out of **parts**: boxes and cylinders that can move, carry her, bounce her,
vanish, kill, act as checkpoints, or call your code when she touches them. There are **pickups**
(gems), **portals**, **clouds**, and a **HUD** for counters, banners, toasts and buttons. You can
also add anything three.js can draw to `game.scene`. All of it is described in
[`src/lib/nixkit/README.md`](src/lib/nixkit/README.md).

Sizes, for laying things out: Nixchan is about 1.7 m tall. She jumps about 1.4 m up, and 4 to 5 m
across at a run (2 m at a walk). Up is +y, and she starts facing +z.

## The rules

A game is code that runs on this site, so it has to stay inside its own folder.
`npm run check:games` checks the rules (and so does every pull request), but a person still reads
every game before it's merged.

- **Only touch `src/games/<your-id>/`.** The page, the portal and the credit all come from
  `meta.ts`. If you think the kit itself needs something, say so in the pull request, or open a
  separate one for it.
- **Import only from your own folder, from `src/lib/nixkit/`, and from `three`** (including
  `three/examples/jsm/...`). No other packages.
- **Nothing from outside the site.** No `fetch`, no network connections, no links to other sites
  in code. Models, pictures and sounds go in your folder (`.glb`, `.png`, `.jpg`, `.webp`, `.json`,
  `.mp3`, `.ogg`): up to 2 MB a file, and 6 MB for the whole game.
- **Remember things with `store`**, never `localStorage` or cookies. `store` keeps your game's
  saves apart from everyone else's (and from Nixchan's island).
- **No `eval`, `new Function`, dynamic `import()`, workers or `innerHTML`.** Show text with the HUD
  (`game.hud`) or `textContent`.
- **Don't navigate away.** The Gallery button is the way out.
- **Keep it kind.** Nixchan is a cheerful character on a personal website: nothing violent, scary,
  hateful or adult, and nothing that pretends to be someone else.
- **It's yours, and open.** Your game is shared under the same licence as the site's code (Apache
  2.0, `LICENSE`). Nixchan, her model and the island's art are CC BY 4.0 (`LICENSE-ARTWORK`). If
  you add art you didn't make, it has to allow this, and say where it's from in a comment.

## What happens to your pull request

The checks run: the game rules and a build of the site. Then it's played, and the code read. Small
changes may be asked for. Once it's merged, your game is live at `/games/<id>/`, with a portal in
the gallery that says it's by you.

## For AI assistants

If you're an AI helping someone make a game, here's what to do. People can paste this prompt:

```text
Read CONTRIBUTING.md and src/lib/nixkit/README.md in this repository, then make a new Nixchan
game by copying src/games/_template/ to src/games/<id>/. Only create or change files inside that
folder. Follow the rules in CONTRIBUTING.md exactly. Use src/games/cloudhop/ as an example.
When it's done, run `npm run check:games` and `npm run build` and fix anything they report.
The game I want: <describe your game here>
```

Notes for the assistant:

- Everything goes in `src/games/<id>/`. Don't edit the kit, the gallery, pages, `package.json` or
  anything else. The page and portal are generated from `meta.ts`.
- `game.ts` default-exports `start({ createGame, store })`. Call `createGame(...)`, build the world
  with `game.parts`, register rules with `game.onUpdate`, and finish with `game.start()`.
- Parts are positioned by their middle: a slab with its top at height `t` has `at[1] = t - h / 2`.
  Keep gaps jumpable (see the sizes above). Without a glider (`canGlide`), she can't cross more
  than about 5 m.
- Use `store.get` / `store.set` for saving, and the HUD (`hud.stat`, `hud.banner`, `hud.toast`,
  `hud.button`) for anything on the screen.
- Run `npm run check:games` and `npm run build`, and fix what they report, before saying it's done.
