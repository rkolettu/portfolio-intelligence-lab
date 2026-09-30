# Phase 8 · Visual and product polish

Scope: presentation and interaction only. No change to finance calculations, methodology, data providers, snapshots, construction algorithms, stress methodology or test fixtures. The only arithmetic added is display-level: risk minus capital in percentage points, spread between two plotted series, and the change between two already-computed model volatilities.

## Ten highest-impact changes
1. Depth-token surface system and one control/radius/border scale.
2. Sticky scroll-spy navigation with page-progress hairline.
3. Compact hero with a weight-node and candle motif that reacts to the builder.
4. KPI strips as label / value / context / micro-visual, with sign color.
5. Terminal-style chart panels: thin lines, dashed references, crosshair, data-panel tooltips, extrema and event markers.
6. Capital vs Risk: one bar morphs capital to risk with a ghost of the other value, hover delta bracket, headline insight, FLIP sort.
7. Correlation heatmap: row and column highlight, lifted cell, compact panel, pair cards.
8. Stress Lab: event tabs with window and return, timeline marker, ranked holding bars that glide.
9. Portfolio Constructor: current/proposed strips, before/after weight bars, quiet unchanged rows, delta chips, prominent Generate action.
10. Builder allocation strip with resolved / over / unallocated states.

## Verification
Unit tests 460 / 460 (7 new in `tests/components/visual.test.tsx`), Playwright 33 / 33 (4 new), lint and typecheck clean, production build passes. Reviewed at 1320, 1920, 1024, 820 and 390 px and with reduced motion; `scrollWidth` equals the viewport at every width.
