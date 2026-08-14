# Meet Edition tournament and workbook research

Date: 2026-08-14

This note records the rules research and the direct inspection of the user's rough
`Round robin.xlsx` workbook that inform Meet Edition. It distinguishes a classic
pairwise round robin from this project's three-lane heat format.

## 1. What “round robin” means here

A classic single round robin schedules every pair of entrants exactly once. With an
even number of entrants this takes `n - 1` rounds, with every entrant playing once per
round; with an odd number, a dummy entrant produces one rotating bye. FIDE's official
[Berger tables](https://handbook.fide.com/files/handbook/C02Standards.pdf) implement
this construction and explicitly treat the highest pairing number as a bye when the
field is odd. FIDE's competition rules require round-robin pairings to follow Berger
tables unless a communicated restriction justifies an adjustment
([FIDE General Regulations, section 5](https://handbook.fide.com/files/handbook/Competition_Rules.pdf)).

Round Robin Race Control differs in one important way: a heat contains up to three
cars, so one heat creates three pairwise opponent encounters. The closest formal model
is the **social golfer problem**: partition entrants into equal groups in successive
rounds while avoiding repeated pairs. Dotú and Van Hentenryck define the violation for
a pair as `max(0, meetings - 1)` and improve schedules using swaps involving conflicts
([Scheduling Social Tournaments Locally](https://cs.brown.edu/research/pubs/pdfs/2006/Dotu-2006-SST.pdf)).
That is the correct primary fairness objective for three-lane heats.

Meet Edition therefore uses the following vocabulary:

- **bracket**: an independent field of cars with its own registration, schedule,
  results and standings;
- **round**: a set of heats in which a car appears at most once;
- **heat**: one race of two or three cars across lanes 1–3;
- **stage**: qualifier, semifinal or final;
- **meet**: the graph of independent brackets and advancement rules.

The workbook calls a round-sized block “MATCH” and an individual heat “ROUND”. The
application presents the clearer terminology above while retaining match/heat numbers
when importing existing event data.

## 2. Scheduling rules adopted

The hard constraints are:

1. A heat has distinct assigned cars and no more than three lanes.
2. A car appears no more than once in a round.
3. Total appearances differ by at most one; round byes differ by at most one.
4. A winner must be one of the cars assigned to that heat.
5. A deterministic seed produces byte-identical schedules and quality reports.

Among valid schedules, the engine compares quality lexicographically rather than
hiding trade-offs in a weighted score:

1. minimize opponent meetings beyond the first;
2. minimize the largest pair frequency;
3. minimize the worst per-car repeat burden;
4. minimize concentration of repeat burden and pair frequencies;
5. use order/rest only as a final tie-breaker.

This matches the conflict measure used in social-tournament research. A lower-bound
certificate is reported so the UI can say “certified optimal” only when the primary
objective actually reaches a proven bound; otherwise it says “best found” and shows
the gap.

Lane allocation is a separate post-processing problem. Treating car appearances and
heats as a bipartite multigraph permits an equitable three-colouring of appearances;
de Werra's result states that bipartite multigraphs have an equitable `k`-colouring
for every `k >= 2`
([An extension of bipartite multigraphs](https://doi.org/10.1016/0012-365X(76)90056-X)).
Here the three colours are lanes, so each heat receives one of each lane and every
car's lane counts can differ by at most one. Opponent selection is therefore not
traded away to repair lane balance.

## 3. Standings, ties and advancement

Round-robin competitions normally declare their scoring and ordered tie-break rules
before play. FIDE publishes separate round-robin tie-break measures, including direct
encounter, number of wins, Koya and Sonneborn-Berger, and explicitly distinguishes
whether qualification applies before or after selected tie-breaks
([FIDE Play-Off and Tie-Break Regulations](https://handbook.fide.com/chapter/TieBreakRegulations042024)).
FIDE competition formats also demonstrate the common pattern “independent round-robin
pools, top N qualify, then a final stage”
([Panamerican Team Championships, section 4.4](https://handbook.fide.com/chapter/D0303)).

Meet Edition applies the same governance principles to car racing:

- bracket standings use a configured, visible tie-break sequence;
- unresolved ties at an advancement cutoff are never broken silently by car number,
  stable ID, entry time or database order;
- the preview identifies automatic qualifiers, the tied cutoff group, remaining
  places, exclusions, destination capacity and duplicates;
- organisers may include the whole tied group, schedule a playoff, or make a manual
  selection with a required reason;
- confirmation stores an immutable advancement snapshot with source result versions;
- a later upstream result or correction marks dependent snapshots stale and blocks
  downstream advancement until an authorised review/reconfirmation;
- source lineage, actor, timestamp, before/after state and reason remain auditable.

This makes the requested three-qualifier-to-nine-car-final and
four-qualifier-to-two-semifinal-to-six-car-final formats instances of one directed
acyclic progression graph rather than special-case screens.

## 4. Workbook inspection

The workbook contains five sheets:

- `ENTRY COUNT`
- `Template 9`
- `Template 12`
- `Template 15`
- `FINALS!!!`

The useful interaction model is consistent across the schedule sheets: standings and
names on the left, coloured lane assignments and winner entry on the right, with a
separate finals sheet. `ENTRY COUNT` is a registration/payment ledger with multiple
class-entry columns, price groups, paid amount and balance. Meet Edition preserves
that dense left-to-right workbook feeling in a responsive single-page UI.

The exact schedule arrays already carried into Solo and Pro match the workbook. Their
independently recomputed properties are:

| Preset | Cars | Rounds | Heats | Appearances per car | Unique opponent pairs | Repeat excess | Max pair frequency | Raw max lane spread |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Template 9 | 9 | 4 | 12 | 4 | 36 | 0 | 1 | 4 |
| Template 12 | 12 | 5 | 20 | 5 | 50 | 10 | 2 | 5 |
| Template 15 | 15 | 6 | 30 | 6 | 57 | 33 | 2 | 6 |
| FINALS 15 | 15 | 5 | 25 | 5 | 61 | 14 | 2 | 2 |

Template 9 is especially strong: its 12 three-car heats create exactly 36 pair
encounters, equal to all `C(9, 2) = 36` possible pairs, so every pair meets exactly
once. The larger raw presets balance appearances but repeat some opponents and place
certain cars repeatedly in the same lane. Meet Edition retains exact presets for
compatible imports but favours the corrected deterministic optimiser and separate
equitable lane pass for new custom brackets.

The workbook also exposes risks that the hosted model removes:

- modern dynamic formulas (`LET`, `HSTACK`, `SORTBY`, `TAKE`, `SEQUENCE`, `REDUCE`)
  are version-dependent and did not evaluate in the portable inspection engine;
- whole-column `SUMPRODUCT` formulas mix labels, car identifiers and result cells;
- the entry sheet contains duplicated/typo-prone category headings (`OPEN`/`OLPEN`)
  and fixed `$10`/`$15` price assumptions;
- one observed row references `X11` as a price multiplier and another total multiplies
  by ten again, illustrating how copied formulas can silently diverge;
- the Template 15 standings area exposes a `MATCH 7` column while the schedule has six
  rounds;
- formulas do not provide user identity, role enforcement, concurrent edit protection,
  correction lineage or organisation isolation.

The application replaces cell position as identity with stable bracket-scoped IDs,
integer-cent accounting, configured prices, validated transactional writes and an
append-only audit. Car number reuse remains valid across brackets but not within the
same bracket.

## 5. Product consequences

The Meet workbook should feel familiar to the spreadsheet author while being safer:

- sticky meet toolbar and bracket index replace workbook tabs;
- each anchored bracket sheet keeps cars, heat grid, live winner control, standings
  and cutoff together;
- frozen headers/identity columns and table-contained horizontal scrolling preserve
  dense desktop operation without whole-page overflow;
- collapsed brackets render only a summary, keeping 15 brackets × 12 cars fast;
- mobile uses a bracket selector and persistent active-heat controls;
- progression is visible as qualifier → semifinal → final edges;
- connection/saving/conflict state is always explicit;
- print expands bracket sheets and adds progression, advancement and final summaries;
- all important actions are permission-checked again in PostgreSQL RLS/RPC functions.

The key rule is: **the spreadsheet remains the visual inspiration, while the database
and pure domain model become the source of truth.**
