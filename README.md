# Round Robin Race Control

An offline-first, three-lane round-robin race event suite with two editions:

- **Solo** — one self-contained `index.html` with no runtime dependencies.
- **Pro** — an installable React PWA with local event history, a visual Schedule Lab, live race command, spectator presentation, standings, insights, finals, exports, and recovery.

Both editions keep event data on the current device and include deterministic scheduling designed to minimise repeated opponents while balancing appearances and lanes.

## Play online

- [Solo — one self-contained HTML file](https://round-robin-race-control-solo.netlify.app/)
- [Pro — installable advanced PWA](https://round-robin-race-control-pro.netlify.app/)

## Highlights

- Exact 9-, 12-, and 15-car presets plus deterministic custom schedules
- Lexicographic opponent-repeat optimisation with lower-bound certificates
- Three-lane race command, keyboard controls, corrections, reruns, undo, and audit history
- Competition, dense, and ordinal rankings with "Why this rank?" proofs
- Accessible charts, opponent matrix, lane balance, recent form, and finals analytics
- Tie-aware qualification, playoff/manual decisions, and guarded champion sealing
- Registration, payments, local autosave, JSON interchange, CSV Event Pack, replay, and recovery
- Dark/light/system themes, reduced-motion support, print layouts, and responsive 320px operation
- Offline PWA support in Pro; fully standalone offline HTML in Solo

## Run locally

### Solo

Open `single-file/index.html` directly, or serve the folder with any static server.

### Pro

```bash
pnpm install
pnpm --filter @rr3/pro build
pnpm --filter @rr3/pro test
pnpm test:pro:e2e
```

The production output is written to `apps/pro/dist`.

## Verification

```bash
pnpm check
node scripts/verify-single-file.mjs
node scripts/verify-pro-build.mjs
node --test scripts/verify-pro-build.test.mjs
```

## Privacy and operation

There is no account, backend, telemetry, or cross-device sync. Official event state is stored locally in the browser. Use the JSON export and Event Pack for portable backups.

## Credits

Made by Cesar Lacsamana and Ahsan Ali.
