---
title: Horn
tagline: A small Rust checker for explicit derivation certificates in first-order Horn theories.
language: Rust
tags: [proof-checking, cubical, agda]
repo: https://github.com/jihoo12/Horn
featured: true
order: 3
---

The caller supplies the theory and the goals; the certificate supplies rule applications. Predicate names have no built-in meaning, so cubical type theory and univalence are just theory data on top of a generic kernel.

- Oracle certificates: a 4.07 GB proof becomes a 63,890-byte oracle, checked in 3.5 s
- Addition on unary naturals, transported along `ua (nat ≃ bin)`, computes `3 + 2` on binary numbers in one checked certificate
- The checking algorithm is modelled and proved sound in Agda
