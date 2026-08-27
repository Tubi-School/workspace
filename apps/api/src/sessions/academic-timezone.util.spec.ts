import { computeAttendanceCutoffAtUtc, toAcademicDateString } from './academic-timezone.util.js';

describe('academic-timezone.util', () => {
  describe('computeAttendanceCutoffAtUtc', () => {
    it('derives 23:59 Africa/Johannesburg (UTC+2, no DST) as 21:59 UTC on the same date', () => {
      const sessionDate = new Date('2026-07-01');

      const cutoff = computeAttendanceCutoffAtUtc(sessionDate);

      expect(cutoff.toISOString()).toBe('2026-07-01T21:59:00.000Z');
    });

    it('stays within Africa/Johannesburg for a date in the other half of the year (no DST to worry about)', () => {
      const sessionDate = new Date('2026-01-15');

      const cutoff = computeAttendanceCutoffAtUtc(sessionDate);

      expect(cutoff.toISOString()).toBe('2026-01-15T21:59:00.000Z');
    });
  });

  describe('toAcademicDateString', () => {
    it('formats a UTC instant as its Africa/Johannesburg calendar date', () => {
      // 22:30 UTC on 2026-07-01 is 00:30 on 2026-07-02 in UTC+2.
      const lateNightUtc = new Date('2026-07-01T22:30:00.000Z');

      expect(toAcademicDateString(lateNightUtc)).toBe('2026-07-02');
    });

    it('agrees with computeAttendanceCutoffAtUtc for the same calendar date', () => {
      const sessionDate = new Date('2026-07-01');
      const cutoff = computeAttendanceCutoffAtUtc(sessionDate);

      expect(toAcademicDateString(cutoff)).toBe('2026-07-01');
    });
  });
});
