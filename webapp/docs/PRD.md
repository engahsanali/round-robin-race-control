# Product requirements document

**Product:** Round Robin Race Manager

**Current release:** 1.1.0

**Last updated:** 11 September 2026

**Status:** Production

## 1. Purpose

The app lets a race organiser set up, run, score, and publish a multi-class round-robin race meeting without managing many Excel tabs. It must be quick enough for race-day use, safe when more than one bracket is operated at once, and understandable to volunteers with little technical experience.

## 2. Primary users

- **Race organiser:** creates the event, entries, brackets, finals, reraces, and fees.
- **Bracket operator:** records competitors and winners for one bracket during racing.
- **Public viewer:** follows the published draw, records, and rankings without seeing private payment or audit data.

## 3. Core workflow

1. Create an event and keep the private admin link secure.
2. Enter cars into any of four classes and six preliminary brackets per class.
3. Generate or shuffle the scheduled matchups.
4. Run Bracket A, Bracket B, or any other bracket independently, including from different tabs/devices.
5. Tap the winner for each heat; the app updates W/L records and ranking.
6. Run manual finals and reraces when needed.
7. Track entry fees by owner name, export results, create a backup, or share the read-only public link.

## 4. Functional requirements

### 4.1 Events and access

- Create a private event with an unguessable event ID and owner key.
- Restore the owner key from the private link or the same browser's local storage.
- Provide a read-only public display link.
- Exclude payment details, activity history, and owner credentials from public responses.
- Keep a local browser copy so temporary network loss does not erase race-day input.

### 4.2 Classes, brackets, and entries

- Support four main classes and six preliminary brackets per class.
- Support the corresponding finals groups and six rerace groups.
- Allow multiple cars owned by the same person, including within one bracket.
- Require unique car numbers inside a bracket.
- Accept bracket operation even when another bracket is empty or has not started.
- Allow Bracket B to start later without blocking or resetting completed Bracket A data.

### 4.3 Scheduling

- Generate the requested number of rounds using the established schedule library.
- Avoid repeated pairings where the available competitors and requested heats permit it.
- Preserve the requested number of rounds when repeats are mathematically unavoidable.
- Treat finals as a fresh stage, where repeat matchups are permitted.
- Allow finals car numbers to be edited because cars are renumbered for finals.
- For a four-car rerace, produce three head-to-head rounds with six unique pairings.
- For five or more rerace cars, use the standard three-round scheduling behaviour.

### 4.4 Race operation and ranking

- Present touch-friendly heat cards and winner controls.
- Record one winner and one loser per completed heat.
- Show total W and L records rather than a wide column for every round.
- Keep ranking visible and do not show a qualification column.
- Allow a result to be corrected without corrupting the remaining schedule.
- Provide a tie/rerace workflow rather than forcing an incorrect ranking decision.

### 4.5 Fees and exports

- Tally entry quantities and amounts into one owner-based fee table.
- Aggregate repeated owner names into one payment row while retaining all of their cars.
- Support the separate $15 entry workflow.
- Export results as CSV.
- Export and import a JSON event backup.

### 4.6 Independent saving and simultaneous operation

- Treat every bracket/group as an independent persistence record.
- Save a change only to the bracket that changed.
- Allow different brackets to save concurrently without conflicts or data loss.
- Poll for remote changes and merge untouched brackets into the current screen automatically.
- Track a monotonic revision number for each bracket.
- Reject a stale same-bracket save atomically with HTTP 409.
- When the same bracket changes elsewhere, show a bracket-specific warning with two explicit choices:
  - **Use saved bracket:** discard this tab's stale bracket and load the saved bracket.
  - **Keep this tab:** rebase this tab's bracket on the latest revision and save it deliberately.
- Keep every other bracket available and saving while one bracket awaits a conflict decision.
- Save event settings and payments independently so they cannot replace bracket results.

## 5. Usability requirements

- Work on desktop, tablet, and phone without horizontal page scrolling in the primary workflow.
- Keep save state visible: Saved, Saving, Offline copy, or Save conflict.
- Use plain race terminology: class, bracket, heat, winner, W, L, finals, and rerace.
- Use clear colour and text together; colour alone must not communicate status.
- Keep critical controls usable by keyboard and labelled for assistive technology.

## 6. Reliability and security

- Use conditional writes for all cloud mutation paths that can race.
- Validate event and bracket payload shape and size at the API boundary.
- Return 401 for invalid or missing owner credentials.
- Never put owner keys in public responses, repository files, logs, documentation, or screenshots.
- Apply a restrictive content security policy and deny framing.
- Preserve a local copy when the network is unavailable and resume saving when possible.

## 7. Acceptance criteria

The release is accepted only when all of the following are true:

- Unit tests cover scheduling, owner-name fee aggregation, group revisions, and merge rules.
- The production build completes without TypeScript or bundler errors.
- The standard production E2E workflow passes on desktop and mobile.
- Two tabs can enter and save different brackets simultaneously, then record a winner in both; both rosters and results remain present.
- Two simultaneous writes to one bracket produce exactly one success and one conflict.
- The conflict can be resolved in the UI without affecting another bracket.
- An unauthorised group update returns 401.
- Browser test runs report no console errors.
- Release screenshots are inspected and stored with the changelog.

## 8. Out of scope for 1.1.0

- User accounts, roles beyond owner/viewer, or password recovery.
- Real-time push/WebSocket updates; current synchronization uses a three-second poll.
- Automatic knockout seeding or qualification decisions.
- Payment processing.
- Editing one bracket collaboratively character-by-character; concurrent same-bracket edits require a conflict choice.
