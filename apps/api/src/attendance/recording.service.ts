import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma, SessionStatus, type SessionRecording } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PublishRecordingDto } from './dto/publish-recording.dto.js';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Publishing a recording only attaches the playback resource — it never,
 * by itself, marks anyone PRESENT (founder ruling, Part F). Attendance
 * only follows from genuine WatchedInterval coverage, evaluated
 * separately by WatchedIntervalService.
 */
@Injectable()
export class RecordingService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(sessionId: string, dto: PublishRecordingDto): Promise<SessionRecording> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    if (session.status !== SessionStatus.ENDED) {
      throw new ConflictException(
        `Session ${sessionId} is ${session.status}; recordings may only be published for ENDED sessions`,
      );
    }

    try {
      return await this.prisma.sessionRecording.create({
        data: {
          sessionId,
          recordingUrl: dto.recordingUrl,
          availableFrom: dto.availableFrom !== undefined ? new Date(dto.availableFrom) : new Date(),
          totalSeconds: dto.totalSeconds,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
      ) {
        throw new ConflictException(`Session ${sessionId} already has a published recording`);
      }
      throw error;
    }
  }

  async findForSession(sessionId: string): Promise<SessionRecording> {
    const recording = await this.prisma.sessionRecording.findUnique({ where: { sessionId } });

    if (!recording) {
      throw new NotFoundException(`Session ${sessionId} has no published recording`);
    }

    return recording;
  }
}
