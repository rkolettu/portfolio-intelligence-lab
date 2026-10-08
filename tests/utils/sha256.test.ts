import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/utils/sha256";

const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("browser-safe SHA-256 equals Node's crypto exactly", () => {
  it("matches the FIPS 180 reference vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches Node for every ASCII length from 0 to 300 bytes (all padding/block boundaries)", () => {
    for (let n = 0; n <= 300; n++) {
      const s = "a".repeat(n);
      expect(sha256Hex(s), `length ${n}`).toBe(node(s));
    }
    for (const n of [55, 56, 63, 64, 65, 119, 120, 127, 128, 129]) {
      const s = "x".repeat(n);
      expect(bytes(s)).toBe(n);
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it("matches Node on multi-byte strings whose UTF-8 length straddles the block boundaries", () => {
    // 2-, 3- and 4-byte code points, padded with ASCII to hit each byte length.
    for (const unit of ["é", "中", "😀", "€"]) {
      for (const target of [55, 56, 63, 64, 65, 119, 120, 127, 128, 129]) {
        const repeats = Math.floor(target / bytes(unit));
        const s = unit.repeat(repeats) + "z".repeat(target - repeats * bytes(unit));
        expect(bytes(s)).toBe(target);
        expect(sha256Hex(s), `${unit} × ${target}`).toBe(node(s));
      }
    }
  });

  it("matches Node on Unicode, emoji, combining marks and lone surrogates", () => {
    for (const s of [
      "Nestlé",
      "Hermès International",
      "日本語のテキスト",
      "Ελληνικά",
      "👍🏽👨‍👩‍👧‍👦🇺🇸",
      "é", // combining acute
      "\ud800", // lone high surrogate → U+FFFD in both
      "\udfff abc \ud83d", // lone low and dangling high surrogates
      "\u0000\u0001\u007f",
      "tab\tnew\nline\r\n",
    ])
      expect(sha256Hex(s), JSON.stringify(s)).toBe(node(s));
  });

  it("matches Node on long strings", () => {
    for (const s of ["a".repeat(1_000_000), "0123456789abcdef".repeat(70_000), "😀".repeat(100_000)])
      expect(sha256Hex(s)).toBe(node(s));
  });

  it("matches Node on JSON and deterministic forward-model payloads", () => {
    const payloads = [
      JSON.stringify({}),
      JSON.stringify({ a: 1, b: [1, 2, 3], c: { d: null, e: "f" } }),
      JSON.stringify({
        kind: "forward-expected-returns",
        riskModelHash: "f".repeat(64),
        riskFree: { series: "DGS1", observationDate: "2024-06-03", annualYield: 0.0513 },
        marketRiskPremium: 0.05,
        tickers: ["AAPL", "BRK-B", "MSFT"],
        blackLittermanExpectedReturn: [0.10768, 0.104, 0.09576, -0.0123456789012345],
        weights: { risky: [0.4, 0.35, 0.2], cash: 0.05 },
        tiny: [1e-300, -0, 5e-324, 1.7976931348623157e308],
      }),
    ];
    for (const s of payloads) expect(sha256Hex(s)).toBe(node(s));
  });

  it("matches Node on 500 seeded random strings over the full code-point range", () => {
    let seed = 20261008;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      const length = Math.floor(rand() * 200);
      let s = "";
      for (let j = 0; j < length; j++) {
        const r = rand();
        const cp =
          r < 0.5
            ? 0x20 + Math.floor(rand() * 95)
            : r < 0.75
              ? 0x80 + Math.floor(rand() * 0x780)
              : r < 0.9
                ? 0x800 + Math.floor(rand() * 0xd000)
                : 0x10000 + Math.floor(rand() * 0xfffff);
        s += String.fromCodePoint(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
      }
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it("returns 64 lowercase hex characters", () => {
    expect(sha256Hex("portfolio")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("imports nothing (no node:crypto, no Buffer)", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync("lib/utils/sha256.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect([...code.matchAll(/from "([^"]+)"/g)]).toEqual([]);
    expect(code).not.toMatch(/\bBuffer\b|require\(|\bcrypto\b/);
  });
});
