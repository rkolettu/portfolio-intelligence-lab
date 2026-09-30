// Display formatting only: calculations always keep full precision.
// Every formatter uses signDisplay "negative" or "exceptZero", so a value that rounds
// to zero never prints a minus sign ("-0.00%", "-0%", "-$0.00").
const cache = new Map<string, Intl.NumberFormat>();
const nf = (options: Intl.NumberFormatOptions) => {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", options);
    cache.set(key, f);
  }
  return f;
};

/** Signed return-like percentage to two decimals: "+12.34%", "-3.17%", "0.00%". */
export const percent = (value: number) =>
  nf({
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
/** Non-negative statistics (volatility, weights) carry no plus sign. */
export const unsignedPercent = (value: number) =>
  nf({
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "negative",
  }).format(value);
export const money = (value: number) =>
  nf({
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    signDisplay: "negative",
  }).format(value);
export const wholeMoney = (value: number) =>
  nf({
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    signDisplay: "negative",
  }).format(value);
/** Unitless ratio (Sharpe, Sortino, information ratio) to two decimals, signed. */
export const ratio = (value: number) =>
  nf({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
/** Plain two-decimal coefficient (beta, correlation, R²): minus sign only. */
export const decimal = (value: number) =>
  nf({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "negative",
  }).format(value);
/** Fixed decimals without locale grouping and without a signed zero. */
export const fixed = (value: number, digits: number) => {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
};
/** Percentage points with an explicit sign (arithmetic contributions, active return). */
export const percentagePoints = (value: number) => {
  const magnitude = Math.abs(value * 100).toFixed(2);
  const sign = Number(magnitude) === 0 ? "" : value > 0 ? "+" : "-";
  return `${sign}${magnitude} pp`;
};
/** Quoted annual yield (Treasury reference): unsigned unless negative. */
export const yieldPercent = (value: number) => unsignedPercent(value);
export const timestamp = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value)) + " ET";
/** Compact axis currency: $10k, $16.8k, $1.2M. */
export const axisMoney = (value: number) =>
  nf({
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
    signDisplay: "negative",
  }).format(value);
export const axisPercent = (value: number) =>
  nf({
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay: "negative",
  }).format(value);
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
export const axisDate = (date: string, unit: "year" | "month") =>
  unit === "year"
    ? date.slice(0, 4)
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T00:00:00Z`));
/** Axis day label for short windows: "Mar 2". */
export const axisDay = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
/** Count with grouping and a noun: "1,253 returns", "1 return". */
export const count = (n: number, singular: string, plural = `${singular}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? singular : plural}`;
/** Signed dollar difference: "+$1,234.00", "-$56.00", "$0.00". */
export const signedMoney = (value: number) =>
  `${value > 0 ? "+" : ""}${money(value)}`;
