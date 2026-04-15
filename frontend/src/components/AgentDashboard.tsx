import React, { useRef, useEffect } from 'react';
import { Play, Square, CheckCircle2, AlertCircle, Clock, Terminal, ChevronRight, ExternalLink, Users } from 'lucide-react';
import { SystemState, Preferences, agents } from '../types';

interface DashboardProps {
  state: SystemState;
  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
  failedCount: number;
  handleStartAll: () => void;
  handleStartAgent: (id: string) => void;
  handleStop: () => void;
  onShowManualReview: () => void;
  onShowHiringPosts: () => void;
}

export default function AgentDashboard({
  state, prefs, setPrefs, failedCount, handleStartAll, handleStartAgent, handleStop, onShowManualReview, onShowHiringPosts
}: DashboardProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.logs]);

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
            onClick={state.status === 'Running' ? handleStop : handleStartAll}
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
              {agent.stub && (
                <span className="text-xs text-amber-400 border border-amber-500/30 rounded px-1 py-0.5 mt-0.5">STUB</span>
              )}
              <p className="text-sm text-slate-400 mt-1 mb-4">{agent.desc}</p>

              <button
                onClick={() => handleStartAgent(agent.id)}
                disabled={state.status === 'Running' || agent.stub}
                title={agent.stub ? 'Not yet implemented' : undefined}
                className={`mt-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-50 transition-colors border border-slate-700 hover:border-blue-500/50 ${agent.stub ? 'cursor-not-allowed' : ''}`}
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

        {/* Top/Secondary Action buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onShowHiringPosts}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 border relative
              bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:border-emerald-500/60
              shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]"
          >
            <Users className="w-4 h-4" />
            Hiring Posts
          </button>
          
          <button
            onClick={onShowManualReview}
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
                const isError = log.includes('[ERROR]') || log.includes('Fatal');
                const isSuccess = log.includes('✓') || log.includes('Completed Successfully');
                const isWarning = log.includes('✗') || log.includes('failed') || log.includes('Discarding') || log.includes('ERROR');
                return (
                  <div key={`${i}-${log.slice(0, 16)}`} className={`pb-1 ${
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
