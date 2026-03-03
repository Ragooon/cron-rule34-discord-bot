-- CreateTable
CREATE TABLE "cronjobs" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "message" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cronjobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cronjobs_guildId_idx" ON "cronjobs"("guildId");

-- CreateIndex
CREATE INDEX "cronjobs_isActive_idx" ON "cronjobs"("isActive");

-- CreateIndex
CREATE INDEX "cronjobs_guildId_isActive_idx" ON "cronjobs"("guildId", "isActive");
