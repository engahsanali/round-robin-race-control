# Architecture and data safety

**Applies to:** v1.1.0

**Last updated:** 11 September 2026

## System shape

```text
Browser (React + local copy)
        |
        | HTTPS JSON API
        v
Netlify Function: events.ts
        |
        +-- event/<eventId>              event settings, fees, base document
        +-- auth/<eventId>               owner-key digest
        +-- group/<eventId>/<groupId>    one independent record per bracket
```

The client is a React/TypeScript single-page app built by Vite. Netlify serves the static files and runs `netlify/functions/events.ts`. Netlify Blobs is the durable store. The browser also stores a recent event copy and its owner key in local storage for offline continuity.

## Persistence boundaries

The central design rule is that a bracket is the smallest race-state save boundary.

| Change | Blob key written | Can run beside another bracket? |
|---|---|---|
| Bracket A roster/result/shuffle | `group/<eventId>/<bracketAId>` | Yes |
| Bracket B roster/result/shuffle | `group/<eventId>/<bracketBId>` | Yes |
| Finals or rerace group | Its own `group/.../<groupId>` key | Yes |
| Event name/settings/payments | `event/<eventId>` | Yes; never writes bracket state |

The base event document is retained for settings, payments, compatibility, and discovery. On read, the server hydrates it with the current independent group records. Legacy events without group records are migrated lazily from their embedded groups.

## API

- `POST /api/events` creates an event, owner key, base record, and initial group records.
- `GET /api/events/:id` returns a hydrated event. Supplying the valid owner key returns the private form; otherwise the public form is returned.
- `PUT /api/events/:id` conditionally saves event settings/payments/audit data only.
- `PUT /api/events/:id/groups/:groupId` conditionally saves one bracket only.

Private mutations require the owner key. Public reads remove payment and audit data.

## Concurrency protocol

Each group has a numeric `revision` (legacy groups default to 0). A group save includes the revision last read by that tab.

1. The function reads the current group record and its ETag.
2. It checks the submitted revision against the saved revision.
3. It writes with Netlify Blobs `onlyIfNew` for the first record or `onlyIfMatch` for an existing record.
4. A successful save increments the group revision.
5. If another write won the race, the stale request receives HTTP 409 and the latest saved bracket.

Two different brackets use different keys, so they do not contend. Two writers to the same bracket contend on one ETag, so only one stale-base write can win. This prevents silent last-write-wins data loss.

## Client synchronization

- The app tracks dirty state by `groupId`; event metadata uses the separate `$event` scope.
- Dirty scopes are saved independently, so one failed bracket does not hold up another.
- Every three seconds the client reads the latest hydrated event.
- Clean brackets are merged immediately.
- Locally dirty or conflicted brackets are protected from automatic replacement.
- A remote change to the same protected bracket opens the bracket-specific conflict banner.
- **Use saved bracket** accepts the cloud state. **Keep this tab** rebases the local bracket on the latest revision and resubmits it as a deliberate new edit.
- Audit entries are merged and de-duplicated by stable content identity.

The pure merge and revision helpers live in `src/sync.ts`; their regression tests live in `src/sync.test.ts`.

## Main implementation files

- `src/types.ts` — event, class, group, heat, fee, audit, and stored group types.
- `src/domain.ts` — scheduling and race-domain rules.
- `src/App.tsx` — application state, scoped autosave, polling, merge, and conflict UI.
- `src/store.ts` — API/local-storage access and typed conflict errors.
- `src/sync.ts` — revision-aware merge helpers.
- `netlify/functions/events.ts` — validation, authorization, hydration, and conditional writes.
- `scripts/e2e.mjs` — full user workflow regression.
- `scripts/concurrency-e2e.mjs` — simultaneous-bracket and conflict regression.

## Security controls

- The owner key is generated randomly, sent only through the private link/request, and stored server-side as a digest.
- All mutation routes verify the owner key.
- The public response excludes payments and audit history.
- Payload validation limits the accepted event structure and field lengths.
- Netlify headers deny framing, disable MIME sniffing, restrict referrers and browser permissions, and apply a same-origin content security policy.

## Local development and release

```powershell
cd webapp
pnpm install
pnpm test
pnpm build
pnpm exec netlify dev
```

The full E2E tests need a running Netlify API or a deployed URL:

```powershell
$env:BASE_URL='https://round-robin-race-manager.netlify.app'
node scripts/e2e.mjs
pnpm test:concurrency
```

Deploy the tested build from `webapp/` using the linked Netlify site. After production deployment, repeat both E2E tests against the permanent URL and record the result in `CHANGELOG.md` and `docs/TESTING.md`.
