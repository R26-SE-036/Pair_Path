-- CreateTable
CREATE TABLE "research_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_consents_userId_decidedAt_idx" ON "research_consents"("userId", "decidedAt");

-- AddForeignKey
ALTER TABLE "research_consents" ADD CONSTRAINT "research_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
