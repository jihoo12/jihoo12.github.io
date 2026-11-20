---
title: "The Smallest Observation Budget That Distinguishes Two Resource Histories"
abstract: "Two resource histories can end in the same state yet admit different records of what happened along the way. Jihoo computes the length of the shortest distinguishing record as a type. Two lamp controllers require three samples to tell apart, while reading and consuming the same message can be distinguished immediately at the inbox and remain indistinguishable at the draft."
pubDate: 2026-11-20
authors: ["Jihoo"]
writtenWith: "OpenAI Codex"
code: "https://github.com/jihoolang/jihoo/tree/5b8e245eac802734a544bf50e5cd16cf34aaa6a6"
lang: en
---

## A record that takes three samples

Suppose a diagnostic recorder watches a lamp. It can keep a reading when the lamp changes, skip any number of changes, and read the final state for free. Each saved entry contains just the state. The recorder has no clock or event counter. Could a log from controller A ever establish that it came from A?

| Controller | Changes after the common initial state |
| --- | --- |
| A | red, blue, red, blue, done |
| B | blue, red, blue, red, done |

With space for two samples, both controllers admit every pair of colors, including red twice and blue twice. The common initial state and the final `done` also appear in the same positions relative to every individual color. The sets of possible records of length at most two therefore agree.

With three samples, **red, red, blue** identifies A. In A the recorder can keep the first, third and fourth color changes. In B the second red is the last color before shutdown. A different three-sample record, **red, blue, red**, is possible in both. The number three measures the length of the shortest *possible* distinguishing record. A particular run of a recorder with three cells can still leave the controller's identity open.

In Jihoo each required sample can contribute one byte to the size of an array type. This program prints the size of that array.[^lamp]

```text
import std.history as h

struct Lamp {}
struct Red {}
struct Blue {}
struct End {}

type R = h.Put(Lamp, Red, ())
type B = h.Put(Lamp, Blue, ())
type Stop = h.Put(Lamp, End, ())
type Left = (R, B, R, B, Stop)
type Right = (B, R, B, R, Stop)

type Buffer {
    h.Apart(let N) => [u8; N]
}

fn main() {
    println(size_of(Buffer(h.Separation(Left, Right, Lamp))))
}
```

The program prints `3`. The compiler reduces `Separation` to `Apart(3)`, and the equation for `Buffer` turns that result into the native type `[u8; 3]`. This last step uses a closed type family, a form of type-level computation also available in Haskell.[^families]

## What a resource slot can reveal

In the lamp example a state has a color label. For a resource such as a document, the observer can also see which version of an input produced it. A history starts with each slot live and holding a distinct symbolic value `initial(slot)`. An update collects its inputs from this starting state of the step. A `Read` preserves its source, a `Take` consumes its source, and the final write installs `made(label, inputs)` at its destination. The order of the inputs is part of that expression. Reading a spent slot rejects the history, even when the observer is looking elsewhere.[^semantics]

Consider two routes that compose the same draft from an inbox. The first reads the message. The second takes it. Both routes write the draft after sampling the inbox.

| Observed slot | Read the message | Take the message |
| --- | --- | --- |
| Draft | `made(Compose, initial(Inbox))` | `made(Compose, initial(Inbox))` |
| Inbox | `initial(Inbox)` | spent |

The final-observation operator `Observe(history, slot)` computes the same type at `Draft` for the two routes. In the runnable example, an archive function returns an owned packet indexed by one observation. A publisher expecting the other observation accepts the packet and prints its boxed string. At `Inbox`, the free final reading already distinguishes the routes, so their separation is `Apart(0)`. A subsequent read at that slot is valid only on the route that retained the message.[^packet]

## Equality at a fixed budget

Fix a slot and a valid history. Start its trace with the initial reading, append the slot's state after every update, then collapse consecutive equal readings. Consecutive writes to the slot with the same label and input versions leave a single reading in the compressed trace. Updates touching only other slots also leave the trace in place.

For a nonnegative budget `k`, define two histories to agree when their final readings agree and their traces admit exactly the same ordered subsequences of length at most `k`. A mismatch in the final reading costs zero. With equal final readings, the least separating budget is the shortest subsequence present on just one side. Identical traces yield the type `Indistinguishable`. For distinct finite traces a witness always exists. A longer trace cannot be a subsequence of a shorter one, and two distinct traces of equal length cannot contain each other in full.

This definition gives a law for successive revisions. Write `sep(A, B)` for the separating budget at the fixed slot and assign identical traces the value `∞`. Then

```text
sep(A, C) ≥ min(sep(A, B), sep(B, C))
```

