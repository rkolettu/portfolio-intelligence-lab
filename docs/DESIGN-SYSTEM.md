# Portfolio design evidence

Inspected https://rishabkolettu.vercel.app/ and its public style.css on 2026-09-28, including the project index and project descriptions. The current live reference is **light**, despite the requested dark theme. This application follows the user's explicit dark-theme direction while preserving the reference identity.

Observed tokens: Inter/system sans; warm background #f4f1ea; text #171717; muted #5f5c56/#8d8880; blue #1d4ed8; 1px rules at 12–18% ink opacity; 1120px content width; uppercase 0.76rem labels with .085em tracking; simple text navigation; bold, tightly tracked headings; minimal decoration. Project sections use generous separation and horizontal rules, not a generic card grid.

Application adaptation: warm charcoal #171717 background, #1e1e1d surfaces, #f4f1ea foreground, muted warm gray, restrained blue focus/accent, 1px rules, 6px controls, compact numbered sections, 1200px analytical workspace. Use Inter with local font delivery, tabular numerals, responsive tables, visible keyboard focus, and reduced motion. Reduce hero scale and spacing to serve a working portfolio tool. No mechanical reuse of project layouts or claims.

## Phase 8 visual system (2026-09-29)

Presentation only: no methodology, calculation, data or fixture changes.

- **Depth tokens** (`app/globals.css`): `--bg` page, `--surface` primary, `--surface-2` raised (tooltips, active segment), `--inset` nested analytical surface (inputs, strips, tracks), `--surface-hover`. Borders: `--hairline` inside a surface, `--border` at its edge, `--border-strong` on hover. Radii 3 / 5 / 6 (marks, controls, surfaces). Control height 34 px (26 px compact). Motion 150 / 220 / 380 ms on one easing curve; reduced motion removes all animation and transition.
- **Panels**: charts, tables, KPI strips and context strips are 1 px bordered terminal panels with hairline dividers, not floating cards.
- **Typography**: Inter with tabular numerals everywhere; mono micro-labels (10 px, uppercase) for section numbers, strip labels and axis ticks; 22 px KPI values with sign color only where sign matters.
- **Finance-native motifs** (all decorative, `aria-hidden`, text-free): hero candles and weight nodes, per-section glyphs (`SectionGlyph`), KPI micro-visuals (`components/ui/motifs.tsx`), allocation strip, weight-move bars, event timeline.
- **Shared behavior**: `Segmented` (sliding thumb on native radios), `HoldingFocus` (hover a holding, highlight it in every related view), `useFlip` (rank/sort changes glide), `ChartTooltip` (terminal data panel), `Unavailable` (dashed panel with icon for intentionally absent results).
- **Chart palette** was re-validated on the `#181817` surface with the dataviz validator: all checks pass.

## Observatory art direction (2026-09-30)

Presentation only: no methodology, calculation, provider, route or data changes. One
read-only route (`/api/sample-digest`) serves a few kilobytes copied from the existing
cached sample for the landing chapters; it computes nothing new.

**Family DNA, re-derived from the portfolio projects** (portfolio site, Take-Home,
EDGAR, Signal Dash, Hold'em): Inter display at 650 weight and −0.06em tracking (now
Inter Variable so 650 is real), IBM Plex Mono for system labels, uppercase 10–11px
labels at ~.08em, `cubic-bezier(.22,1,.36,1)` settle and `(.65,0,.35,1)` travel curves,
12–18% ink hairlines, huge chapter numerals that fill as they become active, and Signal
Dash's on-ink palette (`#8fb0ff` accent from the family `#1d4ed8`, `#84ceaa` / `#ec8074`
signs). Principles carried over rather than motifs: data that moves only when it means
something, objects that sit on a surface, compact instrument readouts.

**Signature systems** (`components/observatory/`):

- **Portfolio Constellation** — node area = capital weight; deterministic golden-angle
  layout with fixed separation passes (same portfolio, same picture); CASH held on the
  axis outside the risky system. A small spring system (one rAF loop writing
  transforms, asleep when settled or off-screen) settles nodes, drifts them 1–2 px on
  the landing only, and sends a hover ripple whose strength at each node is that pair's
  |correlation| when known. Lays out in measured pixels so labels never scale.
