# Deployment

## Phase 9: $0 production architecture

```
Browser → Portfolio Lab on Vercel (Next.js API routes)
            → Portfolio Lab Market Data API on Render Free (shared secret) → yfinance → Yahoo
            → FRED (Treasury, direct from Vercel)
```

Portfolio Lab is independent of every other project. Its market-data backend is its
own repository, `portfolio-lab-market-data` (FastAPI, Python), deployed as its own
Render free web service. Everything runs on free tiers: Vercel Hobby, one Render free
web service, FRED's public CSV and yfinance. No paid provider, no database, and **no
keep-warm job**: the Render instance sleeps when idle, by design.

### Environment

Vercel (Portfolio Lab; Production, and Preview if used):

| Variable | Value |
|---|---|
| `MARKET_DATA_SERVICE_URL` | `https://<your-service>.onrender.com` (https required, no trailing path) |
| `MARKET_DATA_SERVICE_KEY` | the shared secret, ≥ 32 characters |

Do **not** set `PORTFOLIO_LAB_LOCAL_YAHOO` on Vercel (it is ignored there anyway).
Nothing else is required: FRED needs no key, and Vercel Analytics is automatic.

Render (portfolio-lab-market-data web service):

| Setting | Value |
|---|---|
| Runtime / plan | Python · Free |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app:app --host 0.0.0.0 --port $PORT --proxy-headers --no-server-header` |
| Health check path | `/healthz` (public; reveals nothing) |
| `PYTHON_VERSION` | `3.12.8` |
| `PORTFOLIO_LAB_SERVICE_KEY` | the same shared secret (Render "secret" env var) |
| `MARKET_DATA_PREWARM` | optional; `0` disables the startup prewarm (default on) |
| `MARKET_DATA_PREWARM_TICKERS` | optional comma-separated prewarm list |

The repository's `render.yaml` Blueprint encodes these settings (the key is prompted,
`sync: false`). Generate the secret once with
`python3 -c "import secrets; print(secrets.token_hex(32))"`.

### First deployment checklist

1. Deploy `portfolio-lab-market-data` to Render with the settings above; confirm
   `GET /healthz` returns `{"status":"ok"}` and `GET /api/market-data/health` with the
   key returns `status: ok`.
2. Set the two Vercel variables and deploy Portfolio Lab.
3. On the deployed site: Analyze Sample Portfolio, visit every page, run Stress Lab
   and Generate allocation. Then run `npm run qualify:service` and
   `npm run smoke:providers` locally with the deployed service URL and key, and
   record the result in `config/deployed-providers.ts` (`deployedSmoke`).
4. Verify streaming and compression of a large analysis (MAX, 20 holdings) on
   Vercel, and add a Vercel Firewall rate-limit rule on `/api/*` (for example 30
   requests/minute/IP); the built-in limiter is per instance only.
5. Refresh the cached sample occasionally with `npm run sample:snapshot` (real data
   through the service) and commit `data/cached-sample.json.gz`.

### Cold starts and availability

The Render free instance sleeps after 15 idle minutes and loses its in-memory cache;
there is deliberately no keep-warm job. Instead:

1. When the landing page loads, Portfolio Lab sends a nonblocking wake request through
   its own server (`POST /api/market-data/status`); rendering never waits for it.
2. If Analyze is clicked before the service answers (within 1.2 s), the progress shows
   **Waking market-data service…**; each readiness check waits up to 45 s and a cold
   instance gets two (about 90 s in total).
3. Once the service answers, it continues automatically to **Loading historical
   prices…**. On wake, the service prewarms SPY, QQQ, IWM, BND and GLD in the
   background.
4. For the **sample portfolio only**, after 20 s of waking (or if waking fails) the
   visitor is offered **View cached sample**, labelled "Cached sample · Last
   refreshed <time>". It is never substituted automatically.
5. Custom portfolios always use real provider data or end in a typed unavailable
   state ("The market-data service did not wake up… nothing was substituted").

### Routes and timeouts

Every API route declares `maxDuration = 60`. Service calls time out at 50 s (history)
and 20 s (quotes); the readiness check waits at most 45 s. Market-data responses from
Render are gzip-compressed; Portfolio Lab's own API responses stream as before.

# Phase 1 runtime


User-confirmed target: Next.js App Router, TypeScript, Tailwind CSS, Vercel and Vercel Analytics. npm lockfile is authoritative. Development verified with Node 26.3.1; configure Vercel Node 24.x (supported Next.js Node >=22). No static export: provider calls require Node server functions.

Commands: `npm ci`, `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test -- --run`, `npm run build`, `npm run test:e2e`. Provider smoke is separate: `npm run smoke:providers`.

External data is accessed only by server utilities and routes. Browser requests contain portfolio inputs; no provider credentials. Vercel Analytics collects ordinary page analytics only; never attach holdings or configurations as custom events.

Process memory deduplicates requests and supplies a bounded development cache. Vercel's fetch data cache supplies shared successful-response caching. In-memory rate limiting is only a per-instance brake; public deployment must additionally enable Vercel Firewall rate limiting on /api/* (e.g. 30 requests/minute/IP) or configure a shared limiter. No persistent filesystem writes or database are required by the app. Snapshots are returned in-memory to the user; no durable server retention is claimed.

A successful local provider smoke does not qualify Vercel egress or public display rights. Yahoo can never run on Vercel (any `VERCEL*` system variable disables it); deployed equity history and quotes require an adapter registered with qualification evidence in `config/deployed-providers.ts`. Until then deployed equity analyses return `UNQUALIFIED_PROVIDER`; the official Treasury curve and CASH-only runs still work, and current quote failure never disables historical simulation.

`npm run build` runs the calendar guard (`prebuild`), so Vercel builds fail when the NYSE calendar artifact is tampered with or within 180 days of its coverage end. Analysis responses stream (no 4.5 MB buffered limit per Vercel's documentation; up to ~45 MB uncompressed for 20 holdings over ~46 years); after the first deployment, confirm streaming and CDN compression on a large run. No deployment is performed by Phase 1 implementation.