At every budget below the minimum, A and B admit the same records and final reading, as do B and C. Equality of these sets and readings gives the result for A and C. Thus two successive revisions that each preserve all two-sample observations also preserve them from the first version to the last. The slot matters throughout this argument. Appending an operation that consults another slot can expose a difference, as a later inbox read does in the draft example.

## Computing the first separating budget

Agreement on all subsequences up to a given length is known as Simon's congruence. Gawrychowski and colleagues give a linear-time algorithm for finding the largest agreeing budget on suitably encoded integer alphabets.[^simon] Jihoo's design choices enter in the projection from resource histories, the free terminal reading, and the use of the resulting budget in type conversion. The symbolic input expressions draw on the idea of tracing how an output was derived.[^provenance]

The implementation interns equal symbolic values so trace entries compare by identity. For two compressed traces with equal final readings, it computes a shortest uncommon subsequence in each direction. Consider a source suffix starting with a symbol `a`. A candidate witness can skip `a` or keep it. If the target suffix contains no `a`, keeping that one symbol suffices. Otherwise its earliest match leaves the longest possible target suffix. To make the candidate fail to match, the remainder must be missing even from that suffix. Taking the cheaper of skipping and keeping gives a dynamic program that reuses one row of lengths.[^algorithm]

For trace lengths `m` and `n`, the two directional passes together take `O(mn)` time and `O(max(m, n))` working space. Jihoo validates both histories before checking the final readings. The evaluator allows 4,096 structural visits per history. For pairs requiring the dynamic program it caps the product of the trace lengths at 1,048,576. Exceeding either bound produces a compile-time diagnostic.

## Checks against enumeration

For short traces, a reference calculation can enumerate every possible record. In this Python version `x` and `y` are the nonempty, compressed traces of a single slot.

```python
from itertools import combinations
from math import inf

def separating_budget(x, y):
    if x[-1] != y[-1]:
        return 0
    for k in range(1, max(len(x), len(y)) + 1):
        if set(combinations(x, k)) != set(combinations(y, k)):
            return k
    return inf
```

There are 189 nonempty words of length at most six on three symbols with no consecutive repetitions. Enumeration and the Jihoo distance routine agreed on all 35,721 ordered pairs. A separate end-to-end check compared 22 resource histories at three slots. For each of the 759 history-pair and slot combinations, we checked final observation equality and the separating type in both directions. Cases included reopening a spent slot, exchanging independent operations and reversing the inputs of a write. The computed lamp buffer and an explicit `[u8; 3]` also produced byte-identical LLVM IR on x86_64 and AArch64.[^fixtures]

## Scope and reproduction

The unit of comparison is a finite history supplied in a type. The programmer chooses the slots, the labels and the dependencies a write declares. Two acquisitions under the same label with the same symbolic inputs therefore give the same observation. Modeling a device that exposes a sequence number would require recording that distinction in the history. Connecting these declarations to the effects of arbitrary Jihoo function bodies remains a separate problem.

To run the examples from the linked Jihoo revision, enter its Nix development shell and build the compiler from the bundled seed.

```sh
nix develop
mkdir -p out
scripts/proof-limits.sh jihoo build -O2 compiler/main.jh -o out/jihoo
scripts/proof-limits.sh out/jihoo run examples/observation_budget.jh
scripts/proof-limits.sh out/jihoo run examples/observed_histories.jh
```

The first example prints `minimum ordered observations: 3`. The second prints `Minutes approved` when the publisher consumes the archive's packet.

[^lamp]: Jihoo, [runnable observation-budget example](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/examples/observation_budget.jh).
[^families]: Glasgow Haskell Compiler, [Closed type families](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/type_families.html#closed-type-families).
[^semantics]: Jihoo, [formation, evaluation and equality rules](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/docs/language/observed-histories.md).
[^packet]: Jihoo, [passing an owned packet between observers](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/examples/observed_histories.jh).
[^simon]: Paweł Gawrychowski, Maria Kosche, Tore Koß, Florin Manea and Stefan Siemer, [Efficiently Testing Simon’s Congruence](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.STACS.2021.34), STACS 2021.
[^provenance]: James Cheney, Umut Acar and Amal Ahmed, [Provenance Traces](https://arxiv.org/abs/0812.0564), 2008.
[^algorithm]: Jihoo, [resource evaluation](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/compiler/history.jh) and [separation algorithm](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/compiler/history_distance.jh).
[^fixtures]: Jihoo, [budget, symmetry and stuttering cases](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/tests/run/observation_budget.jh) and [rejection of a spent read](https://github.com/jihoolang/jihoo/blob/5b8e245eac802734a544bf50e5cd16cf34aaa6a6/tests/fail/observation_budget_invalid.jh).
