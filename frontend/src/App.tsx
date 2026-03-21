import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { Play, Square, CheckCircle2, AlertCircle, Clock, Terminal, ChevronRight, ExternalLink, ArrowLeft, Trash2, Link } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

type AgentStatus = 'Idle' | 'Running' | 'Success' | 'Failed';

interface SystemState {
  status: AgentStatus;
  currentAgent: string | null;
  logs: string[];
}

interface FailedJob {
  title: string;
  company: string;
  url: string;
}

const agents = [
  { id: 'LinkedIn Agent', name: 'LinkedIn Auto-Apply', desc: 'Easy Apply for jobs' },
  { id: 'Naukri Agent', name: 'Naukri visibility', desc: 'Profile bounce & refresh' },
  { id: 'Aggregator Agent', name: 'Job Aggregator', desc: 'Scrape leads to JSON' }
];

function ManualReviewPage({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [view, setView] = useState<'list' | 'browse'>('list');

  useEffect(() => {
    axios.get(`${API_BASE}/failed-jobs`).then(res => {
      setJobs(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleClear = async () => {
    if (!confirm('Clear the entire failed jobs list? This cannot be undone.')) return;
    await axios.delete(`${API_BASE}/failed-jobs`);
    setJobs([]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between glass-panel p-6 rounded-2xl">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 text-sm text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                Manual Review Queue
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">Jobs the agent could not auto-apply to</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {jobs.length > 0 && (
              <>
                <button
                  onClick={() => { setCurrentIdx(0); setView('browse'); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-sm font-semibold text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]"
                >
                  <Link className="w-4 h-4" /> Browse One by One
                </button>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-900/40 hover:border-rose-500/40 transition-colors border border-slate-700 text-sm text-slate-400 hover:text-rose-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Browse mode - one at a time */}
        {view === 'browse' && jobs.length > 0 && (
          <div className="glass-panel p-8 rounded-2xl space-y-6">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>Job {currentIdx + 1} of {jobs.length}</span>
              <button onClick={() => setView('list')} className="text-slate-500 hover:text-slate-300">← Back to list</button>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-100">{jobs[currentIdx].title}</h2>
              <p className="text-lg text-slate-400">{jobs[currentIdx].company}</p>
              <p className="text-xs text-slate-600 break-all">{jobs[currentIdx].url}</p>
            </div>

            <a
              href={jobs[currentIdx].url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)]"
            >
              <ExternalLink className="w-5 h-5" />
              Open Job Page & Apply Manually
            </a>

            <div className="flex gap-3">
              <button
                onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                disabled={currentIdx === 0}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors text-sm font-medium border border-slate-700"
              >
                ← Previous
              </button>
              <button
                onClick={() => setCurrentIdx(Math.min(jobs.length - 1, currentIdx + 1))}
                disabled={currentIdx === jobs.length - 1}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors text-sm font-medium border border-slate-700"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* List mode */}
        {(view === 'list' || jobs.length === 0) && (
          <div className="glass-panel rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-slate-500">Loading...</div>
            ) : jobs.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <p className="text-slate-400 font-medium">No failed jobs — great job!</p>
                <p className="text-slate-600 text-sm">All jobs were either successfully applied to or not yet processed.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {jobs.map((job, idx) => (
                  <div key={idx} className="flex items-center justify-between p-5 hover:bg-slate-800/50 transition-colors group">
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <p className="font-semibold text-slate-200 truncate">{job.title}</p>
                      <p className="text-sm text-slate-400">{job.company}</p>
                    </div>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 ml-4 px-4 py-2 rounded-lg bg-slate-700 hover:bg-blue-600 text-slate-300 hover:text-white transition-all text-sm font-medium shrink-0 border border-slate-600 hover:border-blue-500"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<SystemState>({
    status: 'Idle',
    currentAgent: null,
    logs: []
  });

  const [prefs, setPrefs] = useState({ jobTitle: 'Software Engineer', location: 'Bangalore' });
  const [failedCount, setFailedCount] = useState(0);
  const [showManualReview, setShowManualReview] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [socket, setSocket] = useState<Socket | null>(null);

  const fetchFailedCount = async () => {
    try {
      const res = await axios.get(`${API_BASE}/failed-jobs`);
      setFailedCount(res.data.length);
    } catch {}
  };

  useEffect(() => {
    fetchFailedCount();
    
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('statusUpdate', (newStatus: SystemState) => {
      setState(newStatus);
      if (newStatus.status === 'Success' || newStatus.status === 'Failed') {
        fetchFailedCount();
      }
    });

    newSocket.on('log', (logMessage: string) => {
      setState(prev => ({
        ...prev,
        logs: [...prev.logs, logMessage]
      }));
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.logs]);

  const handleStart = async () => {
    if (state.status === 'Running') return;
    socket?.emit('start', prefs);
  };

  const handleStartAgent = async (agentId: string) => {
    if (state.status === 'Running') return;
    socket?.emit('start', { ...prefs, agentId });
  };

  const handleStop = async () => {
    socket?.emit('stop');
  };

  const getStatusIcon = (agentId: string) => {
    const agentIndex = agents.findIndex(a => a.id === agentId);
    const currentIndex = agents.findIndex(a => a.id === state.currentAgent);

    if (state.status === 'Success') {
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    }
    if (agentId === state.currentAgent) {
      if (state.status === 'Running') {
        return <div className="w-5 h-5 border-2 border-t-blue-500 rounded-full animate-spin" />;
      }
      if (state.status === 'Failed') {
        return <AlertCircle className="w-5 h-5 text-rose-500" />;
      }
    }
    if ((state.status === 'Running' || state.status === 'Failed') && currentIndex > agentIndex) {
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    }
    return <Clock className="w-5 h-5 text-slate-500" />;
  };

  if (showManualReview) {
    return <ManualReviewPage onBack={() => { setShowManualReview(false); fetchFailedCount(); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between glass-panel p-6 rounded-2xl gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Universal Job Agent
            </h1>
            <p className="text-slate-400 mt-1">Automated Career Growth Engine</p>
          </div>

          <div className="flex flex-col md:flex-row gap-4 flex-1 max-w-lg md:ml-auto">
            <input
              type="text"
              value={prefs.jobTitle}
              onChange={e => setPrefs({...prefs, jobTitle: e.target.value})}
              placeholder="Job Title"
              className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 transition-colors"
            />
            <input
              type="text"
              value={prefs.location}
              onChange={e => setPrefs({...prefs, location: e.target.value})}
              placeholder="Location"
              className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 transition-colors"
            />
          </div>

          <button
            onClick={state.status === 'Running' ? handleStop : handleStart}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all duration-300 ml-auto md:ml-0 ${
              state.status === 'Running'
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_20px_rgba(225,29,72,0.3)] hover:shadow-[0_0_25px_rgba(225,29,72,0.5)]'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)]'
            }`}
          >
            {state.status === 'Running' ? (
              <><Square fill="currentColor" className="w-4 h-4 shrink-0" /> Stop Current</>
            ) : (
              <><Play fill="currentColor" className="w-4 h-4 shrink-0" /> Start All</>
            )}
          </button>
        </header>

        {/* Pipeline Visualizer */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {agents.map((agent, i) => (
            <div key={agent.id} className="glass-panel p-6 rounded-2xl flex flex-col items-center text-center relative">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-4 border border-slate-700">
                {getStatusIcon(agent.id)}
              </div>
              <h3 className="font-semibold text-lg text-slate-200">{agent.name}</h3>
              <p className="text-sm text-slate-400 mt-1 mb-4">{agent.desc}</p>

              <button
                onClick={() => handleStartAgent(agent.id)}
                disabled={state.status === 'Running'}
                className="mt-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-50 transition-colors border border-slate-700 hover:border-blue-500/50"
              >
                <Play className="w-4 h-4" /> Start
              </button>

              {i < agents.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                  <ChevronRight className="w-6 h-6 text-slate-600" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Did Not Apply button */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowManualReview(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 border relative
              bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30 hover:border-amber-500/60
              shadow-[0_0_15px_rgba(245,158,11,0.1)] hover:shadow-[0_0_20px_rgba(245,158,11,0.2)]"
          >
            <ExternalLink className="w-4 h-4" />
            Did Not Apply
            {failedCount > 0 && (
              <span className="absolute -top-2 -right-2 flex items-center justify-center w-5 h-5 bg-amber-500 text-slate-950 rounded-full text-xs font-bold">
                {failedCount}
              </span>
            )}
          </button>
        </div>

        {/* Log Viewer */}
        <div className="glass-panel rounded-2xl overflow-hidden flex flex-col h-[400px]">
          <div className="bg-slate-900 px-6 py-4 flex items-center gap-3 border-b border-slate-800">
            <Terminal className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-slate-300">Live Execution Logs</span>
            <div className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border ${
              state.status === 'Running' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
              state.status === 'Success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
              state.status === 'Failed' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
              'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              Status: {state.status}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 font-mono text-sm space-y-2 bg-[#0a0a0a]">
            {state.logs.length === 0 ? (
              <div className="text-slate-600 italic text-center mt-10">System ready. Waiting for initialization...</div>
            ) : (
              state.logs.map((log, i) => {
                const isError = log.includes('ERROR') || log.includes('✗');
                const isSuccess = log.includes('✓') || log.includes('Completed Successfully');
                const isWarning = log.includes('✗') || log.includes('failed') || log.includes('Discarding');
                return (
                  <div key={i} className={`pb-1 ${
                    isError ? 'text-rose-400' :
                    isSuccess ? 'text-emerald-400' :
                    isWarning ? 'text-amber-400' :
                    'text-slate-400'
                  }`}>
                    {log}
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
