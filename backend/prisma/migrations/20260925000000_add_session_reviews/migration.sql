-- CreateTable
CREATE TABLE "session_reviews" (
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_reviews_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "review_answers" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "choice" INTEGER NOT NULL,
    "correct" BOOLEAN,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_answers_sessionId_userId_step_key" ON "review_answers"("sessionId", "userId", "step");

-- AddForeignKey
ALTER TABLE "session_reviews" ADD CONSTRAINT "session_reviews_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
