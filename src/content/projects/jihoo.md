---
title: jihoo
tagline: An easy programming language with three profiles.
language: Rust
tags: [compiler, llvm, vm]
repo: https://github.com/jihoolang/jihoo
links:
  - { label: Docs, href: 'https://jihoolang.github.io/jihoo/' }
featured: true
order: 1
---

One language, three ways to run it. All three share one intermediate representation, JIR.

- **native**: no GC, compiled through LLVM and linked with libc, calls C directly
- **hosted**: runs on a register VM with a garbage collector
- **freestanding**: no GC, no libc, raw syscalls, tiny static binaries
