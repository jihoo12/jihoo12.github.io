---
title: "jihoo 0.6.0: Evidence You Can Use"
description: "jihoo 0.6.0 brings dependent programming closer to everyday code: exact-length lists, checked collection bounds, reusable proofs, and native Linux packages for ARM64 and x86_64."
pubDate: 2026-11-13
heroImage: "../../assets/nixchan/nixchan-release-party-01.png"
---

**[jihoo 0.6.0 is out](https://github.com/jihoolang/jihoo/releases/tag/v0.6.0).** This release is about making facts a program already knows useful to the code that comes next.

A loop builds a list with exactly `n` elements. A filter keeps at most that many. A copy needs enough room in its destination. Usually those facts live in the programmer's head, a comment, or another runtime check. In jihoo's dependent modules, they can travel with the values and become checked evidence for the next operation.

0.6.0 makes that style of programming more practical, with better dependent functions and records, reusable natural-number and list proofs, and collections that put those proofs to work. It is a feature, library and stabilization release. The larger goal of proving the whole compiler correct is still ahead.

## A length that survives the next operation

Here is a small example from the [sized-list documentation](https://github.com/jihoolang/jihoo/blob/v0.6.0/docs/language/sized-lists.md):

```text
#![dependent_core]
import dependent.sized_list

fn increment(x: i64) -> i64 { x + 1 }

fn main() -> i64 {
    let xs = sized_list.repeat(3, 17)
    let ys = sized_list.map(3, xs, increment)
    sized_list.nth(3, ys, 2, decide_lt(2, 3))
}
```

The result is `18`. The interesting part is what happens between building the list and reading it. `repeat` returns `Sized(3)`, and `map` returns a new, independently owned `Sized(3)`. The caller supplies evidence that index `2` is below `3`; it does not need to walk the list to rediscover its length before the read. Finding the element still traverses the selected prefix.

The same pattern works with a runtime length `n`. An indexed loop can carry `Sized(k)` after `k` iterations, and its step must produce the next length. Imported structural lemmas let concatenation loops carry their length argument through each step, too. The postcondition is in the result type.

The indices and proofs are erased. The list and its wrapper still allocate, and arithmetic and allocation can still trap. What disappears is the evidence machinery, not the cost of the collection itself.

## From a proof to a useful collection

Exact lengths become more useful when they survive a change of representation. `sized_list.to_buffer(n, xs)` borrows a `Sized(n)` and produces an independently owned `buffer(n)`. Its writer copies the list in one structural pass, using the existing length evidence to establish that the writes fit. It avoids an extra length-discovery traversal and the repeated prefix walks that copying with `nth` would require.

The collection work goes in both directions:

- **Build from bounded indices.** `tabulate` gives each callback an index and evidence that it is in range. Buffer and range conversions use that to construct exact-length lists directly.
- **Keep a runtime-selected result.** Bounded collections retain an upper bound when the number of kept values is only known at runtime, then materialize those values into a vector.
- **Write into existing storage.** Range and capacity evidence lets a structural writer fill a destination while passing its owner through the operation.

These are small connections, but together they make proofs reusable. The caller can establish a bound once, then pass it into an operation that needs it. The libraries check lengths and access bounds; general pointwise content-preservation theorems remain future work. Element order and copy behavior are covered by regression tests.

The [list-to-buffer guide](https://github.com/jihoolang/jihoo/blob/v0.6.0/docs/language/list-buffer-transfer.md) explains the ownership and costs with complete examples.

## Less proof plumbing

Dependent function ergonomics, indexed records, module privacy, annotations and conversion all received attention in 0.6.0. Private fields let a library keep the evidence behind a collection's public interface. Local functions remain restricted; this does not introduce unrestricted closures.

For short equality and ordering arguments, there is also [`auto()`](https://github.com/jihoolang/jihoo/blob/v0.6.0/docs/language/proof-automation.md). Given an expected `Eq` or `Lt` goal, it searches local facts and explicit hints, then constructs an ordinary proof term for the existing checker to check. You still write where the evidence belongs.

That is useful for the small steps between a library lemma and a buffer access. Search is bounded and incomplete, so a harder goal may need a more specific lemma or a handwritten proof. It does not do general automatic induction.

The editor experience received attention as well: expanded LSP regression coverage exercises dependent proof diagnostics, document lifecycle, and UTF-8/UTF-16 ranges, including Korean text and emoji.

## What the Lean results mean

The formal work has moved forward alongside the libraries. Restricted Lean results cover dependent typing and substitution, ownership for supported Buffer and binary Tree fragments, erasure and abstract execution correspondence, and a constructed MIR translation. Selected native MIR snapshots also have scoped results.

Those are meaningful pieces of the larger argument, with explicit assumptions about inputs, layout, machine widths and resources. They do not yet compose into a correctness theorem for every accepted jihoo program. In particular, the native checker is tested rather than proved correct; production lowering, MIR-to-LLVM, LLVM, and the concrete allocator and runtime remain trust boundaries or open proof obligations. Successful allocation in an abstract model does not establish physical allocation success.

The [tagged proof-status assessment](https://github.com/jihoolang/jihoo/blob/v0.6.0/docs/internals/0.6-proof-status.md) records the precise scope and remaining work. That is the place to check a particular theorem's coverage. The announcement here is simpler: more useful dependent programs, more reusable evidence, and a better-tested release.

## Try 0.6.0

The [release page](https://github.com/jihoolang/jihoo/releases/tag/v0.6.0) has Linux archives for **x86_64 and ARM64**, with SHA-256 files. Verify the checksum and keep the bundled libraries with the compiler.

The published release is commit [`644ccf1`](https://github.com/jihoolang/jihoo/commit/644ccf1280c7e88bd0fbdf1d561d44bd903a2975). Its [release workflow](https://github.com/jihoolang/jihoo/actions/runs/43525140985) passed packaged-archive and dependent-consumer smoke tests on native runners for both architectures. Those native tests used the pinned Nix LLVM environment; compatibility with arbitrary distribution-provided LLVM versions is not established by them.

If you build from source, the bootstrap seed intentionally remains **0.5.0**. The released compiler and package are **0.6.0**.

Start with the sized-list example, then try carrying a runtime length from a loop into a buffer read. That connection—between a fact you have established and an operation that can use it—is the part of this release I am most excited to share.

*Written with Codex, using the published release and its tagged documentation.*
