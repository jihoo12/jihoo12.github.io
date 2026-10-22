---
title: "Shady: Rethinking the Linux Desktop"
description: "Building an experimental Linux desktop from the compositor up: custom shells, visual themes, Lua scripting, native plugins, and windows that can live in 3D."
pubDate: 2026-10-22
updatedDate: 2026-10-22
---

A desktop environment is something we interact with all day, yet so much of its design is taken for granted. There's a wallpaper, a panel, a launcher, and windows that behave in more or less the same way everywhere.

I started building **[Shady](https://github.com/gloaming-dusk/shady)** because I wanted to question more than just how windows are drawn. What if the compositor, the desktop shell, and the visual identity of the entire session could all be part of the experiment?

Shady is my open-source Linux desktop project, built around an experimental Wayland compositor in C, a separate configurable shell, several distinct desktop themes, and a system for extending behavior through Lua and native plugins. Yes, windows can become 3D objects—but that's only one part of it.

![Horizon, Shady's default desktop experience](https://raw.githubusercontent.com/gloaming-dusk/shady/main/rices/horizon/preview.jpg)

## More than a window manager

Shady is made of several pieces that work together:

- **`shady`**, the Wayland compositor, manages windows, input, workspaces, outputs, and rendering.
- **`shady-shell`**, a separate layer-shell client, provides the interface: launchers, panels, notifications, Quick Settings, and more.
- **Rices** pair a desktop appearance with its shell configuration and behavior.
- **Lua configuration and scripting** let the desktop change without rebuilding everything.
- **C plugins** add effects, window motion, representations, and new spatial interactions.
- **NixOS integration and development tools** make the whole system easier to run, build, and test.

I like this separation because the interesting part of a desktop isn't only its renderer. It's how all these pieces fit together into an experience.

## Horizon: a desktop that lives in the sky

Horizon is Shady's default rice, and it's probably the clearest example of what I'm trying to create.

It doesn't start with a conventional taskbar. Instead, the time appears directly in a procedural sky. Workspaces show up as lights along the horizon, with their open windows reflected in the sea. Notifications arrive as text against the sky.

The application launcher turns installed applications into stars: typing a name highlights matching stars and draws them together into a constellation. Quick Settings appears as a frosted-glass control center, with controls for the sky's hour alongside familiar desktop settings.

It's still a desktop. I can launch applications, change workspaces, read notifications, and manage windows. I just wanted those actions to feel like they belonged to the world on screen.

The scene changes between golden hour, afterglow, blue hour, and night. Pressing **`Super+T`** moves the sky to the next hour, and the shell's palette follows it.

## One compositor, four different worlds

I didn't want Shady to be locked into a single look. Its rices explore how much personality a desktop can have while sharing the same underlying system.

### Horizon

The default experience: a sky-based interface, horizon workspaces, a constellation launcher, and a glass control center.

### Objects

![Objects desktop theme](https://raw.githubusercontent.com/gloaming-dusk/shady/main/rices/objects/preview.jpg)

A playful world of ink-outlined cards, a paper-sunset backdrop, a desk clock, a dock, and a launcher that fans applications out like cards in your hand.

### Afterglow

![Afterglow desktop theme](https://raw.githubusercontent.com/gloaming-dusk/shady/main/rices/afterglow/preview.jpg)

An open sea at sunset, with a translucent shell that changes alongside the sky. It leans into atmosphere and time rather than the usual static wallpaper.

### Neon Transit

![Neon Transit desktop theme](https://raw.githubusercontent.com/gloaming-dusk/shady/main/rices/neon-transit/preview.jpg)

A darker, futuristic environment with a violet horizon, cyan grid, and optional spatial window effects.

These aren't four separate compositors. They're different answers to the same question: **what should a Linux desktop feel like?**

## The shell is programmable

One design choice I care about is keeping the desktop shell separate from the compositor.

`shady-shell` is a Wayland client of its own. Its interface is defined in Lua rather than being permanently built into the compositor. Rices can bring their own bars, panels, menus, launchers, notifications, and appearance.

Lua 5.4 also powers Shady's configuration (`config.lua`) and runtime scripting (`init.lua`). It lets me experiment with both how the desktop looks and how it behaves.

For external automation and tools, Shady exposes an IPC socket and a command-line interface called **`shadyctl`**. The shell and compositor also communicate through a dedicated Wayland protocol.

This matters to me because I want new ideas to be cheap to try. Redesigning a launcher or changing a theme shouldn't require rebuilding the entire desktop architecture.

## It still needs to work as a desktop

Visual experiments are fun, but a compositor also has to deal with the unglamorous details of running real applications.

Shady supports everyday Wayland desktop features including input methods (such as Hangul input), fractional scaling, window and workspace protocols, clipboard tooling, session locking, screencopy, and output management. Other shells and bars can also interact with it through standard protocols.

There is a **2D safe mode** based on wlroots' scene graph. It skips 3D rendering, physics, and effects, giving the project a conventional compatibility baseline. Both rendering paths are demand-driven rather than redrawing an idle desktop continuously.

The repository includes ASan/UBSan regression testing for the 2D and 3D paths, as well as NixOS VM tests for the session and greeter.

These details aren't as screenshot-friendly as a beautiful sunset, but they are an important part of turning a graphics idea into a usable desktop system.

## And yes, the windows can break the rules

Shady also asks what happens when a window stops being just a flat rectangle.

Built on **wlroots 0.20.2** and inspired by TinyWL, its compositor can render ordinary application surfaces in a perspective 3D world through a custom OpenGL ES 2.0 renderer.

Windows can move through depth, wobble, respond to gravity, collide with environments, or be picked up and thrown in first-person mode. Plugins can give them alternative bodies such as cubes, jelly, folded paper, and origami.

Other plugins explore different interactions:

- **Water Windows** adds waves, refraction, and caustics.
- **Magnetic Windows** connects nearby windows with springs.
- **Window Constellation** makes windows orbit the focused one.
- **Window Portal** provides a live view into another window.
- **Frozen Window** grows frost across a window or workspace.
- **Black Hole** sends windows into a black hole and returns them through a white hole.

I don't expect every one of these ideas to become a normal desktop feature. Exploring them is part of the point.

## An architecture built for experiments

A recurring challenge in Shady is deciding what belongs in the core and what belongs outside it.

The compositor core owns Wayland objects, input routing, window lifetimes, GPU resources, and validation. Optional behaviors can live in **native C plugins** through a public API, with supported hot reload and state migration. The rendering system consumes validated representations rather than relying on private plugin data layouts.

That boundary makes it possible to develop new behaviors without endlessly expanding the compositor itself.

It's also why Shady has become a project about much more than graphics: I'm learning about protocol design, memory and resource ownership, plugin interfaces, testing, UI systems, and all the compromises involved in desktop software.

## Try it yourself

If you already have a Wayland session and Nix installed, you can launch Shady in a nested window:

~~~sh
nix run github:gloaming-dusk/shady
~~~

That starts the default **Horizon** rice with a terminal. Press **`Super+Shift+/`** to see the available keyboard shortcuts.

To switch to another rice:

~~~sh
SHADY_RICE=objects nix run github:gloaming-dusk/shady
~~~

The repository also has a NixOS module, a Meson-based build path for other Linux distributions, and documentation for configuring and extending the desktop.

See the [getting started guide](https://github.com/gloaming-dusk/shady/blob/main/docs/GETTING_STARTED.md) and the [architecture documentation](https://github.com/gloaming-dusk/shady/blob/main/docs/ARCHITECTURE.md) for more.

## Where Shady goes next

Shady is still an **experimental research compositor**, not a production-ready desktop replacement. Multiple monitors, parts of first-person interaction, environment collisions, and rendering polish remain active areas of development.

For me, the interesting question isn't simply whether Linux can have 3D windows. It's how much freedom there is to rethink the entire desktop—from the protocols underneath to the smallest detail in the shell.

**Shady is where I get to explore that question, one experiment at a time.**

**Source code:** [github.com/gloaming-dusk/shady](https://github.com/gloaming-dusk/shady)  
**Project website:** [gloaming-dusk.github.io/shady](https://gloaming-dusk.github.io/shady/)
