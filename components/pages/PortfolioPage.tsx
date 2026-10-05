"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ETF_EXPOSURE_PROFILES,
  SECTORS,
  SECTOR_PROXIES,
  ETF_PROFILE_DATE,
  STOCK_CLASSIFICATION_DATE,
  STYLE_CELLS,
  type Sector,
  type StyleCell,
} from "@/config/exposureProfiles";
import {
  analyzeExposure,
  requiredSectorProxies,
  type Contribution,
  type UnclassifiedHolding,
} from "@/lib/analytics/exposure";
import { percent, unsignedPercent } from "@/lib/utils/format";
import {
  useHoldingFocus,
  focusHandlers,
  focusState,
} from "@/components/ui/HoldingFocus";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { openMethodology } from "@/components/methodology/MethodologyDrawer";
import { ResultTag, StaleResultNotice, withAnalysis } from "./shared";
import type { BacktestResult } from "@/lib/types/analytics";

type ProxyResult =
  | { ticker: string; available: true; return: number }
  | { ticker: string; available: false; reason: string };

const holdingReturn = (result: BacktestResult, ticker: string) => {
  const series = result.snapshot.prices.find((p) => p.ticker === ticker);
  const first = series?.observations.find((p) => p.date === result.initialDate);
  const last = series?.observations.find(
    (p) => p.date === result.metadata.effectiveEndDate,
  );
  return first && last ? last.adjustedClose / first.adjustedClose - 1 : null;
};

function ContributionRows({
  rows,
  profileLabel,
}: {
  rows: Contribution[];
  profileLabel: string;
}) {
  const focus = useHoldingFocus();
  return (
    <div className="exposure-drilldown">
      {rows
        .sort((a, b) => b.contribution - a.contribution)
        .map((row) => (
          <button
            key={row.ticker}
            type="button"
            {...focusHandlers(focus, [row.ticker])}
            data-focus={focusState(focus.focus, row.ticker)}
          >
            <strong>{row.ticker}</strong>
            <span>
              <small>Portfolio weight</small>
              {unsignedPercent(row.portfolioWeight)}
            </span>
            <span>
              <small>
                {row.kind === "etf" ? profileLabel : "Classification"}
              </small>
              {row.kind === "etf"
                ? unsignedPercent(row.profileWeight)
                : "Direct"}
            </span>
            <span>
              <small>Contribution</small>
              {unsignedPercent(row.contribution)}
            </span>
          </button>
        ))}
    </div>
  );
}

/** Holdings the stored snapshots cannot place, named with their weights so a gap
 * in the bars is visible rather than silent. */
function UnclassifiedList({
  holdings,
  what,
}: {
  holdings: UnclassifiedHolding[];
  what: "sector" | "style";
}) {
  if (!holdings.length) return null;
  return (
    <div className="unclassified-list">
      <p>
        Not classified by {what}:{" "}
        {holdings.map((h, i) => (
          <span key={h.ticker}>
            {i > 0 && ", "}
            <strong>{h.ticker}</strong> {unsignedPercent(h.weight)}
          </span>
        ))}
      </p>
      <small>
        {what === "sector"
          ? `Not in the stored stock snapshot (${STOCK_CLASSIFICATION_DATE}) or ETF profiles; leveraged and inverse funds are never looked through.`
          : `No style cell in the stored snapshots (${STOCK_CLASSIFICATION_DATE}); funds without a style category and stocks without valuation data stay outside the grid.`}
      </small>
    </div>
  );
}

