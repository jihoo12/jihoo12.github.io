---
title: "Shady: Building a 3D Wayland Compositor"
description: "My experiment in turning ordinary Linux windows into a spatial desktop, with wlroots, OpenGL ES, physics, Lua, and a plugin system."
pubDate: 2026-10-22
---

Most desktop environments treat windows as flat rectangles. We can move them, resize them, and arrange them in workspaces, but the underlying metaphor has barely changed in decades.

I wanted to explore a different question: **what if application windows were objects in a shared 3D world?**

That's the idea behind [Shady](https://github.com/gloaming-dusk/shady), an experimental Wayland compositor I've been building in C with wlroots and OpenGL ES 2.0. It can behave like an ordinary desktop compositor, or it can give windows depth, movement, physics, and unexpected interactions.

![Horizon, Shady's default desktop theme](https://raw.githubusercontent.com/gloaming-dusk/shady/main/rices/horizon/preview.jpg)

## A desktop with depth

Shady began with the foundations of a Wayland compositor, inspired by TinyWL and built on **wlroots 0.20.2**. The traditional rendering path uses wlroots' scene graph. On top of that, I built a custom GLES2 renderer that places application surfaces into a perspective 3D scene.

That second path changes what a window can be. Windows can move forward and backward in space, become cubes or folded shapes, respond to motion, and interact with other objects. There's even a first-person mode for exploring environments and picking up or throwing windows.

The goal isn't to make every desktop interaction three-dimensional. It's to experiment with what becomes possible when depth is part of the window manager instead of just a visual trick.

## Making windows behave differently

Some of my favorite experiments are implemented as plugins:

- **Spatial Overview (`Super+O`)** arranges the workspace's windows in a 3D overview.
- **Water Windows (`Super+W`)** adds waves, refraction, and caustic effects to window surfaces.
- **Magnetic Windows (`Super+M`)** connects nearby windows with spring-like motion.
- **Window Constellation (`Super+C`)** makes other windows orbit the focused one.
- **Frozen Window (`Super+Z`)** lets frost spread across a window.
- **Window Portal (`Super+P`)** creates a live portal to another window.
- **Black Hole (`Super+H`)** sends windows into a black hole before bringing them back.

The project also explores alternate window bodies, including jelly, cubes, folded paper, and origami. Rendering, picking, and collision are designed to agree on the shape a plugin provides.

These features make Shady feel more like a graphics experiment than a conventional tiling or stacking window manager, which is exactly why I find it interesting.

## The shell is part of the experiment

A compositor isn't the whole desktop. Shady includes **shady-shell**, a separate layer-shell application for launchers, panels, notifications, and other interface elements.

Instead of hard-coding one visual identity, Shady provides several *rices*—combinations of a shell and a desktop aesthetic:

- **Horizon**, the default, places a clock, workspace indicators, notifications, and a constellation-style launcher in a procedural sky. Its frosted-glass control center is positioned in 3D.
- **Objects** uses bold, outlined cards and playful desktop objects.
- **Afterglow** creates a sunset sky and sea, with changing hours and a translucent interface.
- **Neon Transit** explores a darker, grid-based visual world with optional spatial effects.

![Neon Transit, an alternate Shady desktop theme](https://raw.githubusercontent.com/gloaming-dusk/shady/main/rices/neon-transit/preview.jpg)

Horizon is especially fun to work on. Rather than placing the familiar taskbar at the edge of the screen, it lets workspaces become lights on the horizon and applications become stars in the launcher.

## Why plugins and Lua matter

I don't want every new visual idea to require rewriting the compositor core. Shady has a **public C plugin API** for extending behavior, plus hot reloading and state migration for supported plugins.

The core remains responsible for things like window lifetimes, input routing, GPU resources, and validating data across plugin boundaries. Effects and simulations can live outside it.

Lua 5.4 handles configuration and scripting, including the shell's interface. There is also an IPC interface and the `shadyctl` command-line tool for communicating with a running session.

The architectural challenge is as interesting to me as the rendering: how do you make a highly experimental compositor extensible without giving up clear ownership and predictable behavior?

## Trying Shady

The easiest way to try it from an existing Wayland session is with Nix:

~~~sh
nix run github:gloaming-dusk/shady
~~~

That launches the default **Horizon** experience in a nested window with a terminal. Press **`Super+Shift+/`** to open the current shortcut guide.

To try the Objects rice instead:

~~~sh
SHADY_RICE=objects nix run github:gloaming-dusk/shady
~~~

For development, the repository includes a Nix flake, a Meson build, NixOS integration, and instructions for building without Nix. A plain **`--safe`** mode provides a conventional 2D scene-graph path.

Start with the [getting started guide](https://github.com/gloaming-dusk/shady/blob/main/docs/GETTING_STARTED.md) if you want to explore the controls, installation options, or configuration.

## Still an experiment

Shady is a **research compositor**, not a polished replacement for a production desktop. Multi-output behavior, some first-person interactions, environment collision, and rendering details are still areas of active work.

That is also what makes it exciting. A Wayland compositor brings together systems programming, graphics, input, protocol handling, resource ownership, and user-interface design. It's a place where a small idea—like giving a window gravity—can turn into an interesting engineering problem.

I'm building Shady because I want to see how far the desktop metaphor can be pushed.

**Explore the code:** [github.com/gloaming-dusk/shady](https://github.com/gloaming-dusk/shady)  
**Project website:** [gloaming-dusk.github.io/shady](https://gloaming-dusk.github.io/shady/)
