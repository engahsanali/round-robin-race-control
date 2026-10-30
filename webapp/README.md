# Round Robin Race Manager

Production: <https://round-robin-race-manager.netlify.app>

Current version: **1.1.0**

An installable race-day web app based on the verified Round Robin Excel templates. Every bracket saves independently, so two operators can safely run different brackets in separate tabs or devices at the same time.

## Features

- Four classes with six independent preliminary brackets each
- Automatic random draws using the tested Excel schedule libraries
- Touch-friendly winner entry with W/L records and shared rankings
- One name-based entry-fee table
- Manual finals and semifinals with editable car numbers
- Six independent rerace groups, including six unique pairings for four cars
- Independent per-bracket online saves through Netlify Functions and Blobs
- Safe simultaneous operation of different brackets
- Atomic same-bracket conflict protection with an explicit resolution choice
- Offline device copy, remote polling and activity history
- Private admin links, read-only public display links, JSON backups and CSV results

## Documentation

- [Project context](../PROJECT_CONTEXT.md)
- [Product requirements](docs/PRD.md)
- [Architecture and concurrency safety](docs/ARCHITECTURE.md)
- [Testing and release evidence](docs/TESTING.md)
- [Version history and screenshots](CHANGELOG.md)

## Commands

```text
pnpm install
pnpm test
pnpm build
```

Use `pnpm exec netlify dev` for the full local API. Run browser checks against the local server or the deployed site:

```powershell
$env:BASE_URL='https://round-robin-race-manager.netlify.app'
node scripts/e2e.mjs
pnpm test:concurrency
```

Use `pnpm exec netlify deploy --prod` for production, then repeat both E2E tests against the permanent URL.

The private admin link is the event credential. Store it securely. Public display links omit payment and audit data.
