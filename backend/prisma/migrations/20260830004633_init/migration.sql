-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "codeCoachUserId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "starterCode" TEXT NOT NULL DEFAULT '',
    "referenceSolution" TEXT NOT NULL,
    "reviewQuestions" JSONB NOT NULL,
    "conceptTags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pair_sessions" (
    "id" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "finalCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pair_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pair_session_members" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pair_session_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_snapshots" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_windows" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "features" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pair_state_predictions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "predictedState" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pair_state_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interventions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "uiTarget" TEXT NOT NULL,
    "uiEffect" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_submissions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "conceptTags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkText" TEXT NOT NULL,
    "conceptTag" TEXT NOT NULL,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_sessions" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelSource" TEXT NOT NULL DEFAULT 'simulated',
    "rater" TEXT NOT NULL DEFAULT 'generator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulated_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "simulated_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_windows" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "windowStart" DOUBLE PRECISION NOT NULL,
    "windowEnd" DOUBLE PRECISION NOT NULL,
    "features" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "labelSource" TEXT NOT NULL DEFAULT 'simulated',
    "rater" TEXT NOT NULL DEFAULT 'generator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulated_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_codeCoachUserId_key" ON "users"("codeCoachUserId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pair_sessions_joinCode_key" ON "pair_sessions"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "pair_session_members_sessionId_userId_key" ON "pair_session_members"("sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "review_submissions_sessionId_userId_key" ON "review_submissions"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "simulated_sessions_label_idx" ON "simulated_sessions"("label");

-- CreateIndex
CREATE INDEX "simulated_events_sessionId_timestamp_idx" ON "simulated_events"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "simulated_events_eventType_idx" ON "simulated_events"("eventType");

-- CreateIndex
CREATE INDEX "simulated_windows_sessionId_idx" ON "simulated_windows"("sessionId");

-- CreateIndex
CREATE INDEX "simulated_windows_label_idx" ON "simulated_windows"("label");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_sessions" ADD CONSTRAINT "pair_sessions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_session_members" ADD CONSTRAINT "pair_session_members_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_session_members" ADD CONSTRAINT "pair_session_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_snapshots" ADD CONSTRAINT "code_snapshots_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_windows" ADD CONSTRAINT "feature_windows_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pair_state_predictions" ADD CONSTRAINT "pair_state_predictions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_submissions" ADD CONSTRAINT "review_submissions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "pair_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_submissions" ADD CONSTRAINT "review_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "rag_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_events" ADD CONSTRAINT "simulated_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "simulated_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_windows" ADD CONSTRAINT "simulated_windows_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "simulated_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
