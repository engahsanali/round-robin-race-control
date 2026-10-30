# Project working agreement

This repository contains the original spreadsheet work and the production Round Robin Race Manager web app in `webapp/`.

Before changing the web app, read these files in order:

1. `PROJECT_CONTEXT.md`
2. `webapp/docs/PRD.md`
3. `webapp/docs/ARCHITECTURE.md`
4. `webapp/CHANGELOG.md`
5. `webapp/docs/TESTING.md`

## Release discipline

- Use semantic versions in `webapp/package.json`.
- Update `webapp/CHANGELOG.md` for every production release. Record what was added, changed, fixed, or removed, the validation performed, and the production deploy identifier.
- Add representative release screenshots under `webapp/docs/screenshots/` and embed them in the changelog.
- Keep generated test artifacts under `webapp/artifacts/`; these are intentionally ignored by Git.
- Never store owner/admin keys, access tokens, or test credentials in source files, screenshots, or documentation.

## Non-negotiable product invariants

- A bracket is an independent save and concurrency boundary.
- Edits to two different brackets must never overwrite each other.
- Concurrent edits to the same bracket must be rejected atomically and surfaced for a human choice; never silently use last-write-wins.
- Event settings and payments are saved separately from bracket race state.
- Brackets with the same owner name are valid. Car numbers must remain unique inside a bracket.
- Preserve the existing main race, finals, rerace, fee, ranking, backup, CSV, offline, and public-display features unless the PRD is deliberately revised.

## Required validation

For a release candidate, run unit tests, build, the standard browser E2E test, and the deployed concurrency E2E test. Test both desktop and mobile layouts and inspect the release screenshots before calling the release complete.
