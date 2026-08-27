/**
 * The frozen canonical school timezone (docs/phase-2a-final-domain-design.txt,
 * founder ruling / correction 2, section I). Every academic-day and
 * attendance-cutoff calculation in this module is anchored to it — never to
 * server-local time or a caller-supplied timezone.
 */
export const ACADEMIC_TIMEZONE = 'Africa/Johannesburg';

/**
 * Minutes to add to a UTC instant to get the wall-clock time in `timeZone`
 * at that instant (e.g. +120 for Africa/Johannesburg, which does not
 * observe daylight saving). Computed via Intl rather than hardcoded so the
 * calculation stays correct if the IANA database's rule for this zone ever
 * changes, without hardcoding an assumption this codebase has no way to
 * verify stays true forever.
 */
function getTimezoneOffsetMinutes(timeZone: string, instant: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * The academic calendar-day string (YYYY-MM-DD) that `instant` falls on in
 * the academic timezone. Used to check that a session's `startTime` lands
 * on the same academic day as its declared `sessionDate`.
 */
export function toAcademicDateString(instant: Date): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape a `@db.Date`
  // (and this codebase's DTOs) already use.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ACADEMIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The normal attendance cutoff: 23:59:00 on `sessionDate`, in the academic
 * timezone, expressed as the UTC instant Prisma will store.
 *
 * `sessionDate` is expected to be a UTC-midnight Date representing a plain
 * calendar date (as produced by `new Date('YYYY-MM-DD')` or read back from
 * a `@db.Date` column) — only its year/month/day are used.
 */
export function computeAttendanceCutoffAtUtc(sessionDate: Date): Date {
  const year = sessionDate.getUTCFullYear();
  const month = sessionDate.getUTCMonth();
  const day = sessionDate.getUTCDate();

  // A first guess treating 23:59:00 on that date as if it were already UTC,
  // purely to sample the zone's offset at roughly the right instant.
  const guess = new Date(Date.UTC(year, month, day, 23, 59, 0));
  const offsetMinutes = getTimezoneOffsetMinutes(ACADEMIC_TIMEZONE, guess);

  // local = utc + offset  =>  utc = local - offset
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}
