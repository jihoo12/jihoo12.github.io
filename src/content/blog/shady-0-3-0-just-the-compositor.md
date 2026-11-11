---
title: "Shady 0.3.0: Just the Compositor"
description: "Shady 0.3.0 splits the shell, greeter and rices into repositories of their own, so Shady is now only the compositor, and it still works without a shell."
pubDate: 2026-11-11
heroImage: "../../assets/nixchan/nixchan-release-party-01.png"
---

**[Shady 0.3.0](https://github.com/gloaming-dusk/shady) is out.** In [my first post about Shady](/blog/shady-a-3d-wayland-compositor/), one repository held a compositor, a shell, a login screen, several rices and a lot of plugins. That has changed over the last two releases. With 0.3.0, Shady is **only the compositor**.

![Tide as Gloam ships it: Shady's scrolling columns and keys, under shady-shell's glass bar](https://raw.githubusercontent.com/gloaming-dusk/gloam/main/rices/tide/preview.jpg)

## Why split it up

A compositor, a shell and a theme change at different speeds and for different reasons. When they all lived in one repository, a small change to a launcher meant a release of the whole desktop, and the compositor's build carried a shell, an authentication helper and a greeter that not everyone wanted.

So in 0.3.0 those pieces moved out, **with their history**, to repositories of their own:

| | |
|---|---|
| [shady-shell](https://github.com/gloaming-dusk/shady-shell) | the Lua-scripted shell, its plugin header and the `shady-shell-v1` protocol |
| [shady-greeter](https://github.com/gloaming-dusk/shady-greeter) | the greetd login screen |
| [Gloam](https://github.com/gloaming-dusk/gloam) | the whole desktop: Shady, the shell, Tide's look, the greeter, services and applications |
| [Afterglow](https://github.com/gloaming-dusk/shady-rice-afterglow), [Horizon](https://github.com/gloaming-dusk/shady-rice-horizon) | rices, next to Objects and Neon Transit, which moved out in 0.2.0 |

Shady keeps what is really the compositor's: the renderer, its C plugin API and headers, `shadyctl`, the session scripts, and the compositor side of **Tide**, which has been the default since 0.2.0.

That gives two ways to try it:

~~~sh
nix run github:gloaming-dusk/shady   # the compositor, Tide's layout and keys, a terminal
nix run github:gloaming-dusk/gloam   # the whole desktop, with its shell
~~~

(The `SHADY_RICE=objects` command from my first post no longer works. Objects runs from [its own repository](https://github.com/gloaming-dusk/shady-rice-objects) now.)

## A compositor that works on its own

Splitting the shell out raised a question: what should happen when no shell is running? A compositor that only works with its own shell hasn't really been separated from it.

In 0.3.0, Tide's keys work either way. Shady can now tell whether a shell is listening (`shady.shell_connected()`), and when none is, it falls back on what it can do itself or on the usual tools:

- the launcher uses `fuzzel`, `wofi`, `tofi` or `bemenu`
- locking uses `swaylock`
- volume and brightness use `wpctl`/`pactl` and `brightnessctl`
- media keys use `playerctl`
- **`Print`** saves the whole screen to `~/Pictures` with Shady's own `shady.screenshot()`, with no rice needed
- **`Super+Shift+/`** shows a **shortcut overlay that Shady draws itself**. Escape, a click or the same keys close it.

So the bare `nix run github:gloaming-dusk/shady` is a usable desktop, not only a demo.

## Rices from anywhere

Since rices are now separate packages, Shady needed a way to find them. It looks for each rice **file by file** in `$SHADY_RICE_PATH`, `$XDG_DATA_HOME/shady/rices`, `$SHADY_ROOT/rices` and `$XDG_DATA_DIRS/shady/rices`, so one rice can be put together from several packages. `shady-session` and `shady-rice` look them up the same way.

On NixOS, `programs.shady.rices` installs rice packages, and the greeter and lock-screen options moved to the modules they belong to, `services.shady-greeter` and `programs.shady-shell`. Gloam turns them on for you.

Shady also starts `shady-shell` from `$SHADY_SHELL_BIN` or `PATH`, not only from the file next to its own binary, because the two are no longer installed together.

## Fixes

A few bugs I'm glad are gone:

- **The overview and maximized windows.** Maximized and fullscreen windows stayed flat on the screen in the overview and covered it, instead of pulling back with the others. Chromium-based browsers start maximized if they were last time, so this came up a lot.
- **Super taps and input methods.** With fcitx5 and a focused text field, such as a browser's address bar, keys the input method sent back through its virtual keyboard counted as part of a Super tap and could cancel it. They no longer do.
- **`shady.automation.after(0, fn)` never ran.** A 0 ms Wayland timer is a disarmed timer, so the callback never ran and the timer leaked. It now runs on the next pass of the event loop.
- **Lua windows have an `id`.** It's the same id that IPC and the shell protocol use, so the `shadyctl lua` example that returns `{id = w.id, ...}` finally returns something.

## What's next

Shady is still an experimental compositor, and the 3D side, with its cubes, physics and first-person mode, is still there. But now it has a cleaner line around it, and I think that will make the next experiments easier.

The full list of changes is in the [changelog](https://github.com/gloaming-dusk/shady/blob/main/CHANGELOG.md).

**Source code:** [github.com/gloaming-dusk/shady](https://github.com/gloaming-dusk/shady)  
**The whole desktop:** [github.com/gloaming-dusk/gloam](https://github.com/gloaming-dusk/gloam)
