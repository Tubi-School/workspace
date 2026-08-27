import { clipInterval, mergeIntervals, totalCoverage } from './interval-merge.util.js';

describe('interval-merge.util', () => {
  describe('mergeIntervals + totalCoverage', () => {
    it('merges overlapping intervals rather than summing them separately', () => {
      // [0,20) and [10,30) overlap; union is [0,30) = 30, not 20+20=40.
      const merged = mergeIntervals([
        { start: 0, end: 20 },
        { start: 10, end: 30 },
      ]);

      expect(merged).toEqual([{ start: 0, end: 30 }]);
      expect(totalCoverage(merged)).toBe(30);
    });

    it('does not inflate coverage for an exact duplicate interval', () => {
      const merged = mergeIntervals([
        { start: 0, end: 15 },
        { start: 0, end: 15 },
      ]);

      expect(totalCoverage(merged)).toBe(15);
    });

    it('leaves a genuine gap when intervals are disjoint (skipping ahead)', () => {
      // The brief's example: 0-15 and 30-60 of a 60-minute timeline = 45,
      // never 100%, regardless of the playhead having reached the end.
      const merged = mergeIntervals([
        { start: 0, end: 15 },
        { start: 30, end: 60 },
      ]);

      expect(totalCoverage(merged)).toBe(45);
    });

    it('accumulates disconnected intervals (temporary disconnects)', () => {
      const merged = mergeIntervals([
        { start: 0, end: 10 },
        { start: 20, end: 35 },
        { start: 50, end: 55 },
      ]);

      expect(totalCoverage(merged)).toBe(10 + 15 + 5);
    });

    it('returns an empty array for no intervals', () => {
      expect(mergeIntervals([])).toEqual([]);
      expect(totalCoverage(mergeIntervals([]))).toBe(0);
    });
  });

  describe('clipInterval', () => {
    it('clips an interval to the given bounds', () => {
      expect(clipInterval({ start: -10, end: 10 }, { start: 0, end: 60 })).toEqual({
        start: 0,
        end: 10,
      });
      expect(clipInterval({ start: 50, end: 70 }, { start: 0, end: 60 })).toEqual({
        start: 50,
        end: 60,
      });
    });

    it('returns null when the interval falls entirely outside the bounds', () => {
      expect(clipInterval({ start: -20, end: -5 }, { start: 0, end: 60 })).toBeNull();
      expect(clipInterval({ start: 61, end: 90 }, { start: 0, end: 60 })).toBeNull();
    });
  });
});
