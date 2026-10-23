---
title: "Horn: A Small Checker for Very Large Proofs"
description: "How a 759-line Rust kernel with no built-in logic checks univalence, winding numbers, and a 4 GB proof compressed to 64 kB, and why the rest of the system doesn't have to be trusted."
pubDate: 2026-10-23
---

When a computer tells you a theorem is true, how much of that computer do you have to believe?

For most proof assistants the honest answer is "quite a lot." The type checker, the elaborator, the tactic engine, the unifier, the normalizer: all of them sit somewhere on the path between your proof and the word *accepted*. A bug in any of them can turn a false statement into a "proved" one.

**[Horn](https://github.com/jihoo12/Horn)** is my attempt to make that answer as small as I can. It is a certificate checker written in Rust with no external crate dependencies. The trusted part, the code you actually have to believe, is **759 lines**. Everything else, including a cubical type theory, univalence, higher inductive types, and a small surface language, sits outside that boundary and has to convince the kernel by producing evidence.

## The idea: the checker knows nothing

Horn checks derivations in **many-sorted, first-order Horn theories**. A theory is a list of sorts, constructors, predicates, and rules of the form "if these premises hold, this conclusion holds." Nothing more.

The key design decision is that **predicate names have no built-in meaning**. The kernel doesn't know what equality is, what a type is, or what a function is. It doesn't search for proofs, normalize terms, or solve equations. It only checks that each step of a certificate is a correct instance of some rule.

Here is the smallest complete example from the repository. First, the theory:

~~~lisp
; Derivability of even natural numbers, using free constructor syntax.
(sort Nat)
(ctor z () Nat)
(ctor s (Nat) Nat)
(pred even (Nat))
(rule zero () (even z))
(rule plus-two ((even ?n)) (even (s (s ?n))))
~~~

Then the goal. This is chosen by the *caller*, not by whoever wrote the proof:

~~~lisp
(goal four-is-even (even (s (s (s (s z))))))
~~~

And the certificate:

~~~lisp
(step 0 zero () (even z))
(step 1 plus-two (0) (even (s (s z))))
(step 2 plus-two (1) (even (s (s (s (s z))))))
(result four-is-even 2)
~~~

Each step names a rule, refers to earlier steps as premises, and states a conclusion. The kernel checks that the numbering is consecutive, that the rule exists, that premises only point backwards, that there is one consistent assignment for the rule's schema variables, and that every goal is reported exactly once.

~~~text
$ kernel examples/nat.horn examples/nat.goals examples/nat.proof
ACCEPT: 1 goals, 3 proof steps, 136 bytes, 8 distinct terms, 78.559µs
~~~

If I break step 1 so that it claims `(even (s z))`, Horn says exactly where it went wrong and exits nonzero:

~~~text
REJECT: step 1 (plus-two): conclusion mismatch
~~~

That is the entire contract: **if checking succeeds, every goal has a finite derivation from ground instances of the theory's rules.** Nothing is trusted about how the certificate was produced.

## Where Horn came from

Horn didn't start as a standalone project. It was extracted on October 16 from **kamo3**, a private research project of mine that produces cubical type theory proofs, including a proof of univalence, as Horn-style certificates. The checker inside kamo3 was the one piece everything else depended on, so I wanted it to live on its own, be small enough to read in one sitting, and be tested and verified independently.

What I didn't expect was how far the project would go in one week after it got its own repository.

## Making the kernel fast without making it bigger

kamo3's largest certificate is **4.07 GB** and has 1.13 million steps. The first version of the extracted checker took **967 seconds and 746 MiB** to check it.

Version 0.2 rewrote the kernel around **hash-consing**: every distinct ground term is stored once in an arena and referred to by index. Two invariants keep this sound:

1. **Well-sortedness by construction.** Nodes are only created through one function, which checks the symbol's arity and every argument's sort. So every index denotes a well-sorted term.
2. **Index equality is structural equality.** Interning compares the full node, not just its hash. Two different terms can never share an index, even under deliberate hash collisions. An attacker can make checking slower but cannot change a verdict.

With these, matching a variable, comparing a binding, and comparing a result to a goal are each a single integer comparison. The kernel also reads proofs as a stream, so memory follows the number of distinct subterms rather than the file size.

The 4 GB certificate went from 967 s and 746 MiB to **74 s and 64 MiB**.

Version 0.2 also added **compact certificates**. A step can omit its conclusion, and the kernel rebuilds it by instantiating the rule:

~~~lisp
; Compact form of nat.proof: each conclusion is inferred from its rule.
(step 0 zero ())
(step 1 plus-two (0))
(step 2 plus-two (1))
(result four-is-even 2)
~~~

An untrusted tool, `horn-compress`, rewrites ordinary certificates into this form. The 4 GB certificate becomes 54.6 MB and checks in **0.79 s**.

## Oracle certificates: a 4 GB proof in 64 kB

Version 0.3 took this idea to its limit. If the kernel can infer conclusions, what is the minimum information a certificate actually needs?

The answer comes from Necula and Rahul's *oracle-based checking* (POPL 2001). An **oracle certificate records only the decisions the checker can't make by itself.** Horn rebuilds the derivation top-down from the goals using unification:

- A subgoal that was already derived is reused for free.
- If exactly one earlier judgment or rule fits, it is chosen for free.
- Only when there are several candidates does the oracle say which one.
- Only when unification leaves a term open does the oracle supply it, one constructor at a time.

The remaining decisions are encoded with an LZMA-style adaptive binary range coder, whose context is the parent rule, the premise position, and whether the subgoal is ground. A decision the context predicts well costs a small fraction of a bit.

For the `nat` example the oracle has **zero decisions** because every choice is forced. The file is just a header and a goal count:

~~~text
$ horn-oracle encode examples/nat.horn examples/nat.goals examples/nat.proof nat.oracle
GENERATED (not checked): 1 goals, 3 steps, 0 decisions, 0 witnesses, depth 2 -> 27 bytes
$ oracle-kernel examples/nat.horn examples/nat.goals nat.oracle
ACCEPT (oracle): 1 goals, 3 proof steps from 27 oracle bytes, 8 distinct terms, 1.050876ms
~~~

On kamo3's real certificates the results surprised me:

| Certificate | Ordinary | Compact | Oracle | Goals file |
| --- | ---: | ---: | ---: | ---: |
| ua-unglue | 4,067,276,087 | 54,591,519 | **63,890** | 59,673 |
| constant-equiv | 761,517,734 | 24,273,371 | **42,308** | 17,875 |
| compute | 39,657,410 | 3,076,975 | **6,698** | 24,409 |
| ua-beta | 26,107,428 | 1,589,886 | **3,123** | 5,012 |

The 4 GB proof becomes **63,890 bytes**, about the size of the *statement it proves*. That's 63,000 times smaller than the original. For comparison, `xz -9` on the compact form gives 7.2 MB. Generic compression can't come close because the redundancy is structural: these derivations are almost entirely determined by their goals.

The part I like most is that **this added no trusted code**. The decoder is untrusted. It runs in one thread and writes an ordinary compact certificate into an in-process pipe, and the unchanged kernel reads and checks it in another thread. A malicious oracle can only make decoding fail or produce a certificate the kernel rejects.

## Proving the checker sound

A small kernel is easier to trust, but "small" is not the same as "correct." So the checking algorithm is modelled in Agda and proved sound in [`agda/Soundness.agda`](https://github.com/jihoo12/Horn/blob/main/agda/Soundness.agda):

~~~agda
soundness : (R : List Rule) (goals : List Term) (c : Certificate)
          → accepts R goals c ≡ just tt → All (Derivable R) goals
~~~

If the model accepts a certificate, every goal is derivable. The proof uses no libraries and no postulates, and it is checked with `--safe --without-K --no-libraries` as part of `nix flake check`. The model covers stated and inferred conclusions, explicit bindings, one consistent schema assignment, earlier-only references, and goal results.

I want to be precise about what this does *not* cover. The Agda model isn't formally connected to the Rust code. Parsing, sorts, `def` abbreviations, and hash-consing are outside the model. The Rust kernel is written to follow the model step by step, and differential tests compare it against the original kernel on random and mutated inputs, but closing that gap is still on the roadmap.

## Statements for every universe level

A ground certificate proves one concrete statement. But many results in type theory hold *for every universe level*, and you can't write infinitely many ground certificates.

Horn has a research prototype for **schematic certificates**: judgments with eigenvariables, hypotheses, and structural induction over the term algebra. `horn-generalize` takes an existing ground proof and turns it into a schematic one, and any ground instance unfolds back into an ordinary certificate for the unchanged kernel.

With it, kamo3's univalence proof at universe `U₀` holds **for every level `L`**, using a few inductions on `max`. Level-generic univalence has 185,682 steps and re-checks in the Agda model ([`agda/Schematic.agda`](https://github.com/jihoo12/Horn/blob/main/agda/Schematic.agda)) in about six minutes.

## Cubical type theory as data

This is where Horn becomes more than a checker.

Cubical type theory is a type theory in which equality is represented by *paths*, functions from an interval `I` into a type. Its most famous feature is **univalence**: equivalent types are equal, and that equality actually computes. Transporting a value along `ua e` applies the equivalence `e`.

Horn doesn't implement any of that natively. The cubical rules are a **403-rule theory** written as plain Horn data. On top of it, `horn cubical eval` reads a small scripting language, elaborates it to the cubical core, generates a derivation, and only prints a value **after the kernel accepts the certificate**.

### Booleans and `ua not`

~~~lisp
(def not (pi b bool bool)
  (lam b bool (bif c bool bfalse btrue b)))

; not is its own inverse, by the dependent eliminator.
(def not-not (pi b bool (path bool (app not (app not b)) b))
  (lam b bool
    (bif c (path bool (app not (app not c)) c) (plam i btrue) (plam i bfalse) b)))

(def not-equiv (equiv bool bool)
  (pair not (app iso-equiv bool bool not not not-not not-not)))

; The path of types obtained from the equivalence.
(def not-path (path (u 0) bool bool) (app ua bool bool not-equiv))

; Transport along it computes, through Glue, to a boolean.
(eval along-ua (transport i (papp not-path i) btrue))
~~~

~~~text
$ horn cubical eval examples/cubical/script/bool.hcs
not-true = bfalse : bool
along-ua = bfalse : bool
ACCEPT (cubical script): 6 goals, 69185 proof steps
relies on 279 of the theory's 403 rules (0 generated by data declarations)
~~~

`btrue` moved along a path between `bool` and `bool` comes out as `bfalse`, because the path *is* `not`. That result is backed by a 69,185-step certificate. The last line reports exactly which part of the theory the result depends on.

### Programming with univalence: binary numbers

This example is my favorite. Addition is written **once**, on unary natural numbers. Then the script proves that unary naturals and bijective binary numerals are equivalent, turns that into a path of types with `ua`, and **transports the addition function along it**:

~~~lisp
; Bijective base-2 numerals: 0, 2b+1, 2b+2. Every number has one spelling.
(data bin (bz) (b1 bin) (b2 bin))

; nat and bin are equivalent, hence equal as types.
(def nat-is-bin (path (u 0) nat bin) (app ua nat bin nat-bin))

; Addition on binary numbers, obtained by transport, not written.
(def add-bin ...
  (transport i (pi a (papp nat-is-bin i) (pi b (papp nat-is-bin i) (papp nat-is-bin i))) add))

(eval three-plus-two (app add-bin (b1 (b1 bz)) (b2 bz)))
~~~

~~~text
$ horn cubical eval examples/cubical/script/binary.hcs
three = 3 : nat
five = (b1 (b2 bz)) : bin
three-plus-two = (b1 (b2 bz)) : bin
ACCEPT (cubical script): 18 goals, 99212 proof steps
relies on 318 of the theory's 440 rules (33 generated by data declarations)
~~~

`3 + 2` evaluated on binary numbers is the binary numeral for 5. No one ever wrote binary addition. It was carried over from `nat`, and the whole run, including the proof of the equivalence, is one kernel-checked certificate.

### The circle and its winding number

The circle `s1` is a higher inductive type with a point `base` and a path `loop` from `base` to itself. Its universal cover, `helix`, sends `loop` to the path of types given by the successor equivalence on the integers. Transporting `0` through `helix` over a loop counts how many times it winds:

~~~lisp
(def helix (pi x s1 (u 0))
  (lam x s1 (s1rec (u 0) int (app ua int int suc-equiv) x)))

(def winding (pi p (path s1 base base) int)
  (lam p (path s1 base base) (transport i (app helix (papp p i)) (pos 0))))

(eval loop-once (app winding (plam i (loop i))))
(eval constant (app winding (plam i base)))
(eval loop-backwards (app winding (plam i (loop (neg i)))))
(eval loop-twice (app winding (app compose (plam i (loop i)) (plam i (loop i)))))
~~~

~~~text
$ horn cubical eval examples/cubical/script/circle.hcs
loop-once = (pos 1) : int
constant = (pos 0) : int
loop-backwards = (negsuc 0) : int
loop-twice = (pos 2) : int
ACCEPT (cubical script): 12 goals, 306348 proof steps
relies on 333 of the theory's 433 rules (21 generated by data declarations)
~~~

Going around once gives `1`, staying still gives `0`, going backwards gives `-1` (`negsuc 0`), and going around twice gives `2`. The last case is the hardest one. Path composition on the circle is an ordinary definition using `hcomp`. A composition in `s1` is a formal point, the homogeneous composition constructor of Coquand, Huber, and Mörtberg, and a single theory rule lets the recursor commute with it. The rest runs through universe and Glue composition.

On my machine the whole run (elaboration, generating 306,348 steps, and checking them) takes under two seconds.

Scripts can also declare their own higher inductive types, like suspension:

~~~lisp
(data susp (north) (south) (merid bool (path north south)))
~~~

Horn generates their rules, including a dependent eliminator that commutes with formal compositions. Those generated rules are trusted specification, so they are written out alongside the certificate where anyone can inspect them.

## Errors that speak your language

Large proof engines often fail with messages only their authors can read. One of the most recent changes to Horn was about that.

You can leave a hole, `?` or `(? name)`, anywhere in a term. The form isn't certified, but Horn tells you what each hole needs, using the names you wrote:

~~~lisp
(def zero-add (pi n nat (path nat (app add 0 n) n))
  (lam n nat
    (natrec k (path nat (app add 0 k) k)
      (plam i ?)
      (lam k nat (lam p (path nat (app add 0 k) k) (? step)))
      n)))
~~~

~~~text
error: def zero-add: 2 goals to fill

?1
  n : nat
  i : I
  ⊢ nat
  where i = 0 must give (app add 0 0)
        i = 1 must give 0

?step
  n : nat
  k : nat
  p : (path nat (app add 0 k) k)
  ⊢ (path nat (app add 0 (suc k)) (suc k))
~~~

For the body of a path, it even shows the values the hole must take at each end of the interval.

And when a proof is wrong, Horn no longer reports the engine's last internal failure in de Bruijn indices (`local equality search failed: zero versus (v z)`). It reports the mismatch the way you'd explain it, in the names you used, with each side also shown evaluated:

~~~text
error: def zero-add: the path does not end where it must, at i = 0

  n : nat
  k : nat
  p : (path nat (app add 0 k) k)

  it is (papp p 0), which computes to (natrec x nat 0 ... k)
  but must be (app add 0 (suc k)), which computes to (suc (natrec ...))
~~~

None of this touches the kernel. It lives entirely in the untrusted elaborator, which is exactly where usability work belongs.

## A tiny surface language

Horn also has a small Lean-style language. It isn't cubical, but it shows the same principle from the other direction:

~~~text
sort Nat
ctor zero : Nat
ctor succ : Nat → Nat

def add : Nat → Nat → Nat
| zero,   n => n
| succ m, n => succ (add m n)

pred le : Nat → Nat → Prop
rule le.zero : le zero n
rule le.succ : le m n → le (succ m) (succ n)

#eval add 2 3
#eval add ?x 2 = 5
theorem add_zero (n : Nat) : add n zero = n := by induction n
theorem le_refl (n : Nat) : le n n
~~~

~~~text
$ horn examples/lang/nat.hn
add 2 3  ⟹  5
double 4  ⟹  8
add 3 2 = 5  with ?x = 3
le 2 4  ✓
theorem add_zero : add n 0 = n  ✓ (by induction n)
theorem add_one : add n 1 = succ n  ✓ (by induction n)
theorem le_refl : le n n  ✓ (by induction n)
theorem le_succ : le n (succ n)  ✓ (by induction n)
theorem lt_succ : lt n (succ n)  ✓ (by auto)
lt 3 7  ✓
certificate accepted: 10 goals, 38 steps, 4 inductions
~~~

`#eval` runs pattern-matching clauses, `add ?x 2 = 5` is solved as a logic query, and theorems are proved by search, case analysis, and induction. Every answer and every theorem ends up in one schematic certificate that is checked before the run succeeds. It is still a prototype with bounded execution, not a replacement for Lean, but every `✓` in that output is backed by evidence.

## The trust budget

Here's what you need to trust to believe a result from `horn cubical eval`:

| Component | Size | Role |
| --- | ---: | --- |
| Ground kernel | 759 lines | Trusted code, with an Agda-proved model of its algorithm |
| Core cubical theory | 403 rules | Trusted specification |
| Rules generated by `data` declarations | 21–64 rules per script | Trusted specification, emitted with the certificate |
| Schematic checker | 1,525 lines | Trusted only for "for every level" claims, also modelled in Agda |
| Engine, elaborators, oracle coder, generalizer, compressor | ~17,000 lines | **Untrusted**: their output is checked |

Most of the code, and nearly all of the cleverness, is in the bottom row. That's the point. I can rewrite the engine, add a new optimization, or change the error messages, and the worst a bug can do is make something fail to check.

The theory is a different kind of trust. If the 403 rules don't faithfully describe cubical type theory, Horn will happily check consequences of the wrong theory. That's not something the kernel can catch, so I keep it as a separate obligation. To keep it honest, every run reports how many rules a result relies on: arithmetic and induction on `nat` use 99 of the 403, while univalence for every level uses 301.

## What's next

The remaining work splits into three directions:

- **Verification**: add sorts to the Agda model, model the textual reader and `def` expansion, prove the hash-consing refinement, and connect the model to the executable, either by running an extracted Agda checker against the Rust kernel or by verifying the Rust code directly.
- **Performance**: have producers emit oracle certificates directly instead of writing a multi-gigabyte file first, and make oracle decoding (currently 3.5 s and 399 MiB on the largest certificate) faster than checking the compact form.
- **Language**: continue bringing the surface language and the cubical scripts together, as described in the [integration plan](https://github.com/jihoo12/Horn/blob/main/docs/INTEGRATION.md).

## Try it

Horn needs Rust 1.88 or newer and has no external crate dependencies:

~~~sh
git clone https://github.com/jihoo12/Horn
cd Horn
cargo run --release --locked --offline --bin kernel -- \
  examples/nat.horn examples/nat.goals examples/nat.proof
cargo run --release --locked --offline --bin horn -- \
  cubical eval examples/cubical/script/binary.hcs
~~~

The [README](https://github.com/jihoo12/Horn) and the [`docs/`](https://github.com/jihoo12/Horn/tree/main/docs) directory go into much more detail, especially [TRUST.md](https://github.com/jihoo12/Horn/blob/main/docs/TRUST.md) for the acceptance contract and [ORACLE.md](https://github.com/jihoo12/Horn/blob/main/docs/ORACLE.md) for oracle certificates.

What I enjoy most about Horn is how lopsided it is. A 759-line kernel that knows nothing about types sits at the bottom, and a whole cubical type theory is stacked on top of it. Each new layer has to earn its results the same way the 27-byte `nat` oracle does: by giving the kernel enough evidence to check.
