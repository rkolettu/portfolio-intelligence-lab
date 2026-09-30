# Portfolio Intelligence & Construction Lab

A multi-page portfolio analytics workspace. `/` is the portfolio builder; the report
lives on real routes: `/analysis/overview`, `/performance`, `/benchmark`, `/risk`,
`/rolling`, `/stress` and `/constructor`. The builder draft and the displayed analysis
live in one workspace provider in the root layout, so moving between pages never
refetches. Only the small builder draft (localStorage) and the tab's last analyzed
configuration (sessionStorage) are stored in the browser: a reload of an analysis page
re-runs that configuration through the server cache and returns to the same page,
while a deep link in a new tab is guided to the builder. Methodology is a drawer
available on every page.

Deployed market data comes from Portfolio Lab's own Market Data API
(`portfolio-lab-market-data`, a separate repository: FastAPI + yfinance on Render
Free), called only server-to-server with a shared secret; all finance calculations
stay in this TypeScript engine. The free service sleeps when idle; the landing page
wakes it without blocking, and Analyze shows "Waking market-data service…" when needed. See
[DATA-PROVIDERS.md](docs/DATA-PROVIDERS.md) and [DEPLOYMENT.md](docs/DEPLOYMENT.md).

Phases 1–6: a pure historical return engine, isolated server data adapters, explicit coverage/rate methodology, a persistent portfolio builder, and the performance layer (cumulative return, CAGR, volatility, Sharpe, Sortino, drawdown episodes, Growth of $10,000) and benchmark-relative analytics on one canonical aligned sample (beta, CAPM alpha, correlation, tracking error, information ratio, active return, geometric comparison, benchmark drawdown), target-weight risk decomposition on one canonical holding sample (covariance, correlation heatmap, MRC/CRC/PCR, Capital vs Risk, diversification ratio, concentration, arithmetic return contribution), full-window rolling volatility, beta and correlation (20/60/120 sessions), a Stress Lab of fixed historical windows plus a Custom Historical Window on its own request (target weights re-initialized at each event start, strict coverage), and a Portfolio Constructor on its own request. The constructor offers equal weight, inverse volatility, minimum variance and equal risk contribution under explicit long-only bounds and fixed CASH, on a Ledoit–Wolf shrinkage covariance, with certified solver diagnostics, turnover and in-sample retrospective current-vs-proposed comparisons. Its outputs are mathematical allocations, not recommendations. Next.js App Router, TypeScript, Tailwind, Vercel Analytics, Zod, Recharts, Vitest and Playwright. The Phase 7 polish and the optional AI layer are not implemented. Formulas: [METHODOLOGY.md](docs/METHODOLOGY.md).

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
npm run qualify:service # direct adapter vs market-data service, live
npm run sample:snapshot # refresh data/cached-sample.json.gz from real data
```

Local runs use the direct Yahoo research adapter unless `MARKET_DATA_SERVICE_URL` and
`MARKET_DATA_SERVICE_KEY` are set, in which case they use the service (an
`http://127.0.0.1` URL is allowed for a local service).

Browser tests use installed Google Chrome; configure a Playwright Chromium installation if Chrome is unavailable. Routine tests stub only external HTTP at the UI boundary or inject synthetic provider responses. They exercise the real finance engine with fixed data/clocks.

The working plan remains [IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md); the canonical spec is unchanged. Read [methodology](docs/METHODOLOGY.md), [design evidence](docs/DESIGN-SYSTEM.md), [deployment](docs/DEPLOYMENT.md), and [execution evidence](docs/PHASE-1-PROGRESS.md).
