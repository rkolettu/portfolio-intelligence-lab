# Deterministic fixtures

`helpers.ts` creates synthetic, hand-calculated prices, sessions and provenance. Provider tests use synthetic chart/CSV payloads shaped like the inspected Yahoo v8 chart and FRED CSV responses; no personal data, credentials or licensed historical dataset is embedded. Their values are deliberately small enough to audit by hand (100→110→99; 50/50 drift; split-adjusted 50→50; prior-known 5% Treasury yield).

`config/nyse-sessions.json` is a generated schedule, not security prices. Source: exchange_calendars 4.13.2 (Apache-2.0), generator in `scripts/generate-calendar.py`. Federal holidays come from pandas' USFederalHolidayCalendar. See methodology/calendar maintenance limits.
