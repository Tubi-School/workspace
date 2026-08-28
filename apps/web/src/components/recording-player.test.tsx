import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingPlayer } from './recording-player';

const reportWatchedIntervalMock = vi
  .fn<
    (
      sessionId: string,
      start: number,
      end: number,
      options?: { keepalive?: boolean },
    ) => Promise<void>
  >()
  .mockResolvedValue(undefined);
vi.mock('@/lib/endpoints', () => ({
  learnerPortalApi: {
    reportWatchedInterval: (
      sessionId: string,
      start: number,
      end: number,
      options?: { keepalive?: boolean },
    ) =>
      options === undefined
        ? reportWatchedIntervalMock(sessionId, start, end)
        : reportWatchedIntervalMock(sessionId, start, end, options),
  },
}));

function setCurrentTime(video: HTMLVideoElement, time: number) {
  Object.defineProperty(video, 'currentTime', { value: time, configurable: true });
}

function timeUpdate(video: HTMLVideoElement, time: number) {
  setCurrentTime(video, time);
  fireEvent(video, new Event('timeupdate'));
}

/** A real seek: the browser sets `currentTime` to the new target and
 * fires `seeking` before playback (and further timeupdates) resume there
 * — mirrored exactly here, since this player relies on that ordering. */
function seek(video: HTMLVideoElement, toTime: number) {
  setCurrentTime(video, toTime);
  fireEvent(video, new Event('seeking'));
}

describe('RecordingPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('reports normal continuous playback with sparsely-spaced timeupdate events as one segment (no seek heuristic to misfire)', () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    // Simulates background-tab throttling: large gaps between
    // consecutive timeupdate events during genuinely continuous
    // playback. No `seeking` event fires, so this must never be treated
    // as a seek.
    timeUpdate(video, 1);
    timeUpdate(video, 9);
    timeUpdate(video, 40);

    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).toHaveBeenCalledTimes(1);
    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 1, 40);
  });

  it('a forward seek closes the prior segment at the last genuinely-played position and starts a fresh one at the seek target', () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 0);
    timeUpdate(video, 5);
    seek(video, 100);
    timeUpdate(video, 100);
    timeUpdate(video, 101);

    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 0, 5);
    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 100, 101);
    expect(reportWatchedIntervalMock).not.toHaveBeenCalledWith('session-1', 0, 101);
  });

  it('a backward seek (rewatch) reports the actually-rewatched range — never manufactures or double-counts coverage client-side', () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 50);
    timeUpdate(video, 60);
    seek(video, 10); // rewind
    timeUpdate(video, 10);
    timeUpdate(video, 15);

    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 50, 60);
    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 10, 15);
    // Deduplication of the resulting overlapping ranges is the backend's
    // job (WatchedIntervalService merges and recomputes) — this player
    // only needs to report what was genuinely played.
  });

  it('flushes any remaining buffered progress on pause, and playback resumes as a fresh contiguous segment', () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 2);
    timeUpdate(video, 3);
    fireEvent(video, new Event('pause'));

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 2, 3);

    reportWatchedIntervalMock.mockClear();
    // Resume from the same position — no seek event, ordinary continued
    // playback.
    timeUpdate(video, 3);
    timeUpdate(video, 6);
    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 3, 6);
  });

  it('flushes on end-of-video', () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 90);
    timeUpdate(video, 100);
    fireEvent(video, new Event('ended'));

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 90, 100);
  });

  it('Correction 6: a transient send failure keeps the interval queued and retries it on the next flush, succeeding then', async () => {
    reportWatchedIntervalMock.mockRejectedValueOnce(new Error('network error'));
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 2);
    timeUpdate(video, 8);
    fireEvent(video, new Event('pause'));

    expect(reportWatchedIntervalMock).toHaveBeenCalledTimes(1);
    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 2, 8);

    // Let the failed attempt's rejection be handled (re-queues the range)
    // before the next flush is triggered.
    await Promise.resolve();
    await Promise.resolve();

    // No further playback in between — the next flush must retry the
    // still-queued [2, 8] range, and this time it succeeds.
    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).toHaveBeenCalledTimes(2);
    expect(reportWatchedIntervalMock).toHaveBeenNthCalledWith(2, 'session-1', 2, 8);
  });

  it('Correction 6: a successfully-sent interval is not retried again on a later flush', async () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 2);
    timeUpdate(video, 8);
    fireEvent(video, new Event('pause'));
    expect(reportWatchedIntervalMock).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).toHaveBeenCalledTimes(1);
  });

  it('post-op Correction M1: unmount sends the final buffered range with keepalive so it can outlive the component being torn down', () => {
    const { container, unmount } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 20);
    timeUpdate(video, 25);
    // No pause/seek/interval flush before unmount — this is the exact
    // "final watched range only lives in an in-memory ref" scenario the
    // finding described.
    unmount();

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 20, 25, {
      keepalive: true,
    });
  });

  it('post-op Correction M1: the browser pagehide event (navigation/tab close) sends the final buffered range with keepalive', () => {
    render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = document.querySelector('video')!;

    timeUpdate(video, 30);
    timeUpdate(video, 33);
    window.dispatchEvent(new Event('pagehide'));

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 30, 33, {
      keepalive: true,
    });
  });

  it('post-op Correction M1: an already-queued (previously failed) range is included in the final keepalive delivery, not left behind', async () => {
    reportWatchedIntervalMock.mockRejectedValueOnce(new Error('network error'));
    const { unmount, container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 2);
    timeUpdate(video, 8);
    fireEvent(video, new Event('pause'));
    expect(reportWatchedIntervalMock).toHaveBeenCalledTimes(1);

    // Let the failed attempt's rejection re-queue the range before
    // unmounting — mirrors a real failed send shortly before navigation.
    await Promise.resolve();
    await Promise.resolve();

    timeUpdate(video, 8);
    timeUpdate(video, 9);
    unmount();

    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 2, 8, { keepalive: true });
    expect(reportWatchedIntervalMock).toHaveBeenCalledWith('session-1', 8, 9, { keepalive: true });
  });

  it('never reports a zero/negative-length segment (e.g. a seek with nothing played since the last one)', () => {
    const { container } = render(
      <RecordingPlayer sessionId="session-1" recordingUrl="https://cdn.example.com/rec.mp4" />,
    );
    const video = container.querySelector('video')!;

    timeUpdate(video, 5);
    seek(video, 20); // no further timeupdate before this seek
    seek(video, 40); // back-to-back seeks, no playback in between

    vi.advanceTimersByTime(15_000);

    expect(reportWatchedIntervalMock).not.toHaveBeenCalled();
  });
});
