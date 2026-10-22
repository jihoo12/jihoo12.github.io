---
title: "Rosemary: Understanding Machine Code from the Ground Up"
description: "Inside my dependency-free Rust reverse-engineering tool: x86-64 decoding, typed IR, control-flow and value analysis, C/assembly generation, and self-reversal tests."
pubDate: 2026-10-22
---

What can we learn about a program when its source code is gone?

At the machine-code level, even a simple function becomes a sequence of bytes, registers, flags, memory accesses, and jumps. Recovering the instructions is only the beginning. The harder question is how to turn those instructions into something we can inspect, reason about, and test.

That is what I'm exploring with **[Rosemary](https://github.com/jihoo12/rosemary)**, an experimental x86-64 reverse-engineering tool written in Rust.

Rosemary can decode raw machine code and ELF64 executables, lift instructions into its own typed intermediate representation, analyze control flow and known values, and emit either Intel-syntax assembly or executable C that models the original machine state.

It does this **without third-party Rust crates or an external disassembler at runtime**. The decoder, IR, analyses, and backends are all implemented in the repository.

## From bytes to something we can reason about

The basic architecture looks like this:

~~~text
Raw x86-64 bytes / ELF64
            |
    Linear or recursive decoding
            |
       rosemary-ir v1
        /     |      \
     C       ASM    Control flow
                      |
              Text / JSON / DOT
                      |
             Value explanations
               and simplification
~~~

I wanted the stages to be independently useful. Decoding shouldn't be inseparable from printing assembly, and analyzing an instruction shouldn't require decoding that instruction all over again.

Rosemary's commands reflect that separation:

- `lift` recovers instructions and writes IR.
- `emit` translates saved IR into C or assembly.
- `analyze` builds control-flow information and explains what can be inferred.
- `simplify` rewrites control transfers that the analysis has proved.
- `symbols`, `sections`, and `scan` inspect ELF contents and measure function coverage.

