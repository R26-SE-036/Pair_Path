"""SIMULATED demo-session generator — provenance is the whole point.

Generates enacted-style pair-programming sessions for each of the five
collaboration states so the END-TO-END PIPELINE can be demonstrated
(events -> windows -> labels -> training -> serving) before real pilot
data exists.

THIS IS NOT TRAINING DATA IN THE RESEARCH SENSE:
  * every emitted label carries label_source="simulated" and rater="generator"
  * the trainer only accepts it with the explicit --demo-simulated flag
  * the resulting model card and every API response are stamped demo_simulated
  * metrics measured on this data describe the generator, not students —
    do NOT quote them as model performance anywhere

Replace with human-labeled real sessions (see README pipeline) as soon as
they exist; the demo stamp disappears automatically on retrain.

Usage:
  python generate_demo_sessions.py --sessions-per-state 40
  # produces: data/raw_sessions/events.json     (build_windows.py input)
  #           data/labels/session_labels.csv    (session_id,label,label_source,rater)
#
# NOTE: filenames carry no provenance marker. What identifies this data as
# simulated is the `label_source=simulated` column written into the labels,
# which the trainer checks — it refuses to train unless every row is
# label_source="human", or --demo-simulated is passed explicitly.
"""

import argparse
import json
import os
import random

SESSION_SECONDS = 12 * 60
USERS = ("U1", "U2")

STATES = ["PRODUCTIVE", "DRIVER_DOMINANCE", "PASSIVE_NAVIGATOR", "LOGIC_STRUGGLE", "DISENGAGED"]


def emit(events, t, session, user, etype, meta=None):
    events.append({
        "sessionId": session,
        "userId": user,
        "eventType": etype,
        "metadata": json.dumps(meta or {}),
        "timestamp": t,
    })


