---
title: "Introducing Jihoo2: Jihoo Without Dependent Types"
description: "Jihoo2 keeps ownership, borrow checking, and the LLVM backend while leaving out the experimental dependent core."
pubDate: 2026-11-23
---

[Jihoo2](https://github.com/jihoo-language/jihoo2) is a separate version of [Jihoo](https://github.com/jihoo-language/jihoo) without its experimental dependent type system. It keeps the part I want to explore further: how much a systems language can do with ownership and scoped borrows, without lifetime annotations or a garbage collector.

## What changed

Jihoo2 leaves out `#![dependent_core]` modules, the `jihoo core` command, `.jhc` files, the dependent libraries, and the Lean proofs for that core. That does not mean it drops verification altogether: the compiler still checks contracts over MIR, its intermediate representation. Ordinary compile-time generics also remain.

## What stays

The compiler still checks moves and borrows. A function can borrow a value, borrow it mutably with `inout`, or take ownership with `sink`. For example, the following code is rejected because the loop is borrowing the vector while `push` tries to change it:

```jihoo
fn main() {
    var v = Vec(i64).new()
    v.push(1)
    for x in v {
        v.push(x)
    }
}
```

The compiler is still written in Jihoo and builds native programs through LLVM. If you have Nix and a `hello.jh` file, you can try it with:

```sh
nix run github:jihoo-language/jihoo2 -- run hello.jh
```

[Browse the source](https://github.com/jihoo-language/jihoo2) · [Read the documentation](https://jihoo-language.github.io/jihoo2/)
