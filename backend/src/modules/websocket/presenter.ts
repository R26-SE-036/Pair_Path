/**
 * Presenter mode: the ML engine made visible, for showing it to a panel.
 *
 * ======================= WHY THIS EXISTS =======================
 * The model reads a 180-second window, and in a normal session it is asked
 * once a minute, on a failed run and every 30 events, with a five-minute
 * cooldown per nudge. Acting out one state until it fills a window takes
 * about three minutes, so showing all five live takes longer than a viva
 * gives one student. Presenter mode keeps the model, the window and the gate
 * exactly as they are, and changes only what a presenter needs:
 *
 *   - the session is asked every PRESENTER_PREDICT_MS instead of every minute
 *   - a nudge type stays quiet for PRESENTER_COOLDOWN_MS instead of five minutes
 *   - every prediction is shown, not only the ones that become a nudge: the
 *     state, all five probabilities, the features and what the engine decided
 *   - one held-out window per state can be replayed through the live engine
 *     (content/demo-windows.ts), so all five nudges can be shown in a minute
 *
 * A presenter session writes nothing to the research tables. Its predictions
 * come every ten seconds over overlapping windows, its replays are not this
 * pair's behaviour at all, and the research record is meant to be one window
 * a minute of real sessions. Its nudges are not stored either, for the same
 * reason; their ids start with `presenter-` so a response to one is
 * recognised and dropped.
 *
 * On by default so the live server can show it without a config change; set
 * PAIRPATH_PRESENTER_MODE=off to refuse it.
 * ================================================================
 */

export const PRESENTER_PREDICT_MS = 10_000;
export const PRESENTER_COOLDOWN_MS = 20_000;
export const PRESENTER_ID_PREFIX = 'presenter-';

export function presenterModeAllowed(): boolean {
  return (process.env.PAIRPATH_PRESENTER_MODE ?? '').trim().toLowerCase() !== 'off';
}

/** One recorded window, as content/demo-windows.ts stores it. */
export interface DemoWindow {
  /** The state the window was labelled with. */
  state: string;
  sourceSession: string;
  windowSeconds: number;
  roles: Record<string, string>;
  /** Seconds before the window end, or null when nobody had switched yet. */
  lastRoleSwitchOffset: number | null;
  sessionStartOffset: number;
  events: Array<{ offset: number; userId: string; eventType: string; metadata: string }>;
  modelAtExport: { version: string; state: string; confidence: number };
}

export interface DemoWindows {
  modelVersion: string;
  windows: DemoWindow[];
}

/**
 * A recorded window, moved so it ends now - the shape the live path sends.
 *
 * Only the timestamps move. The events, the roles, how long ago the last
 * switch was and how old the session is are the recording's own, so the
 * extractor computes the same fifteen features it did at export.
 */
export function replayRequest(window: DemoWindow, sessionId: string, nowMs: number) {
  const end = nowMs / 1000;
  return {
    sessionId,
    events: window.events.map((e) => ({
      timestamp: new Date((end + e.offset) * 1000),
      userId: e.userId,
      eventType: e.eventType,
      metadata: e.metadata,
    })),
    roles: window.roles,
    lastRoleSwitchAt: window.lastRoleSwitchOffset === null ? undefined : end + window.lastRoleSwitchOffset,
    sessionStartAt: end + window.sessionStartOffset,
    windowEnd: end,
  };
}

/** What the engine did with a prediction, in the presenter's terms. */
export type NudgeDecision =
  | 'sent'
  | 'below_gate'
  | 'no_action'
  | 'cooldown'
  | 'target_offline'
  | 'too_few_events'
  | 'unavailable';

/** One prediction, as the presenter view draws it. Never sent outside presenter mode. */
export interface PredictionReport {
  source: 'live' | 'replay';
  at: string;
  decision: NudgeDecision;
  eventCount: number;
  state?: string;
  confidence?: number;
  probabilities?: Record<string, number> | null;
  modelVersion?: string;
  features?: Record<string, number>;
  action?: string;
  audience?: string;
  replay?: { sourceSession: string; label: string };
}

/** Is this cooldown key still quiet? Prunes the expired ones it passes. */
export function cooling(cooldowns: Map<string, number>, key: string, nowMs: number): boolean {
  const until = cooldowns.get(key);
  if (until === undefined) return false;
  if (until <= nowMs) {
    cooldowns.delete(key);
    return false;
  }
  return true;
}
