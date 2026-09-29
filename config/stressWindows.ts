import type { StressWindowDefinition } from "@/lib/types/analytics";

/** Fixed historical stress windows. Each is a chosen, documented window between two
 * actual XNYS session closes, not a universal definition of the episode. Never
 * redefined dynamically: changing one requires a new STRESS_WINDOWS_VERSION. The
 * portfolio is set to target weights at the start close; the end close is the last
 * one included. */
export const STRESS_WINDOWS_VERSION = "stress-windows-v1";

export const STRESS_WINDOWS: readonly StressWindowDefinition[] = [
  {
    id: "gfc",
    name: "Global Financial Crisis",
    startDate: "2007-10-09",
    endDate: "2009-03-09",
    description:
      "S&P 500 closing high of 9 Oct 2007 to its closing low of 9 Mar 2009.",
    kind: "preset",
  },
  {
    id: "covid",
    name: "COVID Crash",
    startDate: "2020-02-19",
    endDate: "2020-03-23",
    description:
      "S&P 500 closing high of 19 Feb 2020 to its closing low of 23 Mar 2020.",
    kind: "preset",
  },
  {
    id: "rate-shock-2022",
    name: "2022 Inflation / Rate Shock",
    startDate: "2021-12-31",
    endDate: "2022-12-30",
    description:
      "Calendar year 2022: the last 2021 close through the last 2022 close.",
    kind: "preset",
  },
];
