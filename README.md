# Round Robin Race Manager

Race-day web app for running independent preliminary brackets, finals, reraces, rankings, and owner-based entry fees.

- Production: <https://round-robin-race-manager.netlify.app>
- Current version: **1.1.0**
- Application source: [`webapp/`](webapp/)
- Project context: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)
- Product requirements: [`webapp/docs/PRD.md`](webapp/docs/PRD.md)
- Architecture: [`webapp/docs/ARCHITECTURE.md`](webapp/docs/ARCHITECTURE.md)
- Release history: [`webapp/CHANGELOG.md`](webapp/CHANGELOG.md)
- Test evidence: [`webapp/docs/TESTING.md`](webapp/docs/TESTING.md)

Each bracket saves independently. Different brackets can run safely in separate tabs or devices. Concurrent edits to the same bracket use atomic conflict protection instead of silent overwrites.

## Development

```powershell
cd webapp
pnpm install
pnpm test
pnpm build
```

Run the production browser checks with:

```powershell
$env:BASE_URL='https://round-robin-race-manager.netlify.app'
node scripts/e2e.mjs
pnpm test:concurrency
```

The private admin link is the event credential. Never commit owner keys, access tokens, test credentials, generated artifacts, or local environment files.
