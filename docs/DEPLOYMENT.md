# Phase 1 runtime

User-confirmed target: Next.js App Router, TypeScript, Tailwind CSS, Vercel and Vercel Analytics. npm lockfile is authoritative. Development verified with Node 26.3.1; configure Vercel Node 24.x (supported Next.js Node >=22). No static export: provider calls require Node server functions.

Commands: `npm ci`, `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test -- --run`, `npm run build`, `npm run test:e2e`. Provider smoke is separate: `npm run smoke:providers`.

External data is accessed only by server utilities and routes. Browser requests contain portfolio inputs; no provider credentials. Vercel Analytics collects ordinary page analytics only; never attach holdings or configurations as custom events.

Process memory deduplicates requests and supplies a bounded development cache. Vercel's fetch data cache supplies shared successful-response caching. In-memory rate limiting is only a per-instance brake; public deployment must additionally enable Vercel Firewall rate limiting on /api/* (e.g. 30 requests/minute/IP) or configure a shared limiter. No persistent filesystem writes or database are required by the app. Snapshots are returned in-memory to the user; no durable server retention is claimed.

A successful local provider smoke does not qualify Vercel egress or public display rights. Yahoo can never run on Vercel (any `VERCEL*` system variable disables it); deployed equity history and quotes require an adapter registered with qualification evidence in `config/deployed-providers.ts`. Until then deployed equity analyses return `UNQUALIFIED_PROVIDER`; the official Treasury curve and CASH-only runs still work, and current quote failure never disables historical simulation.

`npm run build` runs the calendar guard (`prebuild`), so Vercel builds fail when the NYSE calendar artifact is tampered with or within 180 days of its coverage end. Analysis responses stream (no 4.5 MB buffered limit per Vercel's documentation; up to ~45 MB uncompressed for 20 holdings over ~46 years); after the first deployment, confirm streaming and CDN compression on a large run. No deployment is performed by Phase 1 implementation.
