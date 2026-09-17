/**
 * What a student is asked before their pair sessions become research data.
 *
 * ================================ A DRAFT ================================
 * This wording has NOT been through an ethics review. Before any real
 * participant sees it, replace it with - or check it line by line against -
 * the wording in the approved ethics application, and change the version.
 *
 * The version is stored with every decision. A statement that changes after
 * someone agreed is different terms, so the page asks them again and the
 * export stops counting the old agreement - consent is never stretched over
 * terms nobody was shown.
 * =========================================================================
 */

export const RESEARCH_CONSENT_VERSION = '2026-09-draft-1';

export const CONSENT_DECISIONS = ['GRANTED', 'DECLINED'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

export const RESEARCH_CONSENT_STATEMENT = {
  title: 'Can your pair sessions help the research behind PairPath?',
  summary:
    'PairPath is part of a research project on how students program in pairs, and on whether ' +
    'well-timed nudges help. With your agreement, what happens in your sessions can be ' +
    "included in the project's data.",
  recorded: [
    'How much each of you edited and ran the code, and whether a run produced the expected output',
    'When you switched roles, and how often each of you wrote in the chat',
    'What the collaboration model read from the session, the nudges it showed, and how you responded',
    'Your answers to the review at the end of a session',
  ],
  protections: [
    'A session is included only if both people in it agreed',
    'Names, email addresses and account ids are replaced, and dates are removed',
    'What you typed - in the chat or in the editor - is not included',
  ],
  voluntary:
    'Pairing works exactly the same whichever you choose, and you can change your mind here at ' +
    'any time. Withdrawing keeps your sessions out of every export made after you withdraw.',
} as const;
