# Round Robin Dual-Netlify Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the verified monorepo under `engahsanali`, deploy Solo and Pro as two distinct public Netlify projects, independently verify both releases, sync the referenced Codex task, and email the verified links.

**Architecture:** GitHub `main` is the release source. Two Netlify projects use independent configuration and production deploys from the same commit. A release manifest records repository identity, commit, site IDs, deploy IDs, URLs, and verification results.

**Tech Stack:** Git, GitHub CLI/app, Netlify CLI/app, HTTP/browser checks, Gmail or Outlook connector.

## Global Constraints

- Repository owner is exactly `engahsanali`; repository visibility is public.
- Solo and Pro are different Netlify projects with different site IDs and production URLs.
- Do not claim GitHub publication, deployment, live behavior, task sync, or email delivery without independent read-back evidence.
- Never print or commit credentials/tokens.
- Email recipient is exactly `engahsanali@hotmail.com`.
- The referenced task is `019fc665-88f6-7c50-ae4e-1e8b1ab65fb7` on host `local`.

---

### Task 1: Public repository package and local release gate

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `.github/workflows/ci.yml`
- Create: `docs/RELEASE_CHECKLIST.md`
- Create: `release-manifest.json`
- Test: `scripts/verify-release.mjs`

**Interfaces:**
- Produces a public-safe repository and machine-readable release manifest.

- [ ] **Step 1: Write the failing release verifier**

Require both edition artifacts/builds, all test commands, creator credit, public-safe docs, no secret-like tracked files, no forbidden incomplete markers, clean worktree, and manifest fields `version commit repository solo pro verifiedAt`.

- [ ] **Step 2: Run it to prove failure**

Run: `node scripts/verify-release.mjs`  
Expected: FAIL because public docs/manifest are missing.

- [ ] **Step 3: Add public documentation and CI**

README leads with two edition choices, screenshots only if generated locally, features, privacy/local-only facts, accessibility, JSON interoperability, offline use, development commands, and both creator names. MIT license applies unless a dependency requires attribution; SECURITY provides private vulnerability-reporting instructions without promising unsupported response times.

CI runs install, typecheck, core tests, Solo verifier, Pro build/verifier, and browser smoke tests on pull requests and `main`.

- [ ] **Step 4: Generate the pre-deploy release manifest and run all gates**

Set release version `1.0.0`, local commit, intended repository `https://github.com/engahsanali/round-robin-race-control`, empty deploy fields labeled `pending`, and no secrets.

Run: `pnpm install --frozen-lockfile && pnpm check && node scripts/verify-single-file.mjs && pnpm --filter @rr3/pro build && node scripts/verify-pro-build.mjs && pnpm playwright test`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add README.md LICENSE SECURITY.md .github docs/RELEASE_CHECKLIST.md release-manifest.json scripts/verify-release.mjs
git commit -m "docs: prepare public dual-edition release"
```

### Task 2: GitHub publication and parity proof

**Files:**
- Modify: `release-manifest.json`

**Interfaces:**
- Produces public repository URL and verified local/remote commit parity.

- [ ] **Step 1: Verify scope and GitHub identity**

Run `git status -sb`, inspect all staged/untracked paths, run the secret scanner, check `gh auth status`, and switch the active GitHub CLI account to `engahsanali` only for this repository publication. Do not alter credentials for unrelated repositories.

- [ ] **Step 2: Create the public repository and push**

Create `engahsanali/round-robin-race-control` as public with source `.`, set `origin`, push the verified release branch, and merge to/push `main` through a reviewed non-interactive flow.

- [ ] **Step 3: Read back repository evidence**

Read repository owner/name/visibility/default branch, remote URL, remote `main` SHA, local `main` SHA, and branch protection/CI status where available. Require local and remote SHAs to match.

- [ ] **Step 4: Update manifest and commit/push**

Record repository URL, commit, `publishedAt`, and verification status. Re-run the release verifier, commit the manifest update, push, then re-read parity at the new commit.

### Task 3: Two Netlify production projects and live verification

**Files:**
- Modify: `release-manifest.json`

**Interfaces:**
- Produces Solo/Pro site IDs, deploy IDs, production URLs, dashboard URLs, and common release commit identity.

- [ ] **Step 1: Verify Netlify user/team and project-name availability**

Read the authenticated Netlify user and teams. Search for existing projects named like `round-robin-race-control`. If names collide, use stable suffixes `-solo` and `-pro` without repurposing unrelated projects.

- [ ] **Step 2: Create and deploy Solo**

Create `round-robin-race-control-solo`, configure public visitor access, build/publish from `single-file/`, and deploy the exact verified `index.html` to production. Record site and deploy IDs.

- [ ] **Step 3: Create and deploy Pro**

Create `round-robin-race-control-pro`, configure public visitor access, run the frozen Pro build, publish `apps/pro/dist/`, and record site/deploy IDs. The site IDs must differ.

- [ ] **Step 4: Connect continuous deployment**

Connect both projects to the public GitHub repository with their own package/base and publish settings, or install a verified GitHub Actions equivalent using Netlify encrypted secrets. Trigger no duplicate production deploys. Prove a harmless release-manifest commit is associated with the expected project configuration before calling sync complete.

- [ ] **Step 5: Verify both production sites independently**

For each production URL: HTTPS GET 200, expected title, creator credit, no starter copy, correct edition label, security headers, and deploy read-back. Browser-run a demo flow, built-in tests, registration, schedule activation, result, standings, export/import, theme/reduced-motion, 320px and desktop. For Solo, also download the live `index.html`, disconnect network, open locally, and run the embedded tests. For Pro, verify service worker/offline relaunch and presentation sync.

- [ ] **Step 6: Update manifest and push**

Record all site/deploy/dashboard URLs, IDs, verified commit, and timestamp. Re-run release verification and push the final manifest. Read back both projects again after the final push.

### Task 4: Referenced-task sync and verified email delivery

**Files:**
- No repository file changes unless verification uncovers a release defect.

**Interfaces:**
- Produces Codex task message evidence and Sent-mail evidence.

- [ ] **Step 1: Send the release handoff to the referenced task**

Use the Codex thread message tool for host `local`, thread `019fc665-88f6-7c50-ae4e-1e8b1ab65fb7`. Include repository URL, Solo URL, Pro URL, Netlify project identities, release commit, verification summary, privacy/local-only boundary, and the fact that this is a separate public project unrelated to Treadivo.

- [ ] **Step 2: Read back/wait for task receipt**

Read or wait on the referenced task and verify the release handoff is present. Do not ask that task to modify Treadivo or its Netlify account.

- [ ] **Step 3: Send completion email**

Send to `engahsanali@hotmail.com` with subject `Round Robin Race Control — Solo and Pro live links`. Body includes a concise introduction, labeled Solo/Pro playable links, repository link, offline/use distinction, creator credit, and public-sharing note.

- [ ] **Step 4: Verify Sent mail**

Search/read the sent message and confirm exact recipient, subject, and all three links. If only a draft exists, do not claim it was sent.

- [ ] **Step 5: Final completion audit**

Walk every requirement in the approved design, source specification, and updated goal against current files, test outputs, GitHub read-back, both Netlify read-backs, referenced-task receipt, and Sent-mail evidence. Only then mark the goal complete.
