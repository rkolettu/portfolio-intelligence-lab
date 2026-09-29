"""Development only. Regenerates the checked-in calendar artifacts deterministically.

    python3 -m venv .calendar-venv
    .calendar-venv/bin/pip install -r scripts/calendar-requirements.txt
    .calendar-venv/bin/python scripts/generate-calendar.py
    npm run calendar:check

Runtime uses the checked-in artifacts, never Python or a weekday approximation.
Renewal procedure: docs/DATA-PROVIDERS.md, "Calendar maintenance".
"""
import hashlib
import json
from pathlib import Path

import exchange_calendars as xcals
import pandas as pd
from pandas.tseries.holiday import USFederalHolidayCalendar

# Bounded by the latest year NYSE officially publishes; never extend past it on rules alone.
SESSIONS_START, SESSIONS_END = '1976-01-01', '2028-12-31'
# Federal coverage starts before the sessions so rates fetched ahead of the first
# session (with lookback context) still receive a modeled release time.
FEDERAL_START, FEDERAL_END = '1975-01-01', '2029-12-31'
# Documented executive-order and national-mourning federal closures. Treating a day as
# closed can only delay modeled Treasury availability, so additions are conservative.
SUPPLEMENTAL_FEDERAL_CLOSURES = sorted([
    '2001-12-24', '2004-06-11', '2007-01-02', '2007-12-24', '2008-12-26',
    '2012-12-24', '2014-12-26', '2015-12-24', '2018-12-05', '2018-12-24',
    '2019-12-24', '2020-12-24', '2024-12-24', '2025-01-09', '2025-12-24',
    '2025-12-26',
])


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()


def write(path: str, value) -> None:
    Path(path).write_text(json.dumps(value, separators=(',', ':')) + '\n')


calendar = xcals.get_calendar('XNYS', start=SESSIONS_START, end=SESSIONS_END)
sessions = [
    [str(day.date()), row['close'].isoformat().replace('+00:00', 'Z')]
    for day, row in calendar.schedule.iterrows()
]
write('config/nyse-sessions.json', {
    'version': f'XNYS-exchange_calendars-{xcals.__version__}-{SESSIONS_START[:4]}-{SESSIONS_END[:4]}',
    'source': 'https://github.com/gerrymanoim/exchange_calendars',
    'generator': {
        'script': 'scripts/generate-calendar.py',
        'exchange_calendars': xcals.__version__,
        'pandas': pd.__version__,
    },
    'coverage': {'start': SESSIONS_START, 'end': SESSIONS_END},
    'sessionsSha256': digest(sessions),
    'sessions': sessions,
})
print(f'Generated {len(sessions)} sessions')

holidays = [str(d.date()) for d in USFederalHolidayCalendar().holidays(start=FEDERAL_START, end=FEDERAL_END)]
write('config/federal-holidays.json', {
    'version': f'US-federal-pandas-{pd.__version__}-supplemental-v1-{FEDERAL_START[:4]}-{FEDERAL_END[:4]}',
    'source': 'pandas.tseries.holiday.USFederalHolidayCalendar plus documented federal closures',
    'coverage': {'start': FEDERAL_START, 'end': FEDERAL_END},
    'holidays': holidays,
    'supplementalClosures': SUPPLEMENTAL_FEDERAL_CLOSURES,
    'sha256': digest([holidays, SUPPLEMENTAL_FEDERAL_CLOSURES]),
})
print(f'Generated {len(holidays)} federal holidays and {len(SUPPLEMENTAL_FEDERAL_CLOSURES)} supplemental closures')
