"""Canonical sliding-window feature extraction (L5).

This is the ONLY feature implementation. The NestJS gateway sends raw
session events here at inference time, and the offline dataset builder
(dev_tools/build_windows.py) imports this same class for training data —
eliminating the train/serve mismatch the audit found (two hand-written
extractors, Python vs TypeScript, drifting apart).

Feature names are window-agnostic: the window length is a parameter
(ML_WINDOW_SECONDS, default 180), to be settled by the L5 ablation rather
than baked into column names as `_1m`/`_3m`.

Expected event shape (matches the SessionEvent table / gateway payload):
    {"timestamp": ISO8601 str or epoch ms, "userId": str,
     "eventType": str, "metadata": dict or JSON str}
Roles: {userId: "DRIVER" | "NAVIGATOR"} as of the window end.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_WINDOW_SECONDS = int(os.getenv("ML_WINDOW_SECONDS", "180"))

# Bucket size for idle detection: a second-bucket is "active" if any event
# falls inside it; idle_ratio = inactive buckets / total buckets.
IDLE_BUCKET_SECONDS = 10

FEATURE_COLUMNS = [
    "total_edit_count",
    "driver_edit_count",
    "navigator_edit_count",
    "edit_balance_ratio",
    "run_attempt_count",
    "run_success_rate",
    "consecutive_failure_count",
    "error_recovery_seconds_avg",
    "idle_ratio",
    "discussion_note_count",
    "navigator_note_count",
    "role_switch_count",
    "seconds_since_role_switch",
    "session_elapsed_seconds",
    "active_user_dominance",
]


def _to_epoch_seconds(ts: Any) -> Optional[float]:
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        # Heuristic: epoch ms vs epoch s
        return ts / 1000.0 if ts > 1e12 else float(ts)
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.timestamp()
    return None


def _metadata(event: Dict[str, Any]) -> Dict[str, Any]:
    meta = event.get("metadata", {})
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except (ValueError, TypeError):
            meta = {}
    return meta if isinstance(meta, dict) else {}


class WindowFeatureExtractor:
    def __init__(self, window_seconds: int = DEFAULT_WINDOW_SECONDS):
        self.window_seconds = window_seconds

    def extract(
        self,
        events: List[Dict[str, Any]],
        roles: Optional[Dict[str, str]] = None,
        window_end: Optional[float] = None,
        last_role_switch_at: Optional[float] = None,
        session_start_at: Optional[float] = None,
    ) -> Dict[str, float]:
        """Compute the canonical feature vector for one window.

        events: raw session events (any order); only those inside
                [window_end - window_seconds, window_end] are used.
        roles: userId -> DRIVER/NAVIGATOR as of window_end.
        window_end: epoch seconds; defaults to the latest event timestamp.
        last_role_switch_at: epoch seconds of the most recent ROLE_SWITCH
                before window_end, if known from outside the window.
        """
        roles = roles or {}

        stamped = []
        for e in events:
            ts = _to_epoch_seconds(e.get("timestamp"))
            if ts is not None:
                stamped.append((ts, e))
        stamped.sort(key=lambda pair: pair[0])

        if window_end is None:
            window_end = stamped[-1][0] if stamped else 0.0
        window_start = window_end - self.window_seconds

        in_window = [(ts, e) for ts, e in stamped if window_start < ts <= window_end]

        edits = [(ts, e) for ts, e in in_window if e.get("eventType") == "CODE_EDIT"]
        runs = [(ts, e) for ts, e in in_window if e.get("eventType") == "CODE_RUN_RESULT"]
        notes = [(ts, e) for ts, e in in_window if e.get("eventType") == "DISCUSSION_NOTE"]
        switches = [(ts, e) for ts, e in in_window if e.get("eventType") == "ROLE_SWITCH"]

        # ── Edits ──
        driver_edits = sum(1 for _, e in edits if roles.get(e.get("userId")) == "DRIVER")
        navigator_edits = sum(1 for _, e in edits if roles.get(e.get("userId")) == "NAVIGATOR")
        edits_by_user: Dict[str, int] = {}
        for _, e in edits:
            uid = e.get("userId") or ""
            edits_by_user[uid] = edits_by_user.get(uid, 0) + 1
        total_edits = len(edits)
        edit_balance = (max(edits_by_user.values()) / total_edits) if total_edits else 0.5

        # ── Runs ──
        run_results = [bool(_metadata(e).get("success")) for _, e in runs]
        run_success_rate = (sum(run_results) / len(run_results)) if run_results else 0.5
        max_fail_streak = streak = 0
        for ok in run_results:
            streak = 0 if ok else streak + 1
            max_fail_streak = max(max_fail_streak, streak)

        # Error recovery: time from each failed run to the next successful one
        recovery_times = []
        fail_ts: Optional[float] = None
        for (ts, _), ok in zip(runs, run_results):
            if not ok and fail_ts is None:
                fail_ts = ts
            elif ok and fail_ts is not None:
                recovery_times.append(ts - fail_ts)
                fail_ts = None
        error_recovery_avg = (sum(recovery_times) / len(recovery_times)) if recovery_times else 0.0

        # ── Idle ratio (bucketed activity) ──
        n_buckets = max(1, self.window_seconds // IDLE_BUCKET_SECONDS)
        active_buckets = {
            int((ts - window_start) // IDLE_BUCKET_SECONDS) for ts, _ in in_window
        }
        idle_ratio = 1.0 - (len(active_buckets) / n_buckets)

        # ── Discussion ──
        navigator_notes = sum(1 for _, e in notes if roles.get(e.get("userId")) == "NAVIGATOR")

        # ── Roles ──
        # How long the session has been running at this window's end. Lets the
        # model tell "no rotation yet, 2 minutes in" (normal) from "no rotation,
        # 20 minutes in" (dominance) — indistinguishable without it.
        if session_start_at is None:
            session_start_at = stamped[0][0] if stamped else window_end
        session_elapsed = max(0.0, window_end - session_start_at)

        if switches:
            seconds_since_switch = window_end - switches[-1][0]
        elif last_role_switch_at is not None:
            seconds_since_switch = window_end - last_role_switch_at
        else:
            # Never rotated: measure from session start, NOT capped at the
            # window length. Capping made a pair that never switched look
            # identical to one that switched a window ago, which is precisely
            # what blurred DRIVER_DOMINANCE against PRODUCTIVE.
            seconds_since_switch = session_elapsed

        # ── Dominance across all event types ──
        events_by_user: Dict[str, int] = {}
        for _, e in in_window:
            uid = e.get("userId") or ""
            if uid:
                events_by_user[uid] = events_by_user.get(uid, 0) + 1
        total_user_events = sum(events_by_user.values())
        dominance = (max(events_by_user.values()) / total_user_events) if total_user_events else 0.5

        return {
            "total_edit_count": float(total_edits),
            "driver_edit_count": float(driver_edits),
            "navigator_edit_count": float(navigator_edits),
            "edit_balance_ratio": round(edit_balance, 4),
            "run_attempt_count": float(len(runs)),
            "run_success_rate": round(run_success_rate, 4),
            "consecutive_failure_count": float(max_fail_streak),
            "error_recovery_seconds_avg": round(error_recovery_avg, 2),
            "idle_ratio": round(idle_ratio, 4),
            "discussion_note_count": float(len(notes)),
            "navigator_note_count": float(navigator_notes),
            "role_switch_count": float(len(switches)),
            "seconds_since_role_switch": round(seconds_since_switch, 2),
            "session_elapsed_seconds": round(session_elapsed, 2),
            "active_user_dominance": round(dominance, 4),
        }

    def sliding_windows(
        self,
        events: List[Dict[str, Any]],
        roles: Optional[Dict[str, str]] = None,
        stride_seconds: int = 30,
        min_events: int = 3,
    ) -> List[Dict[str, Any]]:
        """Offline path: slide over a whole session's events and emit one
        feature row per window. Windows with fewer than min_events events
        are skipped (matching the runtime's low-activity rule so training
        never sees windows the model won't be asked about)."""
        stamped = sorted(
            (ts for ts in (_to_epoch_seconds(e.get("timestamp")) for e in events) if ts is not None)
        )
        if not stamped:
            return []

        rows = []
        t = stamped[0] + self.window_seconds
        last_switch: Optional[float] = None
        while t <= stamped[-1] + stride_seconds:
            window_events = [
                e for e in events
                if (ts := _to_epoch_seconds(e.get("timestamp"))) is not None
                and t - self.window_seconds < ts <= t
            ]
            # Track the most recent switch before this window end
            for e in events:
                ts = _to_epoch_seconds(e.get("timestamp"))
                if ts is not None and ts <= t and e.get("eventType") == "ROLE_SWITCH":
                    last_switch = ts if last_switch is None else max(last_switch, ts)
            if len(window_events) >= min_events:
                features = self.extract(
                    window_events, roles, window_end=t, last_role_switch_at=last_switch
                )
                rows.append(
                    {
                        "window_start": t - self.window_seconds,
                        "window_end": t,
                        **features,
                    }
                )
            t += stride_seconds
        return rows
