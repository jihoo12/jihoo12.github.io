---
title: "Teaching a 759-Line Checker Category Theory"
description: "What broke, and what the small kernel caught, when Horn's cubical scripts grew from univalence to categories, functors and a judgmental op (op C) = C."
pubDate: 2026-10-23T22:00:00+09:00
---

In the [previous post](/blog/horn-a-small-checker-for-big-proofs/) I described **[Horn](https://github.com/jihoo12/Horn)**: a 759-line kernel that knows no mathematics, checking a cubical type theory that is handed to it as 403 rules of plain data. The cubical scripts on top of it could already compute through univalence. Transporting `true` along `ua not` gave `false`, and the circle's winding number came out as `2`.

This post is about what happened next. I tried to write something that looks like a library: categories, functors, natural transformations. Almost nothing worked on the first try. The interesting part is *how* things failed. Some failures were the untrusted engine being too weak. One was the engine being wrong, and the kernel caught it. One was a bug the kernel could never have caught.

## The goal: `op (op C) ≡ C` by `refl`

A (wild) category is a nested Σ-type: objects in `U1`, morphisms in `U0`, identities, composition, and the unit and associativity laws as paths:

~~~lisp
(def Cat (u 2)
  (sigma Ob (u 1)
  (sigma Hom (pi x Ob (pi y Ob (u 0)))
  (sigma id (pi x Ob (app Hom x x))
  (sigma cmp (pi x Ob (pi y Ob (pi z Ob (pi f (app Hom x y) (pi g (app Hom y z) (app Hom x z))))))
  (sigma idl ...
  (sigma idr ...
    assoc ...))))))
~~~

The opposite category `op C` keeps the objects, reverses every morphism, swaps the unit laws and turns associativity around with `sym`. Doing that twice should give back exactly `C`. In cubical type theory `sym (sym p)` is `p` on the nose, so I wanted this to hold *judgmentally*, as `refl`:

~~~lisp
(check op-op (lam C Cat (plam i C)) (pi C Cat (path Cat (app op (app op C)) C)))
~~~

It now does, in about five seconds and a little over a million proof steps. Getting there took four separate fixes.

## 1. Types that only compute to a pi

The first failure was the category of types and functions, whose laws should all hold by `refl`. The left unit law says `λa. f (id a) = f` at type `Hom A B`. The engine supports function η and β under binders, and both work at the type `A → B`. They failed at `Hom A B`.

The reason was syntactic. Several places in the engine asked "is this type a pi?" by looking at its head symbol. `(app Hom A B)` is a redex that *computes* to a pi, but its head is `app`. The fix was to compute the type to weak-head normal form wherever a type former is needed: η, congruence, β through an annotation, and a few more spots. None of it touches the kernel. The engine simply learned to find derivations it could not find before.

## 2. Definitions that copy themselves everywhere

With that fixed, `op` checked. But `Hom (op C) x y ≡ Hom C y x`, the first thing you'd want to know about it, ran for 25 seconds and gave up.

A trace showed terms of about **1.5 MB**. Definitions were *inlined*: every mention of `Hom` became `(ann (lam ...) TYPE)`, with the full type of `Cat` inside the annotation, and `op` mentions `Hom`, `id`, `cmp`, and so on. Each reduction step carried the whole structure along.

The fix was to make a definition a **constant**. `(def NAME TYPE TERM)` now becomes an atom `def/NAME` with generated rules, shipped with the certificate like the rules of a `data` declaration:

~~~lisp
(rule rhas.def/NAME ((rctx ?d ?g ?phi) (rhas z nil ft TERM TYPE))
  (rhas ?d ?g ?phi def/NAME TYPE))
(rule req.delta.def/NAME ((rctx ?d ?g ?phi) (rhas z nil ft TERM TYPE))
  (req ?d ?g ?phi def/NAME TERM TYPE))
~~~

This changes what you have to trust, so I wanted an argument for it rather than a feeling. Both rules have the definition's own closed typing, `TERM : TYPE`, as a **premise**. A constant can only be used in a derivation that also proves its definition well-typed. If you read `def/NAME` as `TERM`, each rule becomes something already valid: weakening a closed typing, and reflexivity. So the extension is *definitional*. It adds no axiom, and a certificate cannot use a constant to smuggle in a false typing.

Terms stopped growing, and the circle example, which uses definitions heavily, got almost twice as fast (1.87 s to 1.08 s).

## 3. The kernel catches the engine

The constants change came with a few engine optimizations. One of them recorded a typing derived by conversion, so a later check could reuse it. All the tests passed in direct mode. Then the oracle path rejected a higher-inductive-types example:

~~~text
error: hit.hcs: step 69915 (req.ann): premise 69907 mismatch
~~~

This is the design working as intended. `req.ann` says that an annotated term `(ann t A)` equals `t` at type `A`, and its premise must be the typing of `(ann t A)` *at `A`*. The engine had handed it a typing at a different, convertible type. That was an old latent bug in how the engine reduces annotations: it passed along the caller's typing instead of building the one the rule asks for. Until then, the two had always happened to coincide. The new memo made them differ, and the kernel, which knows nothing about cubical type theory but checks every premise, refused the step.

A bug in the untrusted engine turned into a failed check, never into a false result. The fix was two lines.

## 4. The same equation, again and again

Now `Hom (op C) x y` worked, but anything with `op (op C)` ran for minutes. A profile said the cost was **420,000 steps of `rhas.shift`**, the rule that moves a typing under one more binder. My first guess was to add a rule that weakens by many binders at once, and I measured before writing it. That would have saved only the intermediate typings, while adding an equally long chain of shifts. That was not enough to justify a new trusted rule.

So I traced the equality search instead, printing each equation with the length of its context:

~~~text
EQ[1] (fst (v 0))  ==  (app Ob (v 0))
EQ[2] (fst (v 1))  ==  (app Ob (v 1))
EQ[3] (fst (v 2))  ==  (app Ob (v 2))
...
~~~

It was the *same* equation, shifted, being proved from scratch at depth 1, 2, 3 and up to 29, while the engine compared a structure's types under the laws' binders. A one-binder experiment made it concrete. `Ob C ≡ Ob (op (op C))` took 0.19 s in the context `[C]`, and more than 30 seconds after adding a single unrelated variable `x : Ob C`.

The engine already avoided this for typings. It proves a typing in the shortest context its term lives in and then lifts it. For equations the theory simply had no rule to lift with. So I added one, the equation version of `rhas.shift`:

~~~lisp
(rule req.shift ((req ?d ?g ?phi ?t ?s ?a) (rhas ?d ?g ?phi ?b (u ?l))
    (shift ?t z ?t2) (shift ?s z ?s2) (shift ?a z ?a2))
  (req ?d (cons ?b ?g) ?phi ?t2 ?s2 ?a2))
~~~

Weakening is admissible for every equality rule. This rule only states it, so the theory went from 403 to 404 rules. With it, an equation is proved once and lifted:

| | before | after |
| --- | ---: | ---: |
| `Ob C ≡ Ob (op (op C))` under one binder | > 30 s | 0.15 s |
| `Hom (op (op C)) x y ≡ Hom C x y` | no result in 120 s | 2.7 s |
| `op (op C) ≡ C` | — | 5.4 s |
| circle, steps | 289,598 | 153,575 |

## Functors and natural transformations

After that, the rest of the library mostly just worked. A functor is a Σ of an object map, a morphism map, and the two functor laws. A natural transformation is a family of morphisms with naturality squares. The library defines:

- the identity functor and composite functors, whose laws are built from the components' laws with `ap` and `trans`;
- the identity functor as a unit for composition on both maps, by `refl`;
- natural transformations, with the identity natural by the target category's unit laws;
- vertical composition, whose naturality is a five-step chain of `trans` through associativity and both naturality squares.

All of it checks in 1.4 seconds. One thing does *not* hold by `refl`: a composite with the identity functor has `trans p refl` where the original has `p`. Cubical type theory without regularity does not identify those, so whole functors are equal only on their maps. That's a property of the theory, not a bug.

The library lives in `examples/cubical/lib` and is shared through a new `(import FILE)` form. Imported definitions are checked again inside each certificate that uses them, so an import adds no trust.

## The bug the kernel cannot catch

The library also needed **implicit arguments**, `(pi {A} (u 0) ...)`, filled in by the elaborator from the explicit arguments' types. Like everything outside the kernel, this is only a guess: the application is written out and checked as usual, so a wrong guess becomes a type error.

Then a code review found a case where the guess was wrong *and still type-correct*:

~~~lisp
(check pre (lam z nat (lam y nat y)) (pi z nat (pi y nat nat)))
(def k (pi {A} (u 0) (pi f (pi n nat (pi a A A)) (u 0))) (lam f (pi n nat (pi a A A)) A))
(eval r (app k (lam x nat (lam y bool y))))
~~~

The written lambda says `A` is `bool`. The engine needed a type for the inner `(lam y y)`, which carries no type in the core. It recalled the typing it had recorded for the *same core term* in `pre`, at `nat`. The identity function is a perfectly good `nat → nat`, so everything checked, and `r` evaluated to `nat`.

The kernel did nothing wrong. It certified a true statement. It just wasn't the statement I wrote. A small trusted core guarantees that what you prove is *derivable*. It cannot guarantee that the untrusted front end proved *what you meant*. The fix was to type a lambda argument from its own written domain, never from a recalled typing. But the lesson is the more useful part.

## Errors in your own words

The last change of the week was for whoever tries this next. Three kinds of failure still printed engine internals:

~~~text
restricted inference needs an annotation for (lam (v z))
application expects Pi
local equality search failed: (suc (v z)) versus (v z) : nat under ft in 0 dimensions
~~~

They now read like the rest of Horn's errors, in the names you wrote:

~~~text
error: equal e: two terms that must be equal are not

  x : nat

  this (suc x)
  differs from x
  at type nat
~~~

An untypeable lambda now explains how to give it a type, and something applied that isn't a function shows the type it actually has.

## What's still open

The biggest open question hasn't changed. The 404 rules are trusted as a description of cubical type theory, and that they describe it *correctly* is not proved. Every run reports which of them a result relies on (the category example uses 164), but adequacy is a separate obligation. Beyond that:

- categories are wild: hom-types aren't required to be sets, so there is no functor category or Yoneda lemma yet;
- imports are textual, and a library is re-checked by every script that imports it;
- checking takes seconds, and the engine's search can still fail on true goals.

## Try it

~~~sh
git clone https://github.com/jihoo12/Horn
cd Horn
cargo run --release --locked --offline --bin horn -- \
  cubical eval examples/cubical/script/category.hcs
~~~

~~~text
ACCEPT (cubical script): 12 goals, 1107928 proof steps
relies on 164 of the theory's 453 rules (36 generated by declarations and definitions)
~~~

The last line is my favorite part of the whole project. It tells you what you have to believe: 164 rules, 36 of them generated from the script's own definitions, and a 759-line kernel that knows nothing about any of them.
