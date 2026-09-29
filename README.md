# Portfolio Risk & Analytics Lab

Phase 1 foundation only: a pure historical return engine, isolated server data adapters, explicit coverage/rate methodology and a persistent portfolio builder. Next.js App Router, TypeScript, Tailwind, Vercel Analytics, Zod, Vitest and Playwright. No Phase 2 performance metrics or charts are implemented.

```sh
npm ci
npm run dev
```

Node >=22; Vercel target Node 24.x. Inter fonts are served locally. The unofficial Yahoo candidate is local research only: enabled in `npm run dev`, tests and the provider smoke; a local production build needs `PORTFOLIO_LAB_LOCAL_YAHOO=1`; it is always disabled on Vercel. Deployed providers are added only through the code-reviewed [replacement-provider path](docs/DATA-PROVIDERS.md#replacement-provider-path).

```sh
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run test:e2e
npm run calendar:check  # also runs automatically before every build
npm run smoke:providers # opt-in real network / provider quota usage
```

Browser tests use installed Google Chrome; configure a Playwright Chromium installation if Chrome is unavailable. Routine tests stub only external HTTP at the UI boundary or inject synthetic provider responses. They exercise the real finance engine with fixed data/clocks.

The working plan remains [IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md); the canonical spec is unchanged. Read [methodology](docs/METHODOLOGY.md), [design evidence](docs/DESIGN-SYSTEM.md), [deployment](docs/DEPLOYMENT.md), and [execution evidence](docs/PHASE-1-PROGRESS.md).
