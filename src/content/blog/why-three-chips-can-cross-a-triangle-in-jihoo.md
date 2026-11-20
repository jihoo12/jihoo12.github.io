---
title: "Why Three Chips Can Cross a Triangle in Jihoo"
description: "A parcel at A can satisfy a function expecting it at B. On a triangle it takes three chips. Cut one edge and it takes one."
pubDate: 2026-11-20
heroImage: "../../assets/nixchan/nixchan-math-thinking-01.png"
---

I gave a parcel a type that records where its chips sit on a graph. Then I wrote a function that takes the parcel with its chips at A and returns it with them at B. The whole function body is `parcel`. On a triangle, the compiler rejects that line for one chip and accepts it for three. What does the third chip buy?

## Two trades on a triangle

Draw a triangle with corners A, B and C. Pick a corner and send one chip along each edge touching it. You can also undo that move by taking one chip back along each edge. This is a *chip-firing* move. Sending a chip along just one of A’s two edges would be a different game.

Start with three chips at A. Fire A once. There is now one chip at each corner. Look at the chips at A and C from B’s point of view. They are exactly what firing B would have sent out, so undo a firing at B.

```text
                     A   B   C
Start                3   0   0
Fire A               1   1   1
Undo a firing at B   0   3   0
```

To see why one and two fail, give a chip at A a score of 0, a chip at B a score of 1, and a chip at C a score of 2. Firing A changes the total score by 3, firing B changes it by 0, and firing C changes it by −3. Every trade preserves the remainder modulo 3. One or two chips at B have a different remainder from the same chips at A. Three is the first positive count that passes that test, and the two moves above show it works.

## The parcel type in a function signature

In `std.divisor`, a *divisor* is an assignment of signed chip counts to vertices. `d.Class` gives the same type to assignments on the same graph when one can be reached from the other by reversible firings. Here A is vertex 0 and B is vertex 1.

```
import std.divisor as d

type Triangle = d.Graph(3, (d.Edge(0, 1), d.Edge(1, 2), d.Edge(2, 0)))
type AtA = d.Class(Triangle, d.At(0, 3))
type AtB = d.Class(Triangle, d.At(1, 3))

struct Parcel(Place: type) { payload: Box(String) }

fn deliver(sink parcel: Parcel(AtA)) -> Parcel(AtB) {
    parcel
}
```

The argument and return types both reduce to the same parcel type. `sink` transfers ownership of the box to `deliver`, and the caller receives that same box back. Change the `3` in both `d.At` calls to `1` and the return expression fails to type-check. The chip counts live in the type. A program that needs a transfer schedule with a nonnegative balance at every step has a further condition to check.

## Asking the compiler for the batch size

I can also leave the number out and ask `d.Order` for the smallest positive batch that works. This type family turns the answer into an array length.

```
type Slots {
    d.Period(let N) => [u8; N]
}

type Batch = Slots(d.Order(Triangle, d.At(0, 1), d.At(1, 1)))
```

`Batch` is `[u8; 3]`. Delete the edge between C and A, and A has just one neighbor. Firing A now sends a single chip straight to B, so the same `Batch` definition gives `[u8; 1]`. Separate A and B into different connected components and `d.Order` returns `d.Unbalanced`. No positive number of copies can change the total in either component.

The mathematics behind this is the *graph Jacobian*. On a connected graph, take all chip assignments whose counts sum to zero and identify assignments that differ by firings. The resulting group is the Jacobian. The difference between a chip at A and a chip at B is an element of this group. Its order is the number Jihoo exposes as `d.Period`. Baker and Norine develop the connection with divisors on algebraic curves. [Baker and Norine, *Riemann–Roch and Abel–Jacobi theory on a finite graph*](https://arxiv.org/abs/math/0608360)

The compiler finds the order using the graph Laplacian, a matrix that records how each firing changes the balances. You can do the triangle calculation on paper. Fix C’s firing count at zero and allow fractions for a moment. Moving one chip from A to B takes one third of a firing at A and one third of a reverse firing at B. Multiplying by three makes both counts whole and gives exactly the two moves in the table. Jihoo currently does this calculation for graphs with up to eight vertices and 32 edges.

The runnable example prints the minimum batch size. From a Jihoo checkout with the new compiler, run `jihoo run examples/divisor_classes.jh`. Try deleting `d.Edge(2, 0)` from the graph and running it again. The very same parcel makes it through, and the number on the last line drops from three to one. [Runnable example](https://github.com/jihoolang/jihoo/blob/e6850cef8a15e8a788983cf739452a5ab90dd33e/examples/divisor_classes.jh) · [How Jihoo computes divisor classes](https://github.com/jihoolang/jihoo/blob/e6850cef8a15e8a788983cf739452a5ab90dd33e/docs/language/divisor-classes.md)