- **Risk Shadow** — each node's offset outline is its share of risk; the offset grows
  with |risk − capital|. Risk mode makes the shadow solid and ghosts capital. The same
  idea on Capital vs Risk bars: "Shadow" view peeks risk out from under capital; "Risk"
  view slides it away and ghosts capital.
- **Market Spine** — one rail, many meanings: rebalance calendar (landing), monthly
  wealth candles (overview/performance, grouped from the engine's wealth path), monthly
  relative marks (benchmark), capital over risk (risk), rolling-window brackets, event
  slices that compress toward the selected event (stress), current vs proposed
  allocation (constructor). Marks re-assemble when meaning changes; a slow read-head
  scans while idle and the pointer takes it over.
- **Security Dossier** — any ticker chip opens a compact floating panel with capital,
  risk share, Δ, volatility, beta, strongest correlation and monthly adjusted-close
  candles; only fields the analysis holds appear. Opening it focuses that holding
  everywhere.
- **Financial Lens** — the growth chart cursor is a bracketed inspection band with a
  measuring scale; the readout adds the portfolio's drawdown at that session.
- **Construction field** — the current geometry appears first, then nodes migrate to
  the selected method's weights; the previous allocation stays as a dashed ghost and
  risk shadows move to the proposal's model risk.
- **Market data engine** — the Analyze progress is a status panel with only the stages
  the app actually knows (wake only if it happened; one request step), a true elapsed
  clock, and an activity rail that never implies a percentage. Docked so it is visible
  from the hero.

**Landing** is one continuous machine: a sticky stage (constellation + spine) while
chapters Portfolio → Capital → Performance → Relationship → Risk → Stress →
Construction scroll past; chapters 02–06 are labelled as the cached sample. The stage
docks beside the builder and follows the draft live. Under 960px the stage becomes a
sticky band that reserves no flow height and steps aside for the builder.

**Material**: a single fixed 5%-opacity grain layer (static SVG noise) over the ink
background. **Motion**: transforms/opacity; all ambient motion (drift, scan, ripple,
rails) stops under `prefers-reduced-motion`.

### Paper theme (2026-09-30)

Portfolio Lab now uses the portfolio site's own light palette rather than an on-ink
adaptation: `--bg #f4f1ea`, `--surface #fbfaf7`, `--text #171717`, muted `#5f5c56`,
accent `#1d4ed8`, positive `#287252`, negative `#a43e39`, hairlines at 7–20% ink, and
shadows in the family's warm `rgba(36, 31, 24, …)`. Chart series: portfolio `#1d4ed8`,
benchmark `#c2552a`, proposed `#287252`. The correlation heatmap diverges blue ↔ red
around a warm neutral `#ebe6dd`, darkening away from zero, with cell ink chosen for
≥ 4.5:1 contrast. Constellation pucks are paper discs with ink rims; the grain layer
is ink noise at low opacity.

### Play layer (2026-10-01)

Drawn from Wise (an instrument you can use immediately), Stripe (pulses on grid
lines, words that ink in), Mercury (tactile cards with depth), Column (reactive dot
fields) and Ramp (rolling figures), kept in the paper/ink/blue system:

- **Risk Mixer** (landing chapter 04): sliders per holding that always sum to 100%.
  σ and each risk share are recomputed live with the engine's unmodified
  `riskContributions` on the cached sample's stored annual covariance; the stage's
  pucks and shadows follow, positions anchored to the sample. "Load this mix into
  the builder" turns play into a real analysis. Labelled exploratory.
- **Grab and throw**: any constellation node can be dragged (mouse/pen) through the
  others, which collide and are shoved, then springs home with its release velocity.
  A press without movement is still a click; touch keeps scrolling.
- **Odometers**: chapter figures and σ roll digit by digit.
- **Surfaces**: a cursor spotlight on panels, tilt + glare on feature cards, magnetic
  primary buttons; one rAF-throttled document listener, mouse only.
- **Atmosphere**: a dot field behind the hero that swells and tints under the cursor
  (draws only on pointer movement), chapter copy that inks in word by word, a light
  streak along a chapter's rule as it activates, and a slow pulse along the stage
  baseline.

Everything above is off under `prefers-reduced-motion`.
