import { z } from "zod";
// U.S. listings, including Yahoo's class-share dash syntax. Dotted foreign listings excluded.
export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z][A-Z0-9]{0,9}(?:-[A-Z])?$/,
    "Enter a U.S.-listed ticker, for example SPY or BRK-B.",
  );
