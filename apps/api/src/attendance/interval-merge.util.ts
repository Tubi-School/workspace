/**
 * Generic numeric interval merge/coverage math, shared by the LIVE
 * (LiveAttendanceInterval, millisecond epoch values) and RECORDED
 * (WatchedInterval, integer second values) coverage engines. Neither
 * engine trusts a client-supplied percentage — both derive coverage from
 * the actual union of reported ranges, so overlapping or duplicate
 * intervals can never inflate the total, and a skipped span always leaves
 * a genuine gap.
 */
export interface NumericInterval {
  start: number;
  end: number;
}

/** Sorts and merges overlapping/adjacent intervals into the minimal
 * non-overlapping set representing their union. */
export function mergeIntervals(intervals: NumericInterval[]): NumericInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: NumericInterval[] = [{ ...sorted[0]! }];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/** Sum of durations across (already-merged, non-overlapping) intervals. */
export function totalCoverage(intervals: NumericInterval[]): number {
  return intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}

/** Clips `interval` to `bounds`, returning null if there is no overlap at
 * all (rather than a zero/negative-length interval). */
export function clipInterval(
  interval: NumericInterval,
  bounds: NumericInterval,
): NumericInterval | null {
  const start = Math.max(interval.start, bounds.start);
  const end = Math.min(interval.end, bounds.end);

  return end > start ? { start, end } : null;
}
