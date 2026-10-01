// Display-only diverging color scale for the correlation heatmap (dataviz method:
// two opposite hues around a neutral gray midpoint, equal steps per arm).
// Interpolation happens in OKLab so lightness changes monotonically along each arm.

type Rgb = [number, number, number];
const hex = (h: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const toHex = (c: Rgb) =>
  "#" +
  c
    .map((x) =>
      Math.round(Math.min(1, Math.max(0, x)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const toLinear = (x: number) =>
  x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
const toGamma = (x: number) =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;

export function toOklab(color: string): Rgb {
  const [r, g, b] = hex(color).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B]: Rgb): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return toHex(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(toGamma) as Rgb,
  );
}

/** Diverging pair on paper: blue ↔ red around a light warm neutral; each arm
 * darkens away from zero. */
export const DIVERGING = {
  negative: "#1d4ed8",
  midpoint: "#ebe6dd",
  positive: "#b8322c",
} as const;

/** Background color for a value in [−1, 1]; 0 is the neutral midpoint. */
export function divergingColor(value: number): string {
  const t = Math.min(1, Math.abs(value));
  const from = toOklab(DIVERGING.midpoint);
  const to = toOklab(value < 0 ? DIVERGING.negative : DIVERGING.positive);
  return fromOklab(from.map((x, i) => x + (to[i] - x) * t) as Rgb);
}

/** WCAG relative luminance and contrast. */
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = hex(c).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text ink for a cell: white or near-black, whichever contrasts more. For any
 * background one of them reaches at least √21 ≈ 4.58:1 (WCAG AA for small text). */
export function inkFor(background: string): string {
  return contrast(background, "#ffffff") >= contrast(background, "#000000")
    ? "#ffffff"
    : "#000000";
}
