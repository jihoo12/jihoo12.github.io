---
title: "jihoo: Ownership Without Lifetimes"
description: "A systems language that is memory-safe without lifetime annotations or a garbage collector, matches C on the benchmarks, and checks every borrow with a 523-line kernel that trusts nothing the rest of the compiler decided."
pubDate: 2026-10-25
---

Rust showed that a language can be memory-safe without a garbage collector. The price is lifetimes: `'a` in signatures, `'a` in structs, and error messages about borrows that outlive the thing they borrow. Most of the time that price is worth paying. But I kept wondering how much of it is essential.

**[jihoo](https://github.com/jihoolang/jihoo)** is my answer to that question. It is a systems language with one owner per value, no garbage collector, no reference counting, and **no lifetime annotations anywhere**. It compiles through LLVM, and on the benchmarks I've run it matches C compiled by clang, with bounds checks on.

The trick isn't a smarter borrow checker. It's a smaller language for references: in jihoo, a borrow can never escape the function that made it, except in ways the compiler can see from a single function body. This post is about what that buys, what it costs, and how it's checked.

## A first look

```jihoo
enum Expr {
    Num(i64)
    Add(Box(Expr), Box(Expr))
}

fn eval(e: Expr) -> i64 {
    match e {
        Num(n) => n
        Add(a, b) => eval(a) + eval(b)
    }
}

fn main() {
    var counts = Map(String, i64).new()
    for w in "a b a".split(" ") {
        match counts.get_mut(w) {
            Some(n) => n += 1
            None => {
                counts.insert(w.to_string(), 1)
            }
        }
    }
    println(counts["a"])                                                  // 2
    println(eval(Expr.Add(Box.new(Expr.Num(2)), Box.new(Expr.Num(3)))))  // 5
}
```

It should look familiar. There are enums with payloads, `match` with exhaustiveness checking, generics written as calls (`Map(String, i64)`, `Box(Expr)`), and a standard library with `Vec`, `String`, `Map` and `Box`. All of those are **library types written in jihoo**, not built into the compiler.

What's missing is the interesting part. `eval` takes an `Expr` and doesn't consume it, copy it, or say how long it holds it. `get_mut` returns something you can change in place, and nobody wrote a lifetime.

## Three ways to pass a value

In jihoo, what a function does with its argument is part of the signature, the way it is in Swift and [Hylo](https://www.hylo-lang.org/):

| parameter | the function may | at the call |
| --- | --- | --- |
| `x: T` | read `x` during the call | `f(x)` |
| `inout x: T` | read and change `x`; no one else sees it meanwhile | `f(&x)` |
| `sink x: T` | own `x`: keep it, change it, destroy it | `f(x)`, which moves `x` |

Here are all three in one program:

```jihoo
struct Account {
    owner: String
    balance: i64
}

// Borrows the account to read it.
fn report(a: Account) {
    println(a.owner + ": " + a.balance.to_string())
}

// Borrows it to change it. The caller writes `&` to show that.
fn deposit(inout a: Account, amount: i64) {
    a.balance += amount
}

// Takes it: the caller's variable cannot be used afterwards.
fn close(sink a: Account) -> i64 {
    a.balance
}

fn main() {
    var acc = Account { owner: "ada", balance: 10 }
    report(acc)
    deposit(&acc, 32)
    report(acc)
    let copy = acc.owner.clone()      // copies are written out
    let total = close(acc)            // `acc` is gone from here on
    println(copy + " closed with " + total.to_string())
}
```

~~~text
$ jihoo run examples/ownership.jh
ada: 10
ada: 42
ada closed with 42
~~~

A few rules sit underneath this:

- **Every value has one owner**: a variable, a field, or an element.
- **Values that own memory move.** Assigning them, passing them to `sink`, or returning them moves them. Numbers, pointers, and structs made only of those are *plain* and copy implicitly, like in C.
- **Copies are explicit.** If you want a second `String`, you write `.clone()`. A small edit can never quietly turn a move into a deep copy of a tree.
- **Destruction is deterministic.** When an owner goes away, its `Drop` runs, then the drops of its parts. Values that are moved away on only some paths get drop flags.

Use a value after you've given it away and the compiler says so:

```jihoo
fn take(sink s: String) {}

fn main() {
    let s = String.from("hi")
    take(s)
    println(s)
}
```

~~~text
error: mv.jh:5:13: `s` is used here after it was moved away
        println(s)
                ^
~~~

## One rule instead of a borrow checker

Borrowing in jihoo comes down to a single rule:

> **While something is borrowed mutably, nothing else may use it. While something is borrowed, nothing may change it.**

This is the classic bug the rule exists for:

```jihoo
fn main() {
    var v = Vec(i64).new()
    v.push(1)
    for x in v {
        v.push(x)
    }
}
```

~~~text
error: loop.jh:5:9: `v` is changed here while it is borrowed
            v.push(x)
            ^^^^^^^^^
note: loop.jh:4:14: the borrow starts here, and is used later
~~~

In C++ this is iterator invalidation. `push` reallocates the buffer the loop is still reading. In jihoo it doesn't compile. Aliasing two mutable borrows is the same error:

```jihoo
fn swap(inout a: i64, inout b: i64) {
    let t = a
    a = b
    b = t
}

fn main() {
    var a = 1
    swap(&a, &a)
}
```

~~~text
error: swap.jh:9:14: `a` is used here while it is borrowed mutably
        swap(&a, &a)
                 ^^
note: swap.jh:9:10: the borrow starts here, and is used later
~~~

Borrows last until their last use, not to the end of the block, so ordinary code doesn't fight the rule:

```jihoo
let first = v.as_slice()
println(first.len)        // last use of `first`
v.push(4)                 // fine
```

## Why there are no lifetimes

Lifetimes exist in Rust because references are first-class values. You can put a `&T` in a struct, return it, keep it in a `Vec`, and the compiler has to track how long each one is valid *across* function boundaries. A signature has to say how the output's lifetime relates to the inputs', because the caller can't look inside.

jihoo makes references **second class**. A borrow is made for a call or a block and ends there. You can't store a `ref T` in an ordinary struct. Because every borrow starts and ends inside one function body, the checker can see all of it, and there's nothing for a signature to declare.

That would be too restrictive on its own, so two things relax it.

**Projections.** A function may return a borrow of *part of its first parameter*, with `-> ref T` or `-> inout T`:

```jihoo
impl(T: type) Vec(T) {
    pub fn index(self, i: i64) -> ref T { ... }
    pub fn index_mut(inout self, i: i64) -> inout T { ... }
}

v[2] += 1          // index_mut
let x = v[0]       // index
```

The result is a place, not a stored reference, and the first argument counts as borrowed while it's in use. This is how `Vec`, `Map` and `Box` can be ordinary library types and still read like built-ins: indexing is `Index`, `b.x` through a box is `Deref`.

**Views.** `str`, slices, closures, and borrows are *views*: values that point into something owned elsewhere. A type that contains a view is itself a view, and so is a generic type given one, like `Vec(str)` or `Option(ref T)`. Views can be returned and stored in other views. The compiler follows what each one borrows, and the one rule it needs is that **a function can only return views of what its parameters point to**:

```jihoo
fn first_word(s: str) -> str {
    ...
    s[0..i]                            // part of `s`: fine
}

fn broken() -> str {
    let s = String.from("temp")
    s.as_str()                         // the result borrows `s`
}
```

~~~text
error: ret.jh:2:9: `s` goes away here while it is still borrowed
        let s = String.from("temp")
            ^
note: ret.jh:3:5: the borrow starts here, and is used later
~~~

`first_word` is the function that made Rust need lifetime elision rules. In jihoo it needs nothing, because a returned `str` can only borrow from the parameters, and the caller treats it as borrowing them.

## What it costs

It would be dishonest to stop there. Second-class references are a real restriction, and here's what you give up today:

- **No structs that hold references.** A parser can't keep a `&str` to its input in a field. You keep indices, or make the struct a view (which then can't outlive the input). For the code I write, compilers and tools, indices into vectors turn out to be the natural shape anyway. The jihoo compiler itself is written that way.
- **Closures can't be stored.** A closure borrows what it captures, so its type `fn(A) -> R` is a view. You can pass one down, keep it in a local, or take it as a `comptime` parameter that gets inlined. But you can't put a callback in a struct field for later. Closures that own their captures are on the roadmap.
- **No dynamic dispatch yet.** Traits are resolved at compile time. `dyn Trait` is planned, not done.
- **No threads in the standard library yet.** Atomics are there. Threads, channels, and the `Send`-like rules for them are next.

Hylo has explored the same trade-off, and I owe it a lot. jihoo's take is to keep the surface closer to Rust and Zig and to push hard on two things: a checker that doesn't trust the compiler, and generated code that matches C.

## A checker that trusts nothing

This is the part I'm proudest of, and it comes straight from [Horn](/blog/horn-a-small-checker-for-big-proofs/).

The jihoo compiler lowers source to MIR, a control-flow graph over *places* in which every move, copy, borrow, and drop is an explicit statement. Sema, the big part of the compiler at about 6,000 lines, decides what is moved, what is copied, and what is borrowed, and inserts the drops. **Then a separate pass checks all of it again without trusting any of it.**

```text
source.jh → parse → sema (check + lower) → MIR → elab → check → LLVM IR → clang
```

`check.rs` is the borrow kernel. It's **523 lines**. It finds every loan in the MIR, follows loans through views (copies, aggregates, calls that return views, `inout` arguments that are views), and computes which locals are used later. A loan lasts as long as some local holding it is still used. Then every access is checked against the loans live at that point:

- a place borrowed mutably may not be used through anything else;
- a place borrowed may not be changed, moved, or dropped;
- a returned view may only borrow what the parameters point to.

The split is the same one Horn makes between its engine and its kernel. If sema has a bug and forgets that something is borrowed, the result is a compile error from the kernel, **not a dangling pointer at runtime.** I can rewrite sema, change how it lowers closures, or add a feature, and the worst a bug in that code can do is reject a correct program.

## As fast as C

Being safe costs nothing at runtime here, and in one place it actually helps.

Because an `inout` parameter can't alias anything, the compiler can promise LLVM that. This is the real IR for `report` and `deposit` above:

~~~llvm
define internal void @"main.report.1"(ptr noalias readonly align 8 dereferenceable(32) %p0)
define internal void @"main.deposit.2"(ptr noalias align 8 dereferenceable(32) %p0, i64 %p1)
~~~

`noalias` is what C programmers get only by writing `restrict` by hand, and only if they're right about it. jihoo gets it from the type system on every borrowed parameter.

The code generator is simple on purpose. Every local is an `alloca`, every field a byte offset, every aggregate move a `memcpy`. LLVM's `mem2reg` and SROA turn that into registers. Generics are compile-time parameters, as in Zig (`comptime T: type`), so each instance compiles to its own specialized code and there's no dispatch cost.

Each program below was run three times and the best time taken, on x86_64. jihoo was built with `--release -O2` and **bounds checks on**, C with `clang -O2`:

| program | jihoo | C |
| --- | ---: | ---: |
| `fib(40)`, recursive | 0.31 s | 0.30 s |
| sieve of Eratosthenes to 50 million | 0.47 s | 0.47 s |
| 1000 × 1000 matrix product | 0.33 s | 0.32 s |
| n-body, 5 bodies, 5 million steps | 0.30 s | 0.31 s |

These are small benchmarks, and I don't want to oversell them. But they're the kind of tight loops where hidden costs like reference counts, GC barriers, or defensive copies would show up, and none do.

## Down to the machine

jihoo has two profiles. The default, **native**, links libc and can call C functions directly. **Freestanding** programs don't link libc at all. The standard library talks to Linux through `syscall` and brings its own allocator:

```jihoo
#![freestanding]

fn main() {
    var v = Vec(i64).new()
    for i in 1..101 {
        v.push(i)
    }
    var sum = 0
    for x in v {
        sum += x
    }
    println(sum)
}
```

~~~text
$ jihoo build examples/freestanding.jh -o hello
$ ls -l hello
-rwxr-xr-x 1 jihoo users 5296 Oct 25 20:06 hello
$ file hello
hello: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked
$ ./hello
5050
~~~

That's a growable vector, a heap allocator, and formatted output in a **5.3 kB static binary** with no dependencies. The same source builds for aarch64 with `--target`. Raw pointers, `extern fn`, inline `asm`, and `syscall` are only allowed inside `unsafe { }`, and that's how the standard library builds `Vec`, `String`, `Box`, and `Map` for safe code to use.

## Where it came from

This is version 0.1, and it's a rewrite. The first jihoo had three profiles with three memory models: a VM with a garbage collector, native code with an *inferred* ownership pass that inserted copies and reference counts, and freestanding code with raw pointers only. Every feature had to be built up to three times and agree across all three.

The bigger lesson was about implicit copies. Value semantics with inferred moves is pleasant to write, but a small change could turn a move into a copy of a whole tree, and I ended up building tools just to find those copies after the fact. Thirteen of the last 25 items on the old roadmap were about copies. 0.1 makes the opposite choice: moves are checked, copies are written out, and mutation goes through `inout` instead of "take it and return it."

The [design document](https://jihoolang.github.io/jihoo/internals/redesign/) explains the rewrite in more detail.

## What's next

The compiler is a single Rust crate of about 12,000 lines, and it's written to be ported. It uses no references in structs, refers to data by index (`TyId`, `Local`, `FnId`), and uses only enums, `match`, `Vec`, and `HashMap`. That's on purpose, because the next goal is:

- **The compiler in jihoo.** Port `crates/jihoo` line by line, then build it with itself.

After that:

- **Compile-time evaluation**: an interpreter of MIR with the target's memory layout, so `comptime` code can allocate and build containers.
- **`#[derive]`** for `Clone`, `Eq`, `Ord`, `Hash`, and `Show`.
- **Dynamic dispatch and owning closures**, so callbacks can be stored.
- **Threads, channels, and locks** as library code over atomics.
- **Better errors**: more than one per run, and notes that show where a moved value went.

## Try it

jihoo runs on x86_64 and aarch64 Linux. With [Nix](https://nixos.org/) you don't need to install anything else, because the flake brings clang and lld:

~~~sh
nix run github:jihoolang/jihoo -- run hello.jh
~~~

Or build from source:

~~~sh
git clone https://github.com/jihoolang/jihoo
cd jihoo
nix develop
cargo run -- run examples/ownership.jh
cargo run -- emit-mir examples/hello.jh     # see the MIR the kernel checks
~~~

The [documentation](https://jihoolang.github.io/jihoo/) starts with a tour of the language, and the [borrowing](https://jihoolang.github.io/jihoo/language/borrowing/) page covers the rules in this post in full.

The question I started with was how much of Rust's lifetime machinery is essential. My answer so far is that for a large class of programs, the ones built from trees, tables, and indices, almost none of it is, provided references stay where the compiler can see them. Writing the jihoo compiler in jihoo will be the real test of that answer.
