/**
 * What leaves this API, stated once.
 *
 * ==================== WHY THIS FILE EXISTS ====================
 * Prisma's `include: { x: true }` returns every scalar column on the row. It
 * is the shape every tutorial shows, it reads as "give me the question", and
 * nothing about it looks like a leak at the call site. Two things were leaking
 * through it, on a dozen queries:
 *
 *   the password hash    `include: { user: true }` on sessions and reviews
 *                        put both students' bcrypt hashes in the JSON body of
 *                        GET /sessions/:id, /sessions/my,
 *                        /sessions/analytics/:id, /reviews/:sessionId and the
 *                        responses to creating or joining a session.
 *
 *   the answer           `include: { question: true }` carries
 *                        referenceSolution - a complete, working solution to
 *                        the exercise - so the pair received it in the browser
 *                        the moment the workspace loaded, before they had
 *                        written a line. Nothing in the API or the client
 *                        reads that field; it was served because it was there.
 *
 * The fix is one constant per shape rather than a hand-written `select` at
 * each call site, because the twelfth call site is the one somebody forgets,
 * and a leak on one endpoint is harder to notice than a leak on all of them.
 * =============================================================
 */

/**
 * A partner's identity.
 *
 * `email` is deliberately absent. The workspace, the review, the results and
 * the session record all display names, so including it would be handing out
 * an identifier no feature asks for.
 */
export const PUBLIC_USER = Object.freeze({
  id: true,
  firstName: true,
  lastName: true,
} as const);

/** A session member, with the partner's name and nothing else about them. */
export const PUBLIC_MEMBERS = Object.freeze({
  select: {
    id: true,
    userId: true,
    role: true,
    joinedAt: true,
    user: { select: PUBLIC_USER },
  },
} as const);

/**
 * A question as a student may see it.
 *
 * An allowlist, not a denylist: a field added to the schema is invisible here
 * until somebody names it, which is the right default for a table holding two
 * different answers to the exercise.
 *
 * Excluded: `referenceSolution`, and `expectedOutput` for the same reason -
 * for "print 10 down to 1" or "print the grade for 74", the expected output
 * IS the answer, and a pair could read it out of the payload that told them
 * they were wrong. The server compares against it and sends back a verdict
 * only.
 *
 * `starterCode` is included and should be - it is the scaffold the pair
 * begins from. `reviewQuestions` is included because the peer-review page
 * needs it, and `conceptTags` because retrieval and the platform taxonomy key
 * on it.
 */
export const PUBLIC_QUESTION_FIELDS = Object.freeze({
  id: true,
  topicId: true,
  title: true,
  description: true,
  difficulty: true,
  starterCode: true,
  reviewQuestions: true,
  conceptTags: true,
  createdAt: true,
  updatedAt: true,
} as const);

/** Use where a relation is included: `question: PUBLIC_QUESTION`. */
export const PUBLIC_QUESTION = Object.freeze({
  select: PUBLIC_QUESTION_FIELDS,
} as const);

/** A question with its topic, for the pair set-up screens. */
export const PUBLIC_QUESTION_WITH_TOPIC = Object.freeze({
  ...PUBLIC_QUESTION_FIELDS,
  topic: true,
} as const);
