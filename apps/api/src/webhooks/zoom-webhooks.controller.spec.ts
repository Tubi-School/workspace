import { UnauthorizedException } from '@nestjs/common';

import type { RawBodyRequest } from '../common/raw-body-request.js';
import type { ZoomProviderService } from '../providers/zoom/zoom-provider.service.js';
import type { WebhookIdempotencyService } from './webhook-idempotency.service.js';
import { ZoomWebhooksController } from './zoom-webhooks.controller.js';
import type { ZoomLiveAttendanceIngestionService } from './zoom-live-attendance-ingestion.service.js';
import type { ZoomRecordingIngestionService } from './zoom-recording-ingestion.service.js';

function buildRequest(body: unknown, headers: Record<string, string> = {}): RawBodyRequest {
  return {
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as RawBodyRequest;
}

describe('ZoomWebhooksController', () => {
  let zoom: { computeUrlValidationResponse: jest.Mock; verifyWebhookSignature: jest.Mock };
  let idempotency: { claim: jest.Mock; markProcessed: jest.Mock; markFailed: jest.Mock };
  let liveAttendance: { handleParticipantJoined: jest.Mock; handleParticipantLeft: jest.Mock };
  let recording: { ingest: jest.Mock };
  let controller: ZoomWebhooksController;

  beforeEach(() => {
    zoom = {
      computeUrlValidationResponse: jest.fn().mockReturnValue('encrypted-token'),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    };
    idempotency = {
      claim: jest.fn().mockResolvedValue({ outcome: 'PROCEED', token: 'token-1' }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    liveAttendance = {
      handleParticipantJoined: jest.fn().mockResolvedValue(undefined),
      handleParticipantLeft: jest.fn().mockResolvedValue(undefined),
    };
    recording = { ingest: jest.fn().mockResolvedValue(undefined) };
    controller = new ZoomWebhooksController(
      zoom as unknown as ZoomProviderService,
      idempotency as unknown as WebhookIdempotencyService,
      liveAttendance as unknown as ZoomLiveAttendanceIngestionService,
      recording as unknown as ZoomRecordingIngestionService,
    );
  });

  it('answers the endpoint.url_validation handshake without checking a signature', async () => {
    const req = buildRequest({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } });

    const result = await controller.handle(req);

    expect(result).toEqual({ plainToken: 'abc', encryptedToken: 'encrypted-token' });
    expect(zoom.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid/missing signature', async () => {
    zoom.verifyWebhookSignature.mockReturnValue(false);
    const req = buildRequest(
      { event: 'meeting.participant_joined', payload: { object: { id: '1' } } },
      { 'x-zm-signature': 'bad', 'x-zm-request-timestamp': '1' },
    );

    await expect(controller.handle(req)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('no-ops an already-processed redelivered event without dispatching it again', async () => {
    idempotency.claim.mockResolvedValue({ outcome: 'ALREADY_PROCESSED' });
    const req = buildRequest(
      {
        event: 'meeting.participant_joined',
        event_ts: 1,
        payload: {
          object: { id: '1', participant: { id: 'p1', join_time: '2026-01-01T00:00:00Z' } },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    const result = await controller.handle(req);

    expect(result).toEqual({ status: 'ok' });
    expect(liveAttendance.handleParticipantJoined).not.toHaveBeenCalled();
  });

  it('no-ops when another concurrent delivery already holds the processing claim', async () => {
    idempotency.claim.mockResolvedValue({ outcome: 'CLAIMED_BY_OTHER' });
    const req = buildRequest(
      {
        event: 'meeting.participant_joined',
        event_ts: 1,
        payload: {
          object: { id: '1', participant: { id: 'p1', join_time: '2026-01-01T00:00:00Z' } },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    const result = await controller.handle(req);

    expect(result).toEqual({ status: 'ok' });
    expect(liveAttendance.handleParticipantJoined).not.toHaveBeenCalled();
  });

  it('marks the event processed only after routing succeeds', async () => {
    const req = buildRequest(
      {
        event: 'meeting.participant_joined',
        event_ts: 1,
        payload: {
          object: { id: '1', participant: { id: 'p1', join_time: '2026-01-01T00:00:00Z' } },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    await controller.handle(req);

    expect(idempotency.markProcessed).toHaveBeenCalledWith('ZOOM', expect.any(String), 'token-1');
    expect(idempotency.markFailed).not.toHaveBeenCalled();
  });

  it('marks the event failed (never permanently poisoned) when routing throws, and rethrows', async () => {
    liveAttendance.handleParticipantJoined.mockRejectedValue(new Error('downstream failure'));
    const req = buildRequest(
      {
        event: 'meeting.participant_joined',
        event_ts: 1,
        payload: {
          object: { id: '1', participant: { id: 'p1', join_time: '2026-01-01T00:00:00Z' } },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    await expect(controller.handle(req)).rejects.toThrow('downstream failure');

    expect(idempotency.markFailed).toHaveBeenCalledWith('ZOOM', expect.any(String), 'token-1');
    expect(idempotency.markProcessed).not.toHaveBeenCalled();
  });

  it('dispatches a claimed participant_joined event', async () => {
    const req = buildRequest(
      {
        event: 'meeting.participant_joined',
        event_ts: 1,
        payload: {
          object: {
            id: '1',
            participant: { id: 'p1', email: 'a@b.com', join_time: '2026-01-01T00:00:00Z' },
          },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    await controller.handle(req);

    expect(liveAttendance.handleParticipantJoined).toHaveBeenCalledWith(
      '1',
      'p1',
      'a@b.com',
      new Date('2026-01-01T00:00:00Z'),
    );
  });

  it('dispatches a claimed participant_left event', async () => {
    const req = buildRequest(
      {
        event: 'meeting.participant_left',
        event_ts: 1,
        payload: {
          object: { id: '1', participant: { id: 'p1', leave_time: '2026-01-01T00:30:00Z' } },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    await controller.handle(req);

    expect(liveAttendance.handleParticipantLeft).toHaveBeenCalledWith(
      '1',
      'p1',
      new Date('2026-01-01T00:30:00Z'),
    );
  });

  it('dispatches a claimed recording.completed event', async () => {
    const req = buildRequest(
      {
        event: 'recording.completed',
        event_ts: 1,
        payload: {
          object: {
            id: '1',
            duration: 30,
            recording_files: [
              {
                id: 'rec-1',
                share_url: 'https://zoom.us/rec/share/rec-1',
                recording_type: 'shared_screen_with_speaker_view',
              },
            ],
          },
        },
      },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    await controller.handle(req);

    expect(recording.ingest).toHaveBeenCalledWith({
      providerMeetingId: '1',
      providerRecordingId: 'rec-1',
      shareUrl: 'https://zoom.us/rec/share/rec-1',
      totalSeconds: 1800,
    });
  });

  it('acknowledges and ignores an unrecognised event type', async () => {
    const req = buildRequest(
      { event: 'meeting.something.unhandled', event_ts: 1, payload: { object: { id: '1' } } },
      { 'x-zm-signature': 'ok', 'x-zm-request-timestamp': '1' },
    );

    const result = await controller.handle(req);

    expect(result).toEqual({ status: 'ok' });
  });
});
