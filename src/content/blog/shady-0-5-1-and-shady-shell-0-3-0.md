---
title: "Shady 0.5.1 and shady-shell 0.3.0: A More Comfortable Desktop"
description: "A layer-order fix for Shady, and a new collection of desktop tools and visual building blocks for shady-shell."
pubDate: 2026-11-15
heroImage: "../../assets/nixchan/nixchan-release-party-01.png"
---

**[Shady 0.5.1](https://github.com/gloaming-dusk/shady/releases/tag/v0.5.1)** and **[shady-shell 0.3.0](https://github.com/gloaming-dusk/shady-shell/releases/tag/v0.3.0)** are out. One fixes a small but important compositor problem; the other brings a much larger set of tools for building and using a desktop.

## Layers in the right order

Outside spatial mode, a top-layer surface could end up above an overlay surface if it mapped later, covering the overlay and taking its clicks. Shady 0.5.1 keeps layer-shell surfaces in their intended layer order regardless of mapping order. It also lets the automation probe run on the overlay layer.

## A shell with more to do

shady-shell 0.3.0 adds a configurable dock: pin and unpin applications, drag them into order, and use a menu for window actions. Its screenshot picker can select a region, a window or a screen, saving pictures to `~/Pictures/Screenshots` and copying them to the clipboard without requiring grim or wl-copy.

The shell can serve and read clipboard text and images. A clipboard history panel keeps copies across restarts, with pins for things worth keeping. Settings brings wallpaper thumbnails, dock pins, clipboard history and quiet hours together with appearance, window and input controls.

There are smaller everyday fixes too. A popup configured to close on blur now closes when focus leaves it, including a click on the desktop or a window, while bars and docks keep their clicks.

## Building a look

For rice authors, there are press styles, pop, jelly and clack springs, text outlines and shadows, plus modules for things like machine controls, notifications and the calendar. Meridian is the shell's default interface; other rices can build their own look using the shared tools.

A wallpaper manager can switch pictures with a cross-fade and remember the choice. These are tools for making a desktop feel like yours, not a promise that every rice uses every feature in the same way.

## A little release party

Nixchan and Yoi made [a four-page comic](/comics/nixchan-yoi-release-party/) about the two releases. The blue gift is the compositor; the purple one is the shell. Yoi may have taken the word “shell” a little too literally.

The full details are in the [Shady 0.5.1 release notes](https://github.com/gloaming-dusk/shady/releases/tag/v0.5.1) and the [shady-shell 0.3.0 release notes](https://github.com/gloaming-dusk/shady-shell/releases/tag/v0.3.0).
