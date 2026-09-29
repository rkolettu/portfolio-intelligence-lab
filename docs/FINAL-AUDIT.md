# Final audit: V1 definition of done (spec §75)

Walked through on 2026-09-29 against the local production build (`PORTFOLIO_LAB_LOCAL_YAHOO=1 npm run start`) with live Yahoo (unofficial) history and FRED H.15. The sample portfolio was SPY 40 / QQQ 15 / IWM 10 / BND 20 / GLD 10 / CASH 5, 5Y, monthly rebalancing, SPY benchmark. Figures below are from that run. They describe local integration only; deployed-provider qualification is still open (see Limitations).

| # | Requirement | Where it is satisfied | Result |
| --- | --- | --- | --- |
| 1 | Open the application | Single page; hero, builder and settings render without a request | Pass |
| 2 | Load a sample portfolio immediately | Hero "Analyze Sample Portfolio" runs the sample in one click | Pass |
| 3 | Real historical total-return-aware performance | 01 Overview: adjusted closes, 1,253 daily returns, ending value $16,616 | Pass |
| 4 | Requested vs effective period | Overview facts: requested 2021-09-29 → 2026-09-29, effective → 2026-09-28, with today's bar excluded | Pass |
| 5 | Growth against a benchmark | 02 Performance: Growth of $10,000 vs SPY, with text summary and month-end data table | Pass |
| 6 | Cumulative return and CAGR | Overview metric strip (+66.16%, +10.70% over 5.00 calendar years) | Pass |
| 7 | Annualized volatility | Overview (12.90%, 1,253 daily returns) | Pass |
| 8 | Historically calculated Sharpe | Overview (+0.56, Historical Risk-Free DGS3MO) | Pass |
| 9 | Sortino | Overview (+0.80, full-sample downside deviation) | Pass |
| 10 | Beta, alpha, tracking error, IR, correlation | 03 Benchmark (0.73, −0.36%, 5.56%, −0.57, 0.97; plus R² and active return) | Pass |
| 11 | Exact benchmark-overlap sample | Benchmark facts: comparison period, 1,253 aligned observations, risk-free coverage | Pass |
| 12 | Maximum drawdown and recovery history | 04 Drawdowns: peak/trough/recovery dates, calendar and trading days, top-5 episode table | Pass |
| 13 | Holdings driving volatility | 05 Risk: MRC/CRC/PCR table; largest contributor SPY 51.63% | Pass |
| 14 | Capital weights vs risk contributions | 05 Risk: paired bar chart with text alternative; CASH shown as riskless | Pass |
| 15 | Covariance/correlation structure | 06 Diversification: correlation heatmap with accessible table and four-decimal hover | Pass |
| 16 | Diversification statistics | 06 Diversification: DR 1.21×, effective holdings 4.1, HHI, top-3, highest/lowest pair | Pass |
| 17 | Rolling volatility, beta, correlation | 07 Rolling: statistic and 20/60/120-session window selectors; full windows only | Pass |
| 18 | Major historical stress periods | 08 Stress Lab: GFC, COVID, 2022 rate shock, plus custom window | Pass |
| 19 | When stress results cannot be calculated | Unavailable/insufficient-coverage states covered by `tests/components/stress.test.tsx` and e2e | Pass |
| 20 | Current Treasury separate from historical risk-free | 10 Current Market: 3M–10Y reference with horizon highlight, labeled "Never enters historical results" | Pass |
| 21 | Methodology panel explaining every major calculation | Nine-topic drawer (Data … Numerics), header and section triggers; keyboard focus trapped and restored | Pass |
| 22 | Comfortable desktop and mobile use | e2e visual review at 390/768/1320/1920 px, no horizontal overflow; drawer checked at 375 px | Pass |
| 23 | Data-source and analysis metadata | 11 Methodology & data lineage: providers, snapshot SHA-256, coverage/fetch provenance, return ledger, assumptions | Pass |
| 24 | Compare current vs generated alternatives | 09 Constructor: four certified methods, turnover, model risk, in-sample and stress comparison | Pass |
| 25 | Construction outputs are not recommendations | Section tagline, in-sample and retrospective labels, and the §73 construction disclaimer | Pass |

## §73 disclaimers

Both appear verbatim:

- General disclaimer: `app/page.tsx` footer and the methodology drawer.
- Construction disclaimer: `components/construction/ConstructionSection.tsx` (`CONSTRUCTION_DISCLAIMER`), asserted in `tests/components/construction.test.tsx`.

## Automated evidence

- 453/453 unit and component tests (47 files); typecheck and lint clean; production build passes.
- 29/29 Playwright tests, including keyboard-only workflow, dialog focus trap, reduced motion, duplicate-request guard and multi-width visual review.
- Live provider smoke replays analysis, stress and construction exactly from their snapshots.

## Known limitations

- **Providers.** Yahoo is an unofficial local-research source and is disabled on Vercel. Deployed equity history and quotes need a qualified adapter (`config/deployed-providers.ts`). Until then, deployed equity analyses return `UNQUALIFIED_PROVIDER`.
- **Treasury timing.** FRED exposes revised history. Publication timing is modeled conservatively, but historical vintages are not point-in-time.
- **Rate limiting.** In-process limits are a per-instance brake only. A public deployment needs Vercel Firewall rules on `/api/*` or a shared limiter.
- **Payload size.** A 20-holding, 50-year analysis produces about 47.5 MB of lossless JSON. Computation takes about 1.1 s, so transfer size, not compute, is the constraint.
- **Model scope.** Results are in-sample and gross of costs and taxes, and carry selection and survivorship bias from today's holdings. Construction is retrospective.