def gen_session(session_id, state, base_t, rng):
    """One enacted session. Parameters are drawn with noise so sessions of
    the same state differ and states overlap somewhat at the edges."""
    events = []
    roles = {USERS[0]: "DRIVER", USERS[1]: "NAVIGATOR"}
    driver, navigator = USERS[0], USERS[1]

    def switch(t):
        nonlocal driver, navigator, roles
        driver, navigator = navigator, driver
        roles = {driver: "DRIVER", navigator: "NAVIGATOR"}
        emit(events, t, session_id, driver, "ROLE_SWITCH", {"newRoles": dict(roles)})

    emit(events, base_t, session_id, USERS[0], "JOIN")
    emit(events, base_t + rng.uniform(1, 8), session_id, USERS[1], "JOIN")

    if state == "PRODUCTIVE":
        edit_gap = rng.uniform(8, 14)
        note_every = rng.uniform(45, 80)
        run_every = rng.uniform(90, 140)
        success_p = rng.uniform(0.6, 0.9)
        switch_times = sorted(rng.uniform(180, SESSION_SECONDS - 120) for _ in range(rng.choice([1, 2])))
        nav_note_p = rng.uniform(0.45, 0.7)
    elif state == "DRIVER_DOMINANCE":
        # The navigator here is ENGAGED — contributing verbally, wanting in —
        # but never gets the keyboard. That verbal engagement is what separates
        # this from PASSIVE_NAVIGATOR (silent), and it is why the correct
        # intervention is "switch roles": the navigator is ready to drive.
        edit_gap = rng.uniform(6, 11)
        note_every = rng.uniform(60, 110)
        run_every = rng.uniform(100, 160)
        success_p = rng.uniform(0.5, 0.8)
        switch_times = []  # defining trait: roles never rotate
        nav_note_p = rng.uniform(0.45, 0.7)
    elif state == "PASSIVE_NAVIGATOR":
        edit_gap = rng.uniform(8, 13)
        note_every = rng.uniform(150, 300)
        run_every = rng.uniform(100, 160)
        success_p = rng.uniform(0.5, 0.85)
        switch_times = [rng.uniform(250, 450)] if rng.random() < 0.5 else []
        nav_note_p = 0.0  # defining trait: navigator never speaks
    elif state == "LOGIC_STRUGGLE":
        edit_gap = rng.uniform(9, 15)
        note_every = rng.uniform(50, 90)  # they DO talk — they're stuck, not silent
        run_every = rng.uniform(45, 75)   # hammering the run button
        success_p = rng.uniform(0.05, 0.25)
        switch_times = [rng.uniform(200, 500)] if rng.random() < 0.4 else []
        nav_note_p = rng.uniform(0.4, 0.6)
    else:  # DISENGAGED
        edit_gap = rng.uniform(35, 70)  # sparse, but enough to clear min_events
        note_every = rng.uniform(400, 900)
        run_every = rng.uniform(400, 900)
        success_p = rng.uniform(0.3, 0.7)
        switch_times = []
        nav_note_p = rng.uniform(0.0, 0.3)

    next_edit = base_t + rng.uniform(5, 20)
    next_note = base_t + note_every * rng.uniform(0.5, 1.2)
    next_run = base_t + run_every * rng.uniform(0.6, 1.3)
    switch_queue = [base_t + s for s in switch_times]

    t = base_t
    end = base_t + SESSION_SECONDS
    while t < end:
        t = min(next_edit, next_note, next_run, *(switch_queue or [end + 1]), end)
        if t >= end:
            break
        if switch_queue and t == switch_queue[0]:
            switch(t)
            switch_queue.pop(0)
        elif t == next_edit:
            emit(events, t, session_id, driver, "CODE_EDIT", {"codeLength": rng.randint(80, 900)})
            next_edit = t + edit_gap * rng.uniform(0.6, 1.6)
        elif t == next_note:
            author = navigator if rng.random() < nav_note_p else driver
            emit(events, t, session_id, author, "DISCUSSION_NOTE", {"note": "simulated demo note"})
            next_note = t + note_every * rng.uniform(0.6, 1.6)
        elif t == next_run:
            emit(events, t, session_id, driver, "CODE_RUN", {"codeLength": rng.randint(80, 900)})
            ok = rng.random() < success_p
            emit(events, t + rng.uniform(1, 3), session_id, driver, "CODE_RUN_RESULT",
                 {"success": ok, "hasError": not ok})
            next_run = t + run_every * rng.uniform(0.6, 1.6)

    return events


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions-per-state", type=int, default=12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--data-dir", "--out-dir", dest="data_dir", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"),
        help="Data root. Events land in <data-dir>/raw_sessions, labels in "
             "<data-dir>/labels — the same folders real sessions use. The "
             "'demo_' filename prefix is what marks these as simulated.")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    raw_dir = os.path.join(args.data_dir, "raw_sessions")
    labels_dir = os.path.join(args.data_dir, "labels")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    all_events, labels = [], []
    base_t = 1_780_000_000.0
    for state in STATES:
        for i in range(args.sessions_per_state):
            session_id = f"demo_{state.lower()}_{i:02d}"
            all_events.extend(gen_session(session_id, state, base_t, rng))
            labels.append(f"{session_id},{state},simulated,generator")
            base_t += SESSION_SECONDS + 3600

    events_path = os.path.join(raw_dir, "events.json")
    labels_path = os.path.join(labels_dir, "session_labels.csv")
    with open(events_path, "w") as f:
        json.dump(all_events, f)
    with open(labels_path, "w") as f:
        f.write("session_id,label,label_source,rater\n" + "\n".join(labels) + "\n")

    n = args.sessions_per_state * len(STATES)
    print(f"[SUCCESS] {n} SIMULATED sessions ({len(all_events)} events) -> {events_path}")
    print(f"[SUCCESS] session labels (label_source=simulated) -> {labels_path}")
    print("[REMINDER] Demo/pipeline-validation use only — never report metrics "
          "from this data as model performance.")


if __name__ == "__main__":
    main()