The [source layout](https://github.com/jihoo12/rosemary/tree/main/src) follows the same design: `decode.rs`, `ir.rs`, `elf.rs`, `analysis.rs`, `dataflow.rs`, `emit.rs`, and `scan.rs` have distinct responsibilities.

## A six-byte example

Consider a tiny x86-64 function that moves 42 into EAX and returns. Its bytes are:

~~~text
b8 2a 00 00 00 c3
~~~

Rosemary can lift it directly:

~~~sh
cargo run -- lift --hex 'b8 2a 00 00 00 c3' --base 0x1000 -o function.ir
~~~

The resulting machine-level IR is small enough to read by eye:

~~~text
rosemary-ir 1
entry 1000
1000 5 mov r:32:0 i:32:2a
1005 1 ret
~~~

The first instruction is at virtual address `0x1000`, occupies five bytes, and writes the 32-bit immediate `0x2a` into register index zero (EAX). The next instruction returns.

It isn't a high-level syntax tree pretending that a binary still contains its original variable names. The IR preserves the details that actually matter to machine execution: **instruction addresses, lengths, operand widths, registers, immediates, and memory operands**.

The saved representation is also editable and independently parseable. The [IR implementation](https://github.com/jihoo12/rosemary/blob/main/src/ir.rs) validates boundaries and operand shapes rather than silently accepting malformed instructions.

## Decoding code is different from decoding every byte

One surprisingly important design choice is that Rosemary offers **linear and recursive recovery**.

Linear decoding proceeds through every byte in the selected code range. That can be useful when measuring exact coverage, but it can also fail if the region contains embedded data or unsupported padding.

Recursive recovery starts from an entry point and follows discovered control-flow paths: conditional branches, direct jumps, direct calls, and their continuations. Bytes that no discovered path reaches are left out of the recovered IR.

For example:

~~~sh
cargo run -- lift program.elf --recursive -o reachable.ir
cargo run -- analyze reachable.ir --to dot -o control-flow.dot
~~~

Rosemary analyzes basic blocks and their edges, distinguishes internal and external targets, reports unreachable blocks, and finds cyclic components that may represent loops. Analysis results can be written as **text, JSON, or Graphviz DOT**, so the same recovered program can be inspected in a terminal or visualized as a graph.

It can also select named ELF functions, inspect executable sections, or attempt to lift **all executable PROGBITS sections** without treating gaps between them as instructions.

That last detail matters: knowing which bytes belong to a code section is not the same thing as having completely reconstructed a program's behavior.

## Going beyond a disassembly listing

The part I find most interesting is Rosemary's **conservative value analysis**.

The [dataflow engine](https://github.com/jihoo12/rosemary/blob/main/src/dataflow.rs) tracks known or unknown values for the 16 general-purpose registers, several condition flags (ZF, SF, CF, OF, PF), and the direction flag. It propagates those facts through instructions and control-flow edges until reaching a fixed point.

A small example in the repository begins by clearing EAX with `xor eax, eax`, then tests a `jne` branch. Clearing EAX sets the zero flag, so that branch cannot be taken. On the remaining path, multiplying 6 by 7 produces 42.

You can inspect the reasoning yourself:

~~~sh
cargo run -- analyze examples/proven_branch.ir --to explain
cargo run -- simplify examples/proven_branch.ir -o simplified.ir
~~~

Rosemary can explain why the branch falls through and why RAX is 42 at the return. The simplifier replaces the proven-not-taken branch with a NOP **while preserving its original address and recorded length**. Other provably taken branches can become unconditional jumps, and some constant indirect transfers can be resolved.

That is a much more useful result than a list of instructions alone: it's a small, checkable statement about how the machine code behaves.

The analysis deliberately avoids inventing facts. Memory loads remain unknown, calls invalidate relevant register and flag knowledge, and uncertain indirect control flow is treated conservatively. If the engine cannot prove something, it should say so rather than manufacture a convincing explanation.

## Emitting C doesn't mean recovering the original C

Rosemary has two output backends:

~~~sh
cargo run -- emit function.ir --to asm -o function.s
cargo run -- emit function.ir --to c -o function.c
~~~

The assembly backend reconstructs an Intel-syntax listing with labels and original-address comments. It is useful for inspecting or assembling recovered instructions, but it is **not guaranteed to recreate the original binary byte for byte**.

The C backend does something different and, to me, more interesting. It produces C11 code with a `rosemary_machine` state—registers, flags, an instruction pointer, vector state, and guest-memory callbacks—and a `rosemary_run` function that executes the translated instructions under an instruction budget.

Memory accesses go through host-provided load/store callbacks. Branches operate on the modeled instruction pointer; calls and returns use a modeled stack. The generated C does not directly execute the original machine instructions.

**This is executable machine-state translation, not source-level decompilation.** Rosemary does not currently reconstruct the original C variables, data types, function signatures, or structured source control flow. I think that distinction is important: a tool should be clear about what it has actually recovered.

The repository includes a [summation example](https://github.com/jihoo12/rosemary/blob/main/examples/sum_host.c) that runs translated code for a loop computing `5 + 4 + 3 + 2 + 1` and checks that the resulting RAX value is 15.

## Real compiler output is the challenge

Supporting a couple of toy instructions would be easy. Real compiler-generated binaries are a different story.

Rosemary's decoder has grown to cover substantial integer x86-64 operations, calls and returns, conditional branches, address calculations, stack manipulation, and selected string instructions. It also implements a substantial **SSE/SSE2 subset**, selected SSE3 duplication instructions, and scalar floating-point comparisons with modeled MXCSR behavior.

These aren't just names printed by a disassembler. The tool has to represent the instruction accurately and, for its C backend, model the semantics it claims to support.

The implementation remains deliberately bounded. **AVX/AVX-512, general floating-point arithmetic, syscalls, many instruction forms, and other architectures are not supported.** ELF support is focused on little-endian x86-64 executables and shared objects with usable section tables; it is not a universal loader.

An unsupported or truncated instruction produces an explicit error with its address instead of guessing the length and quietly continuing. I prefer an honest failure to an attractive but incorrect result.

## The unusual test: Rosemary reversing Rosemary

One of the strongest ideas in the repository is **dogfooding**: use Rosemary to analyze its own compiled executable.

The [dogfood integration tests](https://github.com/jihoo12/rosemary/blob/main/tests/dogfood.rs) and [verification script](https://github.com/jihoo12/rosemary/blob/main/scripts/dogfood.py) are built around the real Cargo-produced binary, not a special demonstration function planted for testing.

The checks include decoding every byte of its executable sections, lifting sized function symbols, round-tripping the IR, reconstructing assembly, and compiling generated C for selected real core functions. The integration tests also exercise analysis output and the batch scanner.

There's an optional comparison against GNU objdump for instruction boundaries and normalized mnemonics. **Objdump is a test oracle there, not the decoder used by Rosemary.**

For me, this is a particularly satisfying form of verification: the tool has to face code produced by a real Rust compiler—including its own decoder and analysis routines—instead of succeeding only on carefully chosen examples.

The repository also has tests for malformed inputs, instruction semantics, control-flow recovery, and native-versus-translated behavior. Those tests are written into the project; this article describes their coverage rather than claiming that I reran the suite for this post.

## Try Rosemary

You'll need Rust **1.88 or newer**:

~~~sh
git clone https://github.com/jihoo12/rosemary.git
cd rosemary
cargo build --release
cargo test
~~~

To inspect the tool's own compiled code:

~~~sh
target/release/rosemary symbols target/release/rosemary
target/release/rosemary scan target/release/rosemary --to json
target/release/rosemary lift target/release/rosemary --all-code -o rosemary.ir
target/release/rosemary analyze rosemary.ir --to summary
~~~

For deeper verification, the repository documents `python3 scripts/dogfood.py` and its optional instruction-boundary check.

## What Rosemary is becoming

Rosemary is not Ghidra, IDA, or a finished high-level decompiler. It's a focused experiment in building a **transparent path from x86-64 machine code to an analyzable, executable representation**.

The parts that interest me most are the boundaries between decoding, semantics, and proof: how to preserve enough information to reconstruct behavior, how to distinguish known facts from unknown ones, and how to test those claims against real compiler output.

A reverse-engineering tool should do more than print plausible-looking code. **It should show what it knows, preserve what it doesn't, and give us a way to check the difference.**

That's the direction I'm taking Rosemary.

**Source code and documentation:** [github.com/jihoo12/rosemary](https://github.com/jihoo12/rosemary)
