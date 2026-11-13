---
title: "Contradictions as Obstructions: Finding Wrong Claims in a Knowledge Base with Sheaves"
abstract: "We store every claim in a small knowledge base as a local section of a sheaf, so that a contradiction becomes an obstruction to gluing the claims into one global section, and blame goes to the claims with the largest residual under a robust (group-L1) fit. On synthetic people-and-places data this beats hand-written rules, mostly by catching contradictions that only show up around a cycle of relative claims. The more interesting findings are about where it breaks: the metric on the stalks decides who gets blamed in a tie, L1 recovery succeeds exactly when a median vote passes on every cut of the claim graph, and a cheap consensus step closes most of the gap to the exact L0 answer."
pubDate: 2026-11-13
authors: ["Jihoo"]
writtenWith: "Claude"
code: "https://github.com/jihoo12/know"
lang: en
---

## Introduction

A knowledge base collected from many sources will contradict itself. Detecting *that* it does is easy; deciding *which* claim is wrong is the hard part, and it gets harder when the evidence is indirect. "A was born 3 years before B", "B was born 2 years before C" and "A was born 10 years before C" are each perfectly plausible. Only the three together are impossible, and nothing about any single claim says which one to distrust.

Hand-written consistency rules handle the direct cases (two different birth years for the same person, an age that doesn't match a birth year) and miss the indirect ones unless someone writes a rule for that shape of inconsistency too. This draft tries the opposite approach: write down what each claim *means* as a linear map into a shared world state, and let one piece of linear algebra find every kind of inconsistency at once.

The natural language for "local pieces of data that should agree where they overlap" is a sheaf[^hansen][^robinson]. In that language a contradiction is an *obstruction*: the local sections can't be glued into a global one. The rest of the paper turns that slogan into a detector, measures it on synthetic data against rule-based baselines, and then spends most of its length on the question the first results raised: what exactly limits it?

## Model

**World state.** The quantities we want to recover are a birth year `birth[e]` for each person `e` and, for each year `t`, a city `city[e,t]`, encoded as a one-hot vector over 7 cities in 3 countries. Together these form the vector `z` we would like to reconstruct, a *global section*.

**Claims are local sections.** Each claim `c` gets a stalk `R^k`, a linear restriction map `A_c` from the world state into it, and an observed value `y_c`. The five claim types used here are:

| Claim | Meaning | Restriction map |
|---|---|---|
| `birth` | e was born in year y | `birth[e] = y` |
| `age` | in year t, e was a years old | `birth[e] = t − a` |
| `reldiff` | a was born d years before b | `birth[a] − birth[b] = d` |
| `city` | e lived in X from t₀ to t₁ | `city[e,t] = onehot(X)` for every t in the interval |
| `country` | in year t, e lived in country K | `M · city[e,t] = onehot(K)` |

`M` is the city-to-country map. A unit conversion (`age`), relative information (`reldiff`), time intervals (`city`) and coarsening (`country`) are all the same kind of object.

**Consistency, obstruction and gauge.** Stacking every claim gives one map `A` and one vector `y`. The claims are consistent exactly when `y ∈ im(A)`, and the size of the inconsistency is the norm of the obstruction, `‖y − proj_im(A) y‖`. On clean data it is exactly zero. The kernel of `A` is the ambiguity that no claim pins down. For a group of people known only relative to each other, for example, the whole group can be shifted in time without violating anything.

**Blame.** To decide which claims are wrong, we solve the robust fit

    minimise over z:   Σ_c ‖A_c z − y_c‖₂

a group-L1 objective that prefers to leave a few claims badly violated rather than many slightly violated. It is solved by iteratively reweighted least squares. Claims whose residual exceeds a threshold τ are flagged.

## Setup

The data is synthetic: 20 people, 14 with absolute birth information and 6 known only through relative claims (a cycle-rich cluster attached to the rest by a single bridge), about 250 claims in all. Each claim is corrupted independently with probability 5%, 10% or 20%. A corrupted number moves by 3 to 15 years; a corrupted place becomes a different city or country. Results are averaged over 20 seeds. Precision and recall are measured against the set of corrupted claims.

Baselines:

- **naive**: majority vote among claims about exactly the same slot (same kind, same person, same year).
- **rules**: hand-written conversions (age to birth year, city to country), and a relative claim is checked only when both people's birth years are known. No cycle reasoning.
- **rules+cyc** (added in the second experiment, to be fair): treats every birth-type claim as an edge in a graph, then repeatedly removes the claim that sits on the most inconsistent cycles, as in loop-closure outlier rejection for SLAM[^switchable], and finally re-admits removed claims that turn out to be consistent with the rest.

## Results

### Cycles come for free

At 10% corruption (P / R / F1, plus recall on two claim types):

| Method | P | R | F1 | `reldiff` recall | `country` recall |
|---|---|---|---|---|---|
| naive | 0.53 | 0.36 | 0.42 | 0.00 | 0.19 |
| rules | 0.65 | 0.72 | 0.68 | 0.40 | 0.66 |
| sheaf, raw `M` | 0.77 | 0.71 | 0.73 | 1.00 | 0.34 |
| **sheaf, isometric `M`, τ = 0.3** | **0.77** | **0.79** | **0.78** | **1.00** | **0.63** |

The clearest win is on relative claims: the sheaf detector finds every corrupted `reldiff`, while the rules find at most 40%. A cycle like the one in the introduction is invisible claim by claim and obvious as an obstruction. The rules would need a dedicated cycle check; here it falls out of the same least-squares problem as everything else. The trend is the same at 5% and 20% (F1 0.67 / 0.66 for rules, 0.79 / 0.74 for the sheaf). The recovered global section gets every anchored birth year right and 93.8% of the city slots that the claims actually determine.

### The metric decides who gets blamed

The raw and isometric rows differ only in how `M` is scaled, yet `country` recall goes from 0.34 to 0.63. With `M` as a plain 0/1 matrix, honouring a false country claim costs about √(1/3 + 1/2) ≈ 0.91 in the stalk norm, while violating it costs √2 ≈ 1.41. So in a one-against-one conflict between a city claim and a country claim, the fit always keeps the country claim and blames the city claim, even when the city claim is the true one.

Rescaling `M` to a partial isometry (`M Mᵀ = I`) makes both lies cost the same, and an undecidable one-against-one conflict then splits its residual evenly, about 0.5 each. That is the honest answer: the data cannot tell. A threshold below that (τ = 0.3) flags both sides of the tie, which is what the rule-based baseline does too.

The lesson is about design rather than tuning: **stalk inner products and restriction maps should be chosen so that equally large lies cost the same.** The root cause is that categories were relaxed into real vectors, which lets the fit use mixed and negative "cities" that a categorical model would never allow.

About 30% of corrupted country claims have no other claim about the same person and year, so no method can catch them from these claims alone. That caps achievable country recall at roughly 0.69, and the isometric sheaf is close to it.

### Against a fair baseline

Adding cycle checking to the rules closes some of the gap, but not as the error rate grows:

| Corruption | rules F1 | rules+cyc F1 | sheaf F1 |
|---|---|---|---|
| 5% | 0.67 | 0.75 | 0.79 |
| 10% | 0.68 | 0.70 | 0.78 |
| 20% | 0.66 | 0.66 | 0.74 |

On numeric claims alone, greedy cycle removal is nearly perfect at 5% (P 0.98 / R 0.99) and degrades at 20% (0.59 / 0.84), while the sheaf holds up (0.88 / 0.98). Greedy deletion makes one irrevocable choice at a time; the convex fit settles all cycles at once. An earlier reading of the first experiment, that the sheaf merely *unifies* rules without being any stronger, was wrong: with many errors it is stronger. As the next experiments show, though, "stronger than greedy" is not the same as "strongest".

### Prior knowledge is just another restriction map

"People usually live where they lived last year" can be added as soft pseudo-claims `λ·(city[e,t] − city[e,t+1]) = 0`, which are never themselves flagged. `λ` has a concrete meaning: the cost of one move. Accepting a one-year false city claim takes two moves (there and back), costing about 2λ·0.9, so once that exceeds the cost of one lie (≈ 0.91), roughly at λ ≳ 0.5, such claims start to be flagged. Too large a λ (≥ 1) starts calling real moves lies, and precision falls.

Choosing λ on seeds 0–19 and checking on held-out seeds 100–119, λ = 0.7 gives F1 0.90 / 0.85 / 0.82 at 5% / 10% / 20% corruption, up from 0.82 / 0.78 / 0.74 without the prior. Country recall reaches 0.81, above the 0.69 ceiling from before, because continuity brings in evidence from neighbouring years. Precision rises too (0.77 to 0.91), most likely because the prior suppresses the mixed relaxed vectors described above. (The rule baselines were not given an equivalent continuity rule.)

### What limits L1: a median vote on every cut

To see the decoder's limits clearly, the next experiment strips the problem down to numbers only: 20 people on a random d-regular graph, every edge a claim `x_u − x_v = d`, each corrupted with probability q. Success now means the flagged set is *exactly* the corrupted set. Four decoders are compared:
- **l1**: the sheaf objective, solved exactly as a linear program.
- **irls**: the same objective, solved by the code actually used above.
- **l0**: the fewest violated claims (maximum consensus), solved exactly as a mixed-integer program with an 8-second limit.
- **greedy**: the cycle-removal baseline.

| Degree | q | l1 (LP) | irls | l0 | greedy |
|---|---|---|---|---|---|
| 4 | 0.10 | 0.60 | 0.50 | 0.95 | 0.40 |
| 4 | 0.20 | 0.30 | 0.20 | 0.70 | 0.10 |
| 6 | 0.10 | 0.95 | 0.95 | 1.00 | 0.60 |
| 6 | 0.20 | 0.60 | 0.45 | 0.95 | 0.20 |
| 6 | 0.30 | 0.25 | 0.15 | 0.70 | 0.05 |
| 10 | 0.20 | 1.00 | 0.95 | 1.00 | 0.25 |
| 10 | 0.30 | 0.95 | 0.80 | 1.00 | 0.00 |
| 10 | 0.40 | 0.65 | 0.40 | 1.00 | 0.00 |

(For q ≥ 0.3 the integer program sometimes could not prove optimality in time; a solution that matched the truth still counted, so the l0 column is a lower bound. At degree 4 and q ≥ 0.3, the minimum explanation is often *smaller* than the true error set, and then no decoder can recover the truth.)

This structure resembles decoding by linear programming in compressed sensing[^candes], and it has an exact success condition. By LP duality and Hoffman's circulation theorem[^hoffman], the truth is an L1 optimum if and only if, for every cut (S, Sᶜ) of the claim graph,

    | #wrong cut edges pushing S up  −  #wrong cut edges pushing S down |  ≤  #clean cut edges

In words, **L1 is a median vote across every cut.** This was checked by brute force over all 8,191 cuts for 800 instances with 14 people. Every instance with positive margin was recovered by the LP (289 of 289), every one with negative margin failed (224 of 224), and ties went either way (96 of 287 recovered), with no exceptions.

The binding cut is usually a single vertex: 135 of 144 failures at q ≤ 0.2, though larger cuts appear as q grows (105 of 197 at q = 0.4). So the tolerable error rate is set not by a global property such as the graph's spectral gap but by **the redundancy of the least-supported fact**. Once half of the claims about one person are wrong in the same direction, that person is lost. A simple prediction that checks only single-vertex cuts matches the experiment for small q (degree 6, q = 0.1: predicted 0.91, observed 0.95) and is pessimistic for large q, because it counts ties as failures.

### Beyond L1: consensus

The table also shows that **L1 (a median) is not the best possible decoder; L0 (a mode) is far stronger.** Wrong values rarely agree with each other, so "the value most claims agree on" survives even when more than half the claims about a fact are wrong (degree 6, q = 0.2: 0.95 for l0, 0.60 for l1). Convex optimisation beats the greedy baseline, but not exact combinatorial consensus. Its advantage is polynomial time. The production IRLS solver also trails the exact LP a little, through ties and incomplete convergence (degree 10, q = 0.4: 0.40 against 0.65).

Two attempts to close the gap:

- **A nonconvex penalty (p = 0.5) does not help.** It is a local search started from the L1 solution and stays in the L1 solution's basin. On the full benchmark it leaves F1 unchanged (0.85 to 0.85 at 10%) and trades recall for precision, because it pushes ties to one side instead of splitting them.
- **L1-guided spanning-tree consensus does.** A spanning tree fixes every value, so one can sample random trees and keep the one violating the fewest claims, which is RANSAC[^ransac]. Pure RANSAC collapses as q grows, because the chance of drawing a clean tree, (1 − q)¹⁹, shrinks fast. Down-weighting the claims L1 flagged by 0.5 when sampling trees fixes both weaknesses. (A penalty of 1 just reproduces the L1 answer.)

Exact recovery on held-out seeds 500–549 (the 0.5 penalty was chosen on seeds 0–19):

| Degree | q | l1 | ransac | l1 + ransac |
|---|---|---|---|---|
| 4 | 0.20 | 0.26 | 0.54 | 0.58 |
| 6 | 0.20 | 0.74 | 0.82 | 0.96 |
| 6 | 0.30 | 0.22 | 0.18 | 0.68 |
| 10 | 0.30 | 0.76 | 0.20 | 0.98 |
| 10 | 0.40 | 0.50 | 0.02 | 0.90 |

On seeds 0–19, where the exact L0 is available, the hybrid is about as good (degree 6, q = 0.3: 0.75 against 0.70; degree 10, q = 0.4: 1.00 against 1.00) at under 0.1 s per instance. So far the hybrid is implemented only for scalar difference graphs, not for the vector stalks used for places.

### Sources: learned reliability and systematic bias

Finally, each claim is attributed to one of 8 sources: five good ones (3% random errors), two sloppy ones (40%), and one *biased* source that is careful (3%) but always reports ages one year too high, like a different age-counting convention. Overall about 12% of claims are randomly wrong and about 1.5% carry the convention offset. The detector is the full one from above (isometric, continuity λ = 0.7).

- **Reliability weights.** Source s's stalks are scaled by `w_s = logit(1 − ε_s)`, normalised to 1 at ε = 5%: lies from a reliable source cost more. The error rates ε_s are learned without ground truth by alternating four times between fitting, measuring each source's flag rate and re-weighting. This is similar in spirit to Dawid–Skene[^dawid] and truth-discovery methods[^truth].
- **Bias variables.** Each source gets one extra global variable `b_s`, age claims become `birth[e] − b_s = t − age`, and a weak prior `0.3·b_s = 0` keeps the variables at zero unless the data demands otherwise. A convention difference then becomes part of the global section, a learned transition map, instead of a stream of errors.

Held-out seeds 100–119 (P / R / F1 count random errors only; flagging a biased claim is not counted as a false positive):

| Method | P | R | F1 | Biased claims flagged | Birth-year accuracy |
|---|---|---|---|---|---|
| ignore sources | 0.85 | 0.84 | 0.84 | 0.93 | 0.968 |
| weights (learned) | 0.81 | 0.93 | 0.87 | 0.95 | 0.993 |
| weights (true ε) | 0.87 | 0.93 | 0.90 | 0.92 | 0.975 |
| bias variables | 0.86 | 0.83 | 0.84 | 0.00 | 0.986 |
| **bias + weights (learned)** | 0.85 | 0.94 | **0.89** | 0.00 | **0.996** |
| bias + weights (true ε) | 0.88 | 0.92 | 0.90 | 0.00 | 0.996 |

Two things stand out. First, **source reliability can be learned without labels** and lifts recall from 0.84 to 0.94, mostly by breaking one-against-one ties. Learned error rates come out at 0.44–0.48 for the sloppy sources (true 0.40) and 0.06–0.07 for the good ones (true 0.03). The small precision cost (0.85 to 0.81) is about the F1 gap to knowing ε exactly. Second, **a systematic bias can be absorbed rather than flagged.** Without bias variables, 93% of the biased source's claims are flagged: correctly as wrong, but their information is thrown away. With them, none are flagged, the learned offset lands within 0.1 of +1 on every held-out seed (95% on seeds 0–19), the other sources' offsets stay at zero, and the biased ages go back to being evidence. City accuracy barely moves under any method (around 0.85).

## Reproducing

Everything above comes from three scripts in [jihoo12/know](https://github.com/jihoo12/know), which need only NumPy and SciPy (`shell.nix` provides both):

| Command | Produces | Time |
|---|---|---|
| `nix-shell --run 'python sheafkb.py'` | Experiments 1–3: detection tables, obstruction norms, recovered section | ~20 s |
| `nix-shell --run 'python exp4_decoding.py'` | Decoder comparison, cut check, consensus | ~10 min (mostly the MILP) |
| `nix-shell --run 'python exp5_sources.py'` | Source reliability and bias | 1–2 min |

`python exp4_decoding.py consensus` prints only the consensus tables, in about a minute. The seeds are fixed, so the numbers should come out identical. When this draft was written, the first and third scripts and the consensus tables were rerun and matched; the MILP sweep and the cut check were not.

## Limitations

- **Everything is synthetic.** Claims arrive already structured. Turning real text into claims (the hardest step in practice, and a new source of errors in itself) is not addressed.
- **Categories are relaxed to real vectors.** This is behind the metric problem above, and the continuity prior partly papers over it rather than fixing it.
- **Errors are independent.** Both the cut condition and the L0 argument assume this; sources copying each other would break it.
- **Bias models are hand-chosen.** The *shape* of the bias ("a constant offset on ages") was given, not discovered.
- **The strongest decoder covers only part of the problem.** The L1 + consensus hybrid exists only for scalar claims.
- **The data is small.** The benchmark has 20 people, and the brute-force cut check needs n = 14 to enumerate every cut.

## Conclusion

Treating claims as local sections and contradictions as obstructions gives a single mechanism that handles conversions, relative claims, cycles, time intervals, priors and source biases, without a separate rule for each. That unification is real and useful. The more durable results, though, are about its limits. The stalk metric must make equally large lies cost the same. The L1 decoder at its heart is exactly a median vote on every cut, so its breaking point is set by the least-redundant fact. And a cheap consensus step guided by L1 recovers most of what exact L0 decoding would.

Natural next steps: extend the L1 + consensus hybrid to vector stalks; turn the cut margin into a per-fact diagnostic ("how many more claims would make this fact safe?"); handle correlated sources; choose bias shapes automatically; and run the pipeline on claims extracted from real text by a language model, extraction errors included.

[^hansen]: J. Hansen and R. Ghrist, "Toward a spectral theory of cellular sheaves," *Journal of Applied and Computational Topology*, 2019.
[^robinson]: M. Robinson, "Sheaves are the canonical data structure for sensor integration," *Information Fusion*, 2017.
[^switchable]: N. Sünderhauf and P. Protzel, "Switchable constraints for robust pose graph SLAM," *IROS*, 2012.
[^candes]: E. Candès and T. Tao, "Decoding by linear programming," *IEEE Transactions on Information Theory*, 2005.
[^hoffman]: A. J. Hoffman, "Some recent applications of the theory of linear inequalities to extremal combinatorial analysis," *Proceedings of Symposia in Applied Mathematics*, vol. 10, 1960.
[^ransac]: M. A. Fischler and R. C. Bolles, "Random sample consensus: a paradigm for model fitting with applications to image analysis and automated cartography," *Communications of the ACM*, 1981.
[^dawid]: A. P. Dawid and A. M. Skene, "Maximum likelihood estimation of observer error-rates using the EM algorithm," *Journal of the Royal Statistical Society, Series C*, 1979.
[^truth]: Y. Li et al., "A survey on truth discovery," *ACM SIGKDD Explorations Newsletter*, 2016.
