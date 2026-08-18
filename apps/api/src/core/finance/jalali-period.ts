import { getJalaliParts } from '@bops/i18n';

/**
 * Maps a Jalali (year, month) onto the absolute UTC interval it covers.
 *
 * WHY THIS IS NEEDED AND WHY IT LOOKS LIKE THIS
 *
 * The whole platform is Persian-first: the accounting month a resident knows is
 * "مهر ۱۴۰۴", not "September 2025". But `financial_periods.startsAt/endsAt` are
 * `timestamptz`, because the EXCLUDE constraint and every ledger comparison need
 * absolute instants. So something has to convert Jalali -> UTC, ONCE, on the
 * server (§9).
 *
 * `packages/i18n` deliberately ships no Jalali library (see format.ts): `Intl`
 * with the `persian` calendar is already correct and one dependency fewer is one
 * fewer source of disagreement in a financial calculation. `Intl` only converts
 * Gregorian -> Jalali though, so the inverse is done by SEARCHING: start from an
 * approximation, then step day by day until the Jalali parts match. The search
 * window is tiny (a handful of days), it is exact by construction — it verifies
 * the answer with the same formatter the rest of the platform displays — and it
 * runs once per period creation, not per request.
 *
 * The alternative, hardcoding Jalali leap-year arithmetic, is where subtle
 * off-by-one-day bugs live, and a period boundary that is one day out silently
 * moves a charge into the wrong month.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rough Gregorian anchor for a Jalali new year. Farvardin 1 falls on 20 or 21
 * March; starting there means the refinement loop below converges in a few
 * steps rather than scanning a year.
 */
function approximateGregorian(jalaliYear: number, jalaliMonth: number): Date {
  const gregorianYear = jalaliYear + 621;
  // Days elapsed in the Jalali year before this month: first six months are 31
  // days, the next five are 30.
  const monthsBefore = jalaliMonth - 1;
  const daysBefore =
    monthsBefore <= 6 ? monthsBefore * 31 : 6 * 31 + (monthsBefore - 6) * 30;

  // 20 March of the corresponding Gregorian year, at UTC midnight.
  const anchor = Date.UTC(gregorianYear, 2, 20);
  return new Date(anchor + daysBefore * DAY_MS);
}

/**
 * The UTC instant at which the given Jalali month's first day begins, in the
 * building's timezone.
 *
 * Returns midnight LOCAL to `timeZone`: a period must start when the day starts
 * for the residents, not at 00:00 UTC, or charges dated late on the last of the
 * month fall into the wrong period.
 */
function startOfJalaliMonth(
  jalaliYear: number,
  jalaliMonth: number,
  timeZone: string,
): Date {
  let candidate = approximateGregorian(jalaliYear, jalaliMonth);

  // Walk to the exact first day of the target Jalali month. The bound is a
  // safety net, not an expectation — convergence takes a few iterations.
  for (let step = 0; step < 40; step += 1) {
    const parts = getJalaliParts(candidate, timeZone);
    if (!parts) break;

    if (parts.year === jalaliYear && parts.month === jalaliMonth && parts.day === 1) {
      return atLocalMidnight(candidate, timeZone);
    }

    // Ordering comparison on (year, month, day) tells us which way to step.
    const behind =
      parts.year < jalaliYear ||
      (parts.year === jalaliYear && parts.month < jalaliMonth) ||
      (parts.year === jalaliYear &&
        parts.month === jalaliMonth &&
        parts.day > 1);

    candidate = new Date(candidate.getTime() + (behind ? DAY_MS : -DAY_MS));
  }

  // Never silently return an approximate boundary: a period that starts on the
  // wrong day misfiles every charge in it.
  throw new Error(
    `Could not resolve the Gregorian start of Jalali ${jalaliYear}/${jalaliMonth}`,
  );
}

/**
 * Snaps an instant back to 00:00:00 of its own day in `timeZone`.
 *
 * Done by formatting the date in the target zone and subtracting the wall-clock
 * offset, which avoids assuming a fixed +03:30 — Iran has changed its DST rules,
 * and a hardcoded offset would put historical periods an hour out.
 */
function atLocalMidnight(date: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  const hours = Number(parts.hour ?? 0) % 24;
  const minutes = Number(parts.minute ?? 0);
  const seconds = Number(parts.second ?? 0);

  return new Date(
    date.getTime() - ((hours * 60 + minutes) * 60 + seconds) * 1000,
  );
}

/**
 * The half-open interval [startsAt, endsAt) covering one Jalali month.
 *
 * Half-open on purpose, matching every other temporal rule in the schema: the
 * next month starts at exactly the instant this one ends, so no charge can fall
 * between two periods and none can belong to both.
 */
export function jalaliMonthRange(
  year: number,
  month: number,
  timeZone = 'Asia/Tehran',
): { startsAt: Date; endsAt: Date } {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid Jalali month: ${month}`);
  }

  const startsAt = startOfJalaliMonth(year, month, timeZone);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endsAt = startOfJalaliMonth(nextYear, nextMonth, timeZone);

  return { startsAt, endsAt };
}

/** Convenience: the Jalali (year, month) an instant falls in. */
export function jalaliMonthOf(
  date: Date,
  timeZone = 'Asia/Tehran',
): { year: number; month: number } {
  const parts = getJalaliParts(date, timeZone);
  if (!parts) throw new Error('Invalid date');
  return { year: parts.year, month: parts.month };
}
