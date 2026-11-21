---
title: "Introducing ASL: What If Types Were Spaces?"
description: "Why would a language reject a function that swaps two points? An introduction to ASL, where types are finite topological spaces."
pubDate: 2026-11-21
---

I built the first interpreter for **[ASL (Alexandrov Section Lambda)](https://github.com/jihoo12/asl)**. In ASL, types are finite topological spaces and functions between them are continuous. Two points are enough to see what changes.

## The function that cannot swap two points

ASL's built-in type `S` has two points, `lo` and `hi`, with `lo < hi`. In the Alexandrov topology ASL uses, continuity means preserving that order: if `x ≤ y`, then `f(x) ≤ f(y)`.

That leaves exactly three functions of type `S -> S`: always return `lo`, always return `hi`, or return the input. You can write down a table that swaps the two points, but the interpreter rejects it because it reverses the order. **The relationships between values** matter just as much as which values belong to the type.

## When the pieces work but the whole does not

In ASL, you can write a function separately on small open parts of a space, then join the pieces with `sew`. The pieces must cover the whole space, and they must give the same answer at every point they share.

The [triangle example](https://github.com/jihoo12/asl/blob/bec5a5e9d3b9d35c474478ad6ebb996808f9e816/examples/descent.asl) uses this to rotate the triangle's boundary one step. In the [double-cover example](https://github.com/jihoo12/asl/blob/bec5a5e9d3b9d35c474478ad6ebb996808f9e816/examples/rejected/double-cover.asl), each piece is valid on its own. But when you go around the triangle to the last overlap, the two pieces give different answers, so `sew` fails. It is a small program that shows the difference between what works locally and what works globally.

## What you can try now

The Rust interpreter supports lambdas, function application, restriction and gluing. `betti` computes Betti numbers of finite spaces. `homotopy` checks whether two maps can be connected by steps where, at each step, their outputs move in the same direction at every input.

The computations are finite, but the space of possible functions grows quickly as you add points. For now the interpreter is a place to build small spaces and try things out. From the repository root, you can run the triangle example:

```sh
nix run path:. -- examples/descent.asl
```
