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
