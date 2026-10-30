# Round Robin Generator project context

## Current product

The active product is the Round Robin Race Manager web app in [`webapp/`](webapp/). It replaces the race-day workflow previously handled through the Excel workbooks while preserving the tested scheduling rules and familiar bracket terminology.

- Production: <https://round-robin-race-manager.netlify.app>
- Source repository: <https://github.com/engahsanali/round-robin-race-control>
- Current version: **1.1.0**
- Hosting: Netlify
- Storage: Netlify Blobs plus a local offline copy in the browser
- UI: React and TypeScript, built with Vite
- Server API: Netlify Functions

## Current release status

Version 1.1.0 was deployed on 11 September 2026. Each bracket now has an independent cloud record, revision, save queue, and conflict boundary. Bracket A and Bracket B can be operated in separate tabs or devices at the same time without one replacing the other.

Different brackets merge automatically. If two operators edit the same bracket at once, the first valid save succeeds and the stale save receives a conflict. The app then offers **Use saved bracket** or **Keep this tab** for that bracket only. All other brackets continue saving normally.

## Canonical documentation

- Product requirements: [`webapp/docs/PRD.md`](webapp/docs/PRD.md)
- Technical architecture: [`webapp/docs/ARCHITECTURE.md`](webapp/docs/ARCHITECTURE.md)
- Test and release evidence: [`webapp/docs/TESTING.md`](webapp/docs/TESTING.md)
- Version history and screenshots: [`webapp/CHANGELOG.md`](webapp/CHANGELOG.md)
- Developer setup: [`webapp/README.md`](webapp/README.md)

## Rules that must remain true

1. Each bracket saves independently.
2. Different brackets can run concurrently.
3. Same-bracket races use atomic revision checks and never silently overwrite data.
4. Event settings/payments cannot overwrite bracket state.
5. Duplicate competitor/owner names are permitted; car numbers identify cars inside a bracket.
6. Private event links contain the owner credential. Public display links must not expose payments, audit history, or owner credentials.
7. A production release is not complete until unit, build, standard E2E, and concurrency E2E checks pass against the permanent site URL.

## Where to start next time

Read this file, the PRD, architecture, and latest changelog entry before editing. Then inspect `webapp/package.json`, `webapp/src/types.ts`, `webapp/src/App.tsx`, `webapp/src/sync.ts`, and `webapp/netlify/functions/events.ts` for the live implementation.
