-- CreateEnum
CREATE TYPE "MeetingProvisioningStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROVISIONED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "meetingProvider" TEXT,
ADD COLUMN     "meetingProvisioningError" TEXT,
ADD COLUMN     "meetingProvisioningStatus" "MeetingProvisioningStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "providerMeetingId" TEXT,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SessionRecording" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerRecordingId" TEXT;

-- CreateTable
CREATE TABLE "LiveParticipantSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "providerParticipantId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveParticipantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "subscriptionAccessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutboxItem" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "NotificationOutboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveParticipantSession_sessionId_providerParticipantId_key" ON "LiveParticipantSession"("sessionId", "providerParticipantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_provider_externalEventId_key" ON "ProviderWebhookEvent"("provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerReference_key" ON "PaymentOrder"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_subscriptionAccessId_key" ON "PaymentOrder"("subscriptionAccessId");

-- CreateIndex
CREATE INDEX "PaymentOrder_learnerId_idx" ON "PaymentOrder"("learnerId");

-- CreateIndex
CREATE INDEX "NotificationOutboxItem_status_idx" ON "NotificationOutboxItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_providerMeetingId_key" ON "Session"("providerMeetingId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecording_providerRecordingId_key" ON "SessionRecording"("providerRecordingId");

-- AddForeignKey
ALTER TABLE "LiveParticipantSession" ADD CONSTRAINT "LiveParticipantSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveParticipantSession" ADD CONSTRAINT "LiveParticipantSession_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "LearnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "Offering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_subscriptionAccessId_fkey" FOREIGN KEY ("subscriptionAccessId") REFERENCES "SubscriptionAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

