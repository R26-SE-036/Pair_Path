"use client";

import { useState } from "react";
import axios from "axios";
import { BrainCircuit, Activity, AlertCircle, RotateCcw } from "lucide-react";

const ML_URL = process.env.NEXT_PUBLIC_ML_SERVICE_URL || "http://localhost:8000";

// The 15 features the current model consumes, in the order the extractor emits
// them. These names must match app/features/extractor.py — an earlier version of
// this page sent a retired naming scheme, so every value silently resolved to
// zero and the model returned the same prediction whatever the sliders said.
type Features = {
  total_edit_count: number;
  driver_edit_count: number;
  navigator_edit_count: number;
  edit_balance_ratio: number;
  run_attempt_count: number;
  run_success_rate: number;
  consecutive_failure_count: number;
  error_recovery_seconds_avg: number;
  idle_ratio: number;
  discussion_note_count: number;
  navigator_note_count: number;
  role_switch_count: number;
  seconds_since_role_switch: number;
  session_elapsed_seconds: number;
  active_user_dominance: number;
};

// Median values of each state in the synthetic corpus — a realistic starting
// point per state rather than invented numbers.
const PRESETS: Record<string, Features> = {
  PRODUCTIVE: {
    total_edit_count: 15, driver_edit_count: 14, navigator_edit_count: 0, edit_balance_ratio: 1,
    run_attempt_count: 1, run_success_rate: 1, consecutive_failure_count: 0,
    error_recovery_seconds_avg: 0, idle_ratio: 0.17, discussion_note_count: 3,
    navigator_note_count: 1, role_switch_count: 0, seconds_since_role_switch: 210,
    session_elapsed_seconds: 450, active_user_dominance: 0.89,
  },
  DRIVER_DOMINANCE: {
    total_edit_count: 18, driver_edit_count: 18, navigator_edit_count: 0, edit_balance_ratio: 1,
    run_attempt_count: 1, run_success_rate: 1, consecutive_failure_count: 0,
    error_recovery_seconds_avg: 0, idle_ratio: 0.06, discussion_note_count: 2,
    navigator_note_count: 1, role_switch_count: 0, seconds_since_role_switch: 450,
    session_elapsed_seconds: 450, active_user_dominance: 0.95,
  },
  PASSIVE_NAVIGATOR: {
    total_edit_count: 16, driver_edit_count: 16, navigator_edit_count: 0, edit_balance_ratio: 1,
    run_attempt_count: 1, run_success_rate: 1, consecutive_failure_count: 0,
    error_recovery_seconds_avg: 0, idle_ratio: 0.17, discussion_note_count: 1,
    navigator_note_count: 0, role_switch_count: 0, seconds_since_role_switch: 300,
    session_elapsed_seconds: 450, active_user_dominance: 1,
  },
  LOGIC_STRUGGLE: {
    total_edit_count: 13, driver_edit_count: 13, navigator_edit_count: 0, edit_balance_ratio: 1,
    run_attempt_count: 3, run_success_rate: 0, consecutive_failure_count: 2,
    error_recovery_seconds_avg: 0, idle_ratio: 0.17, discussion_note_count: 2,
    navigator_note_count: 1, role_switch_count: 0, seconds_since_role_switch: 383,
    session_elapsed_seconds: 450, active_user_dominance: 0.95,
  },
  DISENGAGED: {
    total_edit_count: 3, driver_edit_count: 3, navigator_edit_count: 0, edit_balance_ratio: 1,
    run_attempt_count: 0, run_success_rate: 0.5, consecutive_failure_count: 0,
    error_recovery_seconds_avg: 0, idle_ratio: 0.78, discussion_note_count: 0,
    navigator_note_count: 0, role_switch_count: 0, seconds_since_role_switch: 450,
    session_elapsed_seconds: 450, active_user_dominance: 1,
  },
};

type SliderSpec = { key: keyof Features; label: string; min: number; max: number; step: number };

