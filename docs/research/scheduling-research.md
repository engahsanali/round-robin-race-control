# Three-lane scheduling research

Research completed on 2026-08-13 for the arbitrary-entrant generator.

## Adopted algorithm

Model every three-lane heat as a three-element set. Hard constraints are distinct entrants per heat, balanced total appearances, at most one appearance per entrant per match, and balanced byes.

The opponent objective minimizes, in order:

1. Total meetings beyond the first, `sum(max(0, pairCount - 1))`.
2. Maximum pair frequency.
3. Worst per-entrant repeat burden.
4. Sum of squared repeat burdens.
5. Sum of squared pair frequencies.

Construction begins with a seeded cyclic schedule that is always valid. A deterministic multi-start min-conflicts/tabu search applies cross-heat swaps and three-cycles, using fixed iteration and stagnation limits. Wall-clock termination is forbidden because identical inputs must reproduce identical output.

Lane assignment happens after opponent groups are fixed. A deterministic equitable edge-colouring pass targets lane-count spread no greater than one for every entrant.

The quality report includes a repeat-excess lower bound and maximum-pair-frequency lower bound. A lower-bound hit can be reported as optimal; a higher score is “best found” with a visible gap.

## High-value test cases

- Three entrants with many heats: forced repeats and lane cycling.
- Four entrants/four heats: all four triples and a lower-bound hit.
- Seven entrants/seven heats: a zero-repeat Steiner triple design.
- Nine and fifteen entrants: resolvable triple-system gold standards.
- Five, ten, and eleven entrants: appearance remainders and rotating byes.
- Over-capacity schedules: honest repeat gap.
- Same seed byte-identical; different seeds preserve every invariant.
- Relabeling/permutation metamorphic checks.
- Large field performance with a fixed no-hang budget.

## Primary sources

- Dotu and Van Hentenryck, [Scheduling Social Golfers Locally](https://cs.brown.edu/research/pubs/pdfs/2006/Dotu-2006-SST.pdf)
- de Werra, [Equitable colorations of graphs](https://doi.org/10.1016/0012-365X(76)90056-X)
- [Doubly resolvable Steiner triple systems](https://arxiv.org/abs/1501.02502)
- [Greedy scheduling and clique-factor bounds](https://arxiv.org/abs/2007.10704)
