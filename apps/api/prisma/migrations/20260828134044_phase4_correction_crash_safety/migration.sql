-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED');

-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "NotificationOutboxItem" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProviderWebhookEvent" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "meetingProvisioningClaimedAt" TIMESTAMP(3);

