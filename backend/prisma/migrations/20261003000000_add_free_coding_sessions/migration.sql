-- Free-coding sessions: a pair session with no question.
--
-- Every existing row is an exercise session and keeps its question; the
-- default fills `mode` in for them.

-- AlterTable
ALTER TABLE "pair_sessions" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'EXERCISE';
ALTER TABLE "pair_sessions" ALTER COLUMN "questionId" DROP NOT NULL;

-- An exercise session always has its question, and a free one never does.
-- Not in schema.prisma, which cannot express a CHECK; Prisma leaves it alone.
ALTER TABLE "pair_sessions" ADD CONSTRAINT "pair_sessions_mode_question_check" CHECK (
    ("mode" = 'EXERCISE' AND "questionId" IS NOT NULL)
    OR ("mode" = 'FREE' AND "questionId" IS NULL)
);
