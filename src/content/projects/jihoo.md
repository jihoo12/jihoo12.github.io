---
title: jihoo
tagline: A systems language as fast as C, memory-safe without lifetimes or a garbage collector.
language: Rust
tags: [compiler, llvm, ownership]
repo: https://github.com/jihoolang/jihoo
links:
  - { label: Docs, href: 'https://jihoolang.github.io/jihoo/' }
featured: true
order: 1
---

Every value has one owner; parameters borrow (`x: T`), borrow mutably (`inout x: T`) or take (`sink x: T`). Borrows never escape a function body, so there are no lifetime annotations, and a small borrow kernel re-checks everything the rest of the compiler decided.

- **native**: compiled through LLVM, linked with libc, calls C directly
- **freestanding**: no libc, raw syscalls, tiny static binaries