const GROUPS: { title: string; note?: string; sliders: SliderSpec[] }[] = [
  {
    title: "Activity",
    sliders: [
      { key: "total_edit_count", label: "Total edits", min: 0, max: 40, step: 1 },
      { key: "driver_edit_count", label: "Edits by the driver", min: 0, max: 40, step: 1 },
      { key: "navigator_edit_count", label: "Edits by the navigator", min: 0, max: 40, step: 1 },
      { key: "idle_ratio", label: "Idle ratio (1 = nothing happening)", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Running code",
    sliders: [
      { key: "run_attempt_count", label: "Run attempts", min: 0, max: 12, step: 1 },
      { key: "run_success_rate", label: "Run success rate", min: 0, max: 1, step: 0.05 },
      { key: "consecutive_failure_count", label: "Longest failure streak", min: 0, max: 10, step: 1 },
      { key: "error_recovery_seconds_avg", label: "Avg seconds to recover from a failure", min: 0, max: 300, step: 5 },
    ],
  },
  {
    title: "Talking",
    note: "Navigator messages are what separate driver dominance from a passive navigator.",
    sliders: [
      { key: "discussion_note_count", label: "Messages from both students", min: 0, max: 15, step: 1 },
      { key: "navigator_note_count", label: "Messages from the navigator", min: 0, max: 15, step: 1 },
    ],
  },
  {
    title: "Roles and time",
    note: "Time since the last swap is what separates driver dominance from a productive pair.",
    sliders: [
      { key: "role_switch_count", label: "Role swaps in this window", min: 0, max: 5, step: 1 },
      { key: "seconds_since_role_switch", label: "Seconds since the last swap", min: 0, max: 900, step: 10 },
      { key: "session_elapsed_seconds", label: "Seconds the session has been running", min: 0, max: 1800, step: 30 },
    ],
  },
  {
    title: "Derived",
    note: "Normally computed from the values above; adjustable here for experimentation.",
    sliders: [
      { key: "edit_balance_ratio", label: "Edit balance (1 = one person did all edits)", min: 0, max: 1, step: 0.05 },
      { key: "active_user_dominance", label: "Activity dominance (1 = one person did everything)", min: 0, max: 1, step: 0.05 },
    ],
  },
];

export default function SandboxPage() {
  const [features, setFeatures] = useState<Features>(PRESETS.PRODUCTIVE);
  const [loading, setLoading] = useState(false);
  const [prediction, setPrediction] = useState<any>(null);
  const [intervention, setIntervention] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePredict = async () => {
    setLoading(true);
    setError(null);
    try {
      const stateRes = await axios.post(`${ML_URL}/predict-pair-state`, {
        sessionId: "sandbox-session",
        features,
      });
      setPrediction(stateRes.data);

      const interventionRes = await axios.post(`${ML_URL}/recommend-intervention`, {
        sessionId: "sandbox-session",
        predictedState: stateRes.data.predictedState,
        confidence: stateRes.data.confidence,
      });
      setIntervention(interventionRes.data);

      // A hint accompanies a logic struggle — keyed off the predicted state,
      // which is what the live gateway does.
      if (stateRes.data.predictedState === "LOGIC_STRUGGLE") {
        const hintRes = await axios.post(`${ML_URL}/retrieve-hint`, {
          sessionId: "sandbox-session",
          pairId: "",
          predictedState: "LOGIC_STRUGGLE",
          interventionType: "LOGIC_HINT",
          questionConceptTags: ["arrays", "loops"],
          recentErrorContext: "",
          recentCodeSnippet: "",
        });
        setIntervention((prev: any) => ({ ...prev, hint: hintRes.data }));
      }
    } catch (err) {
      console.error(err);
      setError(`Could not reach the ML service at ${ML_URL}. Is it running?`);
    } finally {
      setLoading(false);
    }
  };

  const updateFeature = (key: keyof Features, val: string | number) =>
    setFeatures((prev) => ({ ...prev, [key]: Number(val) }));

  const applyPreset = (name: string) => {
    setFeatures(PRESETS[name]);
    setPrediction(null);
    setIntervention(null);
  };

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BrainCircuit className="w-8 h-8 text-blue-500" />
          ML Model Sandbox
        </h1>
        <p className="text-gray-400 mt-2">
          Adjust the window features below to see how the classifier reads a pair&apos;s
          collaboration. Load a preset to start from a realistic example of each state.
        </p>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-400 flex items-center gap-1.5">
          <RotateCcw className="w-4 h-4" /> Load a typical:
        </span>
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            onClick={() => applyPreset(name)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
          >
            {name.replace(/_/g, " ").toLowerCase()}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sliders */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
          <h2 className="text-xl font-semibold border-b border-zinc-800 pb-2 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Window features
          </h2>

          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wide">
                  {group.title}
                </h3>
                {group.note && <p className="text-xs text-zinc-500 mt-1">{group.note}</p>}
              </div>
              {group.sliders.map((s) => (
                <FeatureSlider
                  key={s.key}
                  label={s.label}
                  value={features[s.key]}
                  onChange={(v: number) => updateFeature(s.key, v)}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                />
              ))}
            </div>
          ))}

          <button
            onClick={handlePredict}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition text-white font-bold py-3 px-4 rounded-lg mt-6"
          >
            {loading ? "Predicting..." : "Predict pair state"}
          </button>
        </div>

        {/* Results */}
        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 h-full flex flex-col">
            <h2 className="text-xl font-semibold mb-4 border-b border-zinc-800 pb-2 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-emerald-400" />
              Prediction
            </h2>

            {error ? (
              <div className="flex-1 flex items-center justify-center text-rose-400 text-sm text-center px-4">
                {error}
              </div>
            ) : !prediction ? (
              <div className="flex-1 flex items-center justify-center text-zinc-500 italic text-center px-4">
                Load a preset or adjust the sliders, then predict.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
                  <p className="text-sm text-zinc-400 mb-1">Predicted state</p>
                  <p className="text-3xl font-bold text-white mb-2">
                    {prediction.predictedState.replace(/_/g, " ")}
                  </p>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-400">Confidence</span>
                    <span className="text-emerald-400 font-mono">
                      {(prediction.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-zinc-700">
                    <span className="text-zinc-500">Model</span>
                    <span className="text-zinc-400 font-mono">{prediction.modelVersion}</span>
                  </div>
                  {prediction.modelVersion?.startsWith("demo_synthetic") && (
                    <p className="text-xs text-amber-400/80 mt-2 italic">
                      Trained on synthetic sessions — for demonstration, not real-world accuracy.
                    </p>
                  )}
                </div>

                {intervention && (
                  <div className="p-4 rounded-lg bg-indigo-900/20 border border-indigo-500/30">
                    <p className="text-sm text-indigo-400 mb-2 font-semibold">
                      Recommended intervention
                    </p>
                    <div className="space-y-2 text-sm">
                      <p><span className="text-zinc-400">Action:</span> <span className="text-white">{intervention.action}</span></p>
                      <p><span className="text-zinc-400">Target:</span> <span className="text-white">{intervention.delivery?.uiTarget}</span></p>
                      <p><span className="text-zinc-400">Effect:</span> <span className="text-white">{intervention.delivery?.uiEffect}</span></p>
                      <div className="mt-4 p-3 bg-zinc-950 rounded border border-zinc-800 font-mono text-zinc-300">
                        &ldquo;{intervention.delivery?.message}&rdquo;
                      </div>
                    </div>

                    {intervention.hint && (
                      <div className="mt-4 space-y-3 pt-4 border-t border-indigo-500/30">
                        <p className="text-sm text-indigo-400 font-semibold mb-2">
                          Retrieved hint
                        </p>
                        <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                          <p className="text-xs text-blue-400 font-semibold mb-1">Concept reminder</p>
                          <p className="text-sm text-zinc-200">{intervention.hint.conceptReminder}</p>
                        </div>
                        <div className="p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg">
                          <p className="text-xs text-emerald-400 font-semibold mb-1">Example idea</p>
                          <p className="text-sm text-zinc-200">{intervention.hint.exampleIdea}</p>
                        </div>
                        <div className="p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg">
                          <p className="text-xs text-amber-400 font-semibold mb-1">Reflective question</p>
                          <p className="text-sm text-zinc-200">{intervention.hint.reflectiveQuestion}</p>
                        </div>
                        {intervention.hint.fallbackUsed && (
                          <p className="text-xs text-rose-400 mt-2 italic">
                            Fallback used — nothing matched in the corpus.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function FeatureSlider({ label, value, onChange, min, max, step }: any) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1 gap-3">
        <label className="text-zinc-300">{label}</label>
        <span className="text-blue-400 font-mono tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  );
}
