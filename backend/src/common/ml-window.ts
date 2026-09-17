/**
 * The feature window a live prediction is cut with.
 *
 * Every value here has to agree with dev_tools/build_windows.py, which built
 * the training set, and with the ML service. The model reads a positional
 * vector: a window cut differently at serving time is a different input, and
 * nothing downstream can tell.
 *
 *   ML_WINDOW_SECONDS  build_windows --window-seconds, and ML_WINDOW_SECONDS in
 *                      the ML service's Dockerfile. Read from the same variable
 *                      so one setting moves every side.
 *   MIN_WINDOW_EVENTS  build_windows --min-events. Training skipped any window
 *                      with fewer events than this, so the model has never
 *                      been shown one and has no business classifying it.
 *   MAX_WINDOW_EVENTS  a safety cap on the query, far above what 180 seconds of
 *                      per-keystroke editing produces. It is not a sampling
 *                      rule: reaching it would reintroduce the truncation the
 *                      time-bounded query exists to prevent, so the gateway
 *                      logs when it does.
 */

export const ML_WINDOW_SECONDS = Number(process.env.ML_WINDOW_SECONDS) || 180;
export const MIN_WINDOW_EVENTS = 3;
export const MAX_WINDOW_EVENTS = 5000;
