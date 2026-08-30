"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { BarChart3, Clock, Code2, Users, FileText, Play, Activity } from "lucide-react";

export default function AnalyticsPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await axios.get("http://localhost:3001/sessions/analytics/all");
      setSessions(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetails = async (id: string) => {
    setSelectedSessionId(id);
    setLoadingDetails(true);
    try {
      const res = await axios.get(`http://localhost:3001/sessions/analytics/${id}`);
      setSessionData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-8 flex flex-col h-screen overflow-hidden">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BarChart3 className="w-8 h-8 text-indigo-500" />
          ML Analytics Dashboard
        </h1>
        <p className="text-gray-400 mt-2">
          Analyze historical pair programming sessions and see how the model predicted collaborative states over time.
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-0">
        {/* Sessions List */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950 font-semibold text-zinc-300">
            Recorded Sessions
          </div>
          <div className="overflow-y-auto p-4 space-y-3 flex-1">
            {loading ? (
              <p className="text-zinc-500 text-center py-4">Loading sessions...</p>
            ) : sessions.length === 0 ? (
              <p className="text-zinc-500 text-center py-4">No sessions found.</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => fetchSessionDetails(s.id)}
                  className={`w-full text-left p-4 rounded-lg border transition ${
                    selectedSessionId === s.id 
                      ? "bg-indigo-900/30 border-indigo-500" 
                      : "bg-zinc-800/50 border-zinc-700 hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-mono text-sm text-indigo-300">{s.id}</span>
                    <span className="text-xs text-zinc-400">{new Date(s.startedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="text-sm text-zinc-300">
                    Final State: <span className="font-semibold text-surface-200">{s.predictions[0]?.predictedState || 'N/A'}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Timeline View */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950 font-semibold text-zinc-300 flex justify-between items-center">
            <span>Session Timeline</span>
            {sessionData && (
              <span className="text-sm font-normal text-zinc-400">
                Duration: {Math.round((new Date(sessionData.endedAt).getTime() - new Date(sessionData.startedAt).getTime()) / 60000)} mins
              </span>
            )}
          </div>
          
          <div className="overflow-y-auto p-6 flex-1 bg-zinc-950">
            {!selectedSessionId ? (
              <div className="h-full flex items-center justify-center text-zinc-500 italic">
                Select a session from the list to view its detailed timeline.
              </div>
            ) : loadingDetails ? (
              <div className="h-full flex items-center justify-center text-zinc-500">
                Loading timeline data...
              </div>
            ) : sessionData ? (
              <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-700 before:to-transparent">
                
                {/* We merge events and predictions and sort them by timestamp */}
                {mergeTimeline(sessionData.events, sessionData.predictions).map((item: any, i: number) => (
                  <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border border-surface-700 bg-surface-900 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                      {item.type === 'prediction' ? <Activity className="w-4 h-4 text-emerald-400" /> : <EventIcon type={item.eventType} />}
                    </div>
                    
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-slate-800 bg-slate-900/50 shadow">
                      <div className="flex items-center justify-between mb-1">
                        <time className="text-xs font-mono text-indigo-400">
                          Minute {Math.floor((new Date(item.timestamp).getTime() - new Date(sessionData.startedAt).getTime()) / 60000)}
                        </time>
                      </div>
                      
                      {item.type === 'prediction' ? (
                        <div>
                          <p className="text-sm font-semibold text-emerald-300 mb-1">State Prediction Generated</p>
                          <p className="text-lg font-bold text-surface-200">{item.predictedState}</p>
                          <p className="text-xs text-zinc-500 mt-1">Confidence: {(item.confidence * 100).toFixed(1)}%</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-zinc-300 capitalize">{item.eventType.replace('_', ' ')}</p>
                          <p className="text-xs text-zinc-400 mt-1">User: {item.userId} ({item.role})</p>
                          <EventMetadata metadata={item.metadata} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function mergeTimeline(events: any[] = [], predictions: any[] = []) {
  const items = [
    ...events.map(e => ({ ...e, type: 'event', timestamp: e.timestamp })),
    ...predictions.map(p => ({ ...p, type: 'prediction', timestamp: p.windowEnd }))
  ];
  return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function EventIcon({ type }: { type: string }) {
  switch (type) {
    case 'CODE_EDIT': return <Code2 className="w-4 h-4 text-blue-400" />;
    case 'CODE_RUN': return <Play className="w-4 h-4 text-amber-400" />;
    case 'DISCUSSION_NOTE': return <FileText className="w-4 h-4 text-purple-400" />;
    case 'ROLE_SWITCH': return <Users className="w-4 h-4 text-pink-400" />;
    default: return <Clock className="w-4 h-4 text-zinc-400" />;
  }
}

function EventMetadata({ metadata }: { metadata: any }) {
  if (!metadata) return null;
  const data = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  
  if (data.linesAdded !== undefined) return <p className="text-xs text-blue-300 mt-1">+{data.linesAdded} lines</p>;
  if (data.success !== undefined) return <p className={`text-xs mt-1 ${data.success ? 'text-emerald-400' : 'text-red-400'}`}>{data.success ? 'Run Succeeded' : `Failed: ${data.error || 'Syntax Error'}`}</p>;
  if (data.content) return <p className="text-xs text-purple-300 mt-1 italic">"{data.content}"</p>;
  return null;
}
