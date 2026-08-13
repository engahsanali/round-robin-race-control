# Architecture and release research

Research completed on 2026-08-13.

## Decision

Use React + TypeScript + Vite for Pro. It fits a client-first static application, direct browser APIs, mature visualization/motion testing, and Netlify's standard build-to-`dist` deployment. Next.js adds server/static-export boundaries that provide little value without server-rendered event routes, while SvelteKit offers no decisive advantage for this project's visualization ecosystem.

The Pro stack is React, TypeScript, Vite, Dexie/IndexedDB, Recharts, Motion, Vitest, Testing Library, Playwright, and `vite-plugin-pwa` with prompt updates.

The framework-independent domain core contains no React, DOM, storage, locale, or ambient randomness. Pro imports it normally. Solo is emitted as one committed, runtime-dependency-free `index.html`; verification checks that it has no network-bearing runtime references and behaves consistently with canonical fixtures.

Two Netlify projects link to the same public repository and use distinct package/base and publish directories. Each project gets its own production deploy and commit identity verification.

## Primary sources

- [Vite guide](https://vite.dev/guide/)
- [Netlify Vite guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/)
- [Netlify monorepos](https://docs.netlify.com/build/configure-builds/monorepos/)
- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports)
- [SvelteKit static adapter](https://svelte.dev/docs/kit/adapter-static)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Dexie TypeScript](https://dexie.org/docs/Typescript)
- [Recharts](https://recharts.github.io/en-US/api/ComposedChart/)
- [Motion accessibility](https://motion.dev/docs/react-accessibility)
- [Vite PWA update strategies](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors)
- [Vitest coverage](https://vitest.dev/guide/coverage)
- [Playwright browsers](https://playwright.dev/docs/browsers)
