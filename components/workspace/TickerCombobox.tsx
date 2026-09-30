"use client";
import { useId, useMemo, useRef, useState } from "react";

/** [ticker, name, kind]: kind "E" is an ETF, "S" a listed company. */
type Security = [string, string, "E" | "S"];

let directory: Promise<Security[]> | null = null;
/** The directory is a separate chunk, loaded the first time a ticker field is used. */
const loadDirectory = () =>
  (directory ??= import("@/config/securities.json").then(
    (m) => m.default as Security[],
  ));

const CASH: Security = ["CASH", "Cash · Historical Risk-Free (3-month Treasury)", "E"];

/** Ranked matches: ticker exact, ticker prefix, a name word starting with the
 * query, then any name substring; ties keep the directory's (size) order. */
function search(list: Security[], raw: string, limit = 7) {
  const q = raw.trim().toUpperCase();
  if (!q) return [];
  const scored: { s: Security; r: number; i: number }[] = [];
  const all = [CASH, ...list];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const name = s[1].toUpperCase();
    let r = -1;
    if (s[0] === q) r = 0;
    else if (s[0].startsWith(q)) r = 1 + s[0].length / 100;
    else if (q.length >= 2 && (name.startsWith(q) || name.includes(` ${q}`))) r = 2;
    else if (q.length >= 3 && name.includes(q)) r = 3;
    if (r >= 0) scored.push({ s, r, i });
  }
  return scored
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

/** The builder's ticker field as a combobox: type a ticker or a company / fund
 * name and pick from suggestions. Free entry still works for anything not in the
 * directory; the value is validated exactly as before. */
export function TickerCombobox({
  index,
  value,
  invalid,
  onChange,
}: {
  index: number;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [list, setList] = useState<Security[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => (list ? search(list, value) : []), [list, value]);
  // Nothing to suggest when the field already holds exactly the only match.
  const redundant = matches.length === 1 && matches[0][0] === value.trim().toUpperCase();
  const shown = open && matches.length > 0 && !redundant;
  const current = Math.min(active, Math.max(0, matches.length - 1));

  const ensure = () => {
    if (!list) void loadDirectory().then(setList);
  };
  const choose = (s: Security) => {
    onChange(s[0]);
    setOpen(false);
  };

  return (
    <div className="ticker-combo">
      <input
        ref={input}
        id={`ticker-${index}`}
        aria-label={`Ticker ${index + 1}`}
        aria-invalid={invalid || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown ? `${listId}-${current}` : undefined}
        value={value}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        placeholder="Ticker or name"
        onFocus={ensure}
        onChange={(e) => {
          ensure();
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            ensure();
            if (!open) setOpen(true);
            else setActive(Math.min(matches.length - 1, current + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(0, current - 1));
          } else if (e.key === "Enter" && shown) {
            e.preventDefault();
            choose(matches[current]);
          } else if (e.key === "Escape" && shown) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      <ul
        className="ticker-list"
        id={listId}
        role="listbox"
        aria-label={`Suggestions for ticker ${index + 1}`}
        hidden={!shown}
      >
        {shown &&
          matches.map((s, i) => (
            <li
              key={s[0]}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              onPointerDown={(e) => {
                // Keep focus in the field; select on press so blur cannot race it.
                e.preventDefault();
                choose(s);
              }}
              onPointerEnter={() => setActive(i)}
            >
              <b>{s[0]}</b>
              <span>{s[1]}</span>
              <i>{s[0] === "CASH" ? "Cash" : s[2] === "E" ? "ETF" : "Stock"}</i>
            </li>
          ))}
      </ul>
    </div>
  );
}
