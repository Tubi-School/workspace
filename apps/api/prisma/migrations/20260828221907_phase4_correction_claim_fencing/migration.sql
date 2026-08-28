-- AlterTable
ALTER TABLE "NotificationOutboxItem" ADD COLUMN     "claimToken" TEXT;

-- AlterTable
ALTER TABLE "ProviderWebhookEvent" ADD COLUMN     "claimToken" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "meetingProvisioningClaimToken" TEXT;