const PortfolioBody = withAnalysis(function PortfolioBody({ result, status }) {
  const exposure = useMemo(
    () => analyzeExposure(result.config.holdings),
    [result.config.holdings],
  );
  const [sector, setSector] = useState<Sector>(() =>
    SECTORS.reduce((a, b) =>
      exposure.sectors[a] > exposure.sectors[b] ? a : b,
    ),
  );
  const [cell, setCell] = useState<StyleCell>(() =>
    STYLE_CELLS.reduce((a, b) =>
      exposure.styles[a] > exposure.styles[b] ? a : b,
    ),
  );
  const [proxies, setProxies] = useState<ProxyResult[]>([]);
  const focus = useHoldingFocus();
  const holdings = result.config.holdings.filter((h) => h.weight > 0);
  const risky = holdings.filter((h) => h.ticker !== "CASH");
  const largest = risky.reduce<(typeof risky)[number] | null>(
    (a, b) => (!a || a.weight < b.weight ? b : a),
    null,
  );
  const largestSector = SECTORS.reduce((a, b) =>
    exposure.sectors[a] > exposure.sectors[b] ? a : b,
  );
  // Sectors tied for largest are all named rather than picking one arbitrarily.
  const topSectors = SECTORS.filter(
    (s) =>
      exposure.sectors[s] > 0 &&
      Math.abs(exposure.sectors[s] - exposure.sectors[largestSector]) < 1e-9,
  );
  const missingSector = exposure.unclassified.filter(
    (h) => h.missing !== "style",
  );
  const missingStyle = exposure.unclassified.filter(
    (h) => h.missing !== "sector",
  );
  const unclassifiedSectorWeight = missingSector.reduce(
    (s, h) => s + h.weight,
    0,
  );
  const unclassifiedStyleWeight = missingStyle.reduce(
    (s, h) => s + h.weight,
    0,
  );
  const neededProxies = useMemo(
    () => requiredSectorProxies(exposure),
    [exposure],
  );
  useEffect(() => {
    if (!neededProxies.length) return;
    const controller = new AbortController();
    fetch("/api/sector-proxies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        tickers: neededProxies,
        startDate: result.initialDate,
        endDate: result.metadata.effectiveEndDate,
      }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r.ok) setProxies(r.value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [neededProxies, result.initialDate, result.metadata.effectiveEndDate]);
  const proxy = (s: Sector) =>
    proxies.find((p) => p.ticker === SECTOR_PROXIES[s]);
  return (
    <section
      className="results portfolio-xray"
      aria-labelledby="portfolio-title"
    >
      <SectionHeading
        number={1}
        eyebrow="Portfolio Exposure"
        id="portfolio-title"
        title="What you actually own."
        subtitle="A look-through of capital, sectors, and equity style before performance and risk."
        glyph="overview"
        aside={<ResultTag status={status} />}
      />
      <StaleResultNotice status={status} />
      <div className="xray-facts">
        <div className="xray-lead">
          <span>Analyzed allocation</span>
          <strong>{holdings.length}</strong>
          <em>positions</em>
        </div>
        <dl>
          <div>
            <dt>Risky allocation</dt>
            <dd>{unsignedPercent(1 - exposure.cash)}</dd>
          </div>
          <div>
            <dt>Cash</dt>
            <dd>{unsignedPercent(exposure.cash)}</dd>
          </div>
          <div>
            <dt>Largest holding</dt>
            <dd>
              {largest
                ? `${largest.ticker} · ${unsignedPercent(largest.weight)}`
                : "None"}
            </dd>
          </div>
          <div>
            <dt>Largest sector</dt>
            <dd>
              {topSectors.length
                ? `${topSectors.join(" / ")} · ${unsignedPercent(exposure.sectors[largestSector])}`
                : "None classified"}
            </dd>
          </div>
          <div>
            <dt>Sector concentration</dt>
            <dd>{unsignedPercent(exposure.sectors[largestSector])}</dd>
          </div>
          <div>
            <dt>Style classified</dt>
            <dd>{unsignedPercent(exposure.styleCoverage)}</dd>
          </div>
        </dl>
      </div>
      <div
        className="allocation-field"
        aria-label="Analyzed holdings by weight"
      >
        {holdings.map((h, i) => (
          <button
            key={h.ticker}
            type="button"
            {...focusHandlers(focus, [h.ticker])}
            data-focus={focusState(focus.focus, h.ticker)}
            style={{ "--weight": h.weight, "--index": i } as CSSProperties}
          >
            <span>{h.ticker}</span>
            <i aria-hidden />
            <strong>{unsignedPercent(h.weight)}</strong>
          </button>
        ))}
      </div>

      <SectionHeading
        number={2}
        eyebrow="Sector Lens"
        id="sector-lens-title"
        title="One portfolio. Eleven economic systems."
        subtitle="Stocks map directly. ETFs are split using stored look-through profiles."
        glyph="benchmark"
      />
      <div className="coverage-line">
        <span>Sector classification</span>
        <strong>{unsignedPercent(exposure.sectorCoverage)} of portfolio</strong>
        {exposure.fixedIncome > 0 && (
          <span>
            Fixed income{" "}
            <strong>{unsignedPercent(exposure.fixedIncome)}</strong>
          </span>
        )}
        {exposure.other > 0 && (
          <span>
            Other assets <strong>{unsignedPercent(exposure.other)}</strong>
          </span>
        )}
        {exposure.cash > 0 && (
          <span>
            Cash <strong>{unsignedPercent(exposure.cash)}</strong>
          </span>
        )}
        <span>
          Unclassified{" "}
          <strong>{unsignedPercent(unclassifiedSectorWeight)}</strong>
        </span>
      </div>
      <UnclassifiedList holdings={missingSector} what="sector" />
      <div className="sector-field">
        {SECTORS.map((s) => {
          const value = exposure.sectors[s];
          const p = proxy(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={sector === s}
              onClick={() => setSector(s)}
              style={{ "--sector-weight": value } as CSSProperties}
            >
              <i aria-hidden />
              <span>
                <strong>{s}</strong>
                <small>
                  {s} · {SECTOR_PROXIES[s]} proxy
                </small>
              </span>
              <b>{unsignedPercent(value)}</b>
              <em>
                {p?.available
                  ? `${SECTOR_PROXIES[s]} ${percent(p.return)}`
                  : "Sector proxy"}
              </em>
            </button>
          );
        })}
      </div>
      <div className="lens-detail" aria-live="polite">
        <div>
          <p className="eyebrow">Selected sector</p>
          <h3>{sector}</h3>
          <strong>{unsignedPercent(exposure.sectors[sector])}</strong>
          <span>
            {SECTOR_PROXIES[sector]} · sector proxy · same effective window
          </span>
        </div>
        <ContributionRows
          rows={[...exposure.sectorContributions[sector]]}
          profileLabel={`${sector} profile`}
        />
        {exposure.sectorContributions[sector].some(
          (c) =>
            c.kind === "stock" ||
            ETF_EXPOSURE_PROFILES[c.ticker]?.sectorSpecific === sector,
        ) && (
          <div className="security-proxy-compare">
            {exposure.sectorContributions[sector]
              .filter(
                (c) =>
                  c.kind === "stock" ||
                  ETF_EXPOSURE_PROFILES[c.ticker]?.sectorSpecific === sector,
              )
              .map((c) => {
                const sr = holdingReturn(result, c.ticker);
                const pr = proxy(sector);
                return (
                  <div key={c.ticker}>
                    <strong>{c.ticker}</strong>
                    <span>
                      Security return{" "}
                      <b>{sr === null ? "Unavailable" : percent(sr)}</b>
                    </span>
                    <span>
                      {SECTOR_PROXIES[sector]} proxy return{" "}
                      <b>
                        {pr?.available ? percent(pr.return) : "Unavailable"}
                      </b>
                    </span>
                    <span>
                      Relative return{" "}
                      <b>
                        {sr !== null && pr?.available
                          ? percent(sr - pr.return)
                          : "Unavailable"}
                      </b>
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <SectionHeading
        number={3}
        eyebrow="Style Map"
        id="style-map-title"
        title="The shape of the equity sleeve."
        subtitle="Portfolio Lab’s transparent 3×3 classification—not a third-party rating methodology."
        glyph="risk"
      />
      <div className="style-summary">
        <span>
          Equity style classified{" "}
          <strong>{unsignedPercent(exposure.styleCoverage)}</strong>
        </span>
        <span>
          Fixed income <strong>{unsignedPercent(exposure.fixedIncome)}</strong>
        </span>
        <span>
          Cash <strong>{unsignedPercent(exposure.cash)}</strong>
        </span>
        <span>
          Other assets <strong>{unsignedPercent(exposure.other)}</strong>
        </span>
        <span>
          Unclassified{" "}
          <strong>{unsignedPercent(unclassifiedStyleWeight)}</strong>
        </span>
      </div>
      <UnclassifiedList holdings={missingStyle} what="style" />
      <div className="style-axis style-axis-top">
        <span>Value</span>
        <span>Blend</span>
        <span>Growth</span>
      </div>
      <div className="style-layout">
        <div className="style-axis style-axis-side">
          <span>Large</span>
          <span>Mid</span>
          <span>Small</span>
        </div>
        <div className="style-grid">
          {STYLE_CELLS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={cell === name}
              onClick={() => setCell(name)}
              style={
                { "--cell-weight": exposure.styles[name] } as CSSProperties
              }
            >
              <span>{name}</span>
              <strong>{unsignedPercent(exposure.styles[name])}</strong>
            </button>
          ))}
        </div>
      </div>
      <div className="lens-detail style-detail">
        <div>
          <p className="eyebrow">Selected cell</p>
          <h3>{cell}</h3>
          <strong>{unsignedPercent(exposure.styles[cell])}</strong>
        </div>
        <ContributionRows
          rows={[...exposure.styleContributions[cell]]}
          profileLabel={`${cell} profile`}
        />
      </div>
      <div className="profile-provenance">
        <span>ETF profiles / {ETF_PROFILE_DATE}</span>
        <span>Stock snapshot / {STOCK_CLASSIFICATION_DATE}</span>
        <span>Classified / {unsignedPercent(exposure.styleCoverage)}</span>
        <button
          type="button"
          className="text-action"
          onClick={() => openMethodology("portfolio")}
        >
          How classification works ⓘ
        </button>
        <p>
          Stored profile snapshots are rounded approximations, not live
          constituent holdings. Unclassified weight is never renormalized away.
        </p>
      </div>
    </section>
  );
});

export function PortfolioPage() {
  return <PortfolioBody />;
}
