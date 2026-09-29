// Build-time guard (npm prebuild): artifact integrity plus the calendar renewal horizon.
import sessions from "../config/nyse-sessions.json" with { type: "json" };
import federal from "../config/federal-holidays.json" with { type: "json" };
import { checkCalendars } from "../lib/backtest/calendarIntegrity";
import { marketDate } from "../lib/utils/dates";

const today = marketDate(new Date().toISOString());
const { errors, warnings } = checkCalendars(sessions, federal, today);
for (const warning of warnings) console.warn(`calendar warning: ${warning}`);
for (const error of errors) console.error(`calendar error: ${error}`);
if (errors.length) process.exit(1);
console.log(`Calendars valid: ${sessions.version}; ${federal.version}.`);
