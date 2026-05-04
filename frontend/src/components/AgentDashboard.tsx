import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play, Square, CheckCircle2, AlertCircle, Clock, Terminal,
  ExternalLink, Chrome, LayoutDashboard, FileSearch,
  Briefcase, Activity, Zap, TrendingUp, AlertTriangle,
  ChevronRight, Search, MapPin, Wifi, WifiOff, Bot,
  Layers, BarChart2, Sparkles, ArrowUpRight, Circle,
} from 'lucide-react';
import { SystemState, Preferences, agents } from '../types';
import { apiService } from '../services/api';

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

// ── Sidebar ───────────────────────────────────────────────────────────────
function Sidebar({ failedCount, onShowManualReview, onShowHiringPosts, status }: {
  failedCount: number; onShowManualReview: () => void;
  onShowHiringPosts: () => void; status: string;
}) {
  const isRunning = status === 'Running';
  return (
    <nav className="sidebar">
      {/* Brand */}
      <div className="px-5 pt-7 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg glow-indigo shrink-0">
            <Zap className="w-5 h-5 text-white" fill="currentColor" />
          </div>
          <div>
            <p className="font-bold text-slate-100 text-base leading-none tracking-tight">AutoApply Pro</p>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Career Engine v2</p>
          </div>
        </div>
      </div>

      <div className="divider mx-4" />

      {/* Status Banner */}
      <div className="px-4 py-4">
        <p className="section-label mb-2.5">System Status</p>
        <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-300 ${
          isRunning
            ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25'
            : status === 'Success'
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
            : status === 'Failed'
            ? 'bg-rose-500/10 text-rose-300 border-rose-500/25'
            : 'bg-white/5 text-slate-500 border-white/8'
        }`}>
          {isRunning && <span className="live-dot" />}
          {!isRunning && status !== 'Running' && (
            <span className={`w-2 h-2 rounded-full ${
              status === 'Success' ? 'bg-emerald-400' :
              status === 'Failed' ? 'bg-rose-400' : 'bg-slate-600'
            }`} />
          )}
          {isRunning ? 'Agent Running…' : status === 'Success' ? 'All Done' : status === 'Failed' ? 'Failed' : 'Ready'}
        </div>
      </div>

      {/* Navigation */}
      <div className="px-3 flex-1 space-y-0.5">
        <p className="section-label mb-2.5 px-1">Navigation</p>

        <div className="nav-item active">
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          <span>Dashboard</span>
        </div>

        <div className="nav-item" onClick={onShowHiringPosts}>
          <Briefcase className="w-4 h-4 shrink-0" />
          <span>Hiring Posts</span>
          <span className="ml-auto text-[10px] text-slate-700 font-medium">Scraper</span>
        </div>

        <div className="nav-item" onClick={onShowManualReview}>
          <FileSearch className="w-4 h-4 shrink-0" />
          <span>Manual Review</span>
          {failedCount > 0 && (
            <span className="ml-auto min-w-[20px] h-5 px-1.5 bg-amber-500 text-slate-900 rounded-full text-[10px] font-bold flex items-center justify-center">
              {failedCount}
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="divider mx-4" />
      <div className="px-5 py-4 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
          <Activity className="w-3.5 h-3.5 text-slate-600" />
        </div>
        <span className="text-xs text-slate-600 font-medium">Production Build</span>
      </div>
    </nav>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color, delay = 0 }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; delay?: number;
}) {
  return (
    <div className="stat-card anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-3xl font-bold text-slate-100 tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Agent Status Icon ─────────────────────────────────────────────────────
function AgentStatusIcon({ agentId, state }: { agentId: string; state: SystemState }) {
  const agentIndex = agents.findIndex(a => a.id === agentId);
  const currentIndex = agents.findIndex(a => a.id === state.currentAgent);
  if (state.status === 'Success') return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
  if (agentId === state.currentAgent) {
    if (state.status === 'Running') return (
      <div className="w-5 h-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full anim-spin-slow" />
    );
    if (state.status === 'Failed') return <AlertCircle className="w-5 h-5 text-rose-400" />;
  }
  if ((state.status === 'Running' || state.status === 'Failed') && currentIndex > agentIndex)
    return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
  return <Circle className="w-5 h-5 text-slate-700" />;
}

// ── Log Line ──────────────────────────────────────────────────────────────
function LogLine({ log, idx }: { log: string; idx: number }) {
  const isError   = log.includes('[ERROR]') || log.includes('Fatal') || log.includes('❌');
  const isSuccess = log.includes('✓') || log.includes('✅') || log.includes('Applied!');
  const isWarning = log.includes('⚠️') || log.includes('✗') || log.includes('Warning');
  const isInfo    = log.includes('═══') || log.includes('───') || log.includes('Phase') || log.includes('===');
  const isBold    = log.includes('[') && log.includes(']');

  return (
    <div className={`log-line flex gap-2 ${
      isError   ? 'text-rose-400'   :
      isSuccess ? 'text-emerald-400':
      isWarning ? 'text-amber-400'  :
      isInfo    ? 'text-indigo-400' : 'text-slate-500'
    }`}>
      <span className="text-slate-700 shrink-0 select-none w-7 text-right">{idx + 1}</span>
      <span className="flex-1 break-all">{log}</span>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────
export default function AgentDashboard({
  state, prefs, setPrefs, failedCount,
  handleStartAll, handleStartAgent, handleStop,
  onShowManualReview, onShowHiringPosts,
}: DashboardProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [chromeReady, setChromeReady] = useState(false);
  const [chromeLoading, setChromeLoading] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);

  const isRunning = state.status === 'Running';

  const activeCount = isRunning ? 1 : 0;
  const completedCount = (() => {
    if (state.status === 'Success') return agents.filter(a => !a.stub).length;
    if (!state.currentAgent) return 0;
    const idx = agents.findIndex(a => a.id === state.currentAgent);
    return Math.max(0, idx);
  })();

  const totalActive = agents.filter(a => !a.stub).length;
  const progressPct = totalActive > 0 ? Math.round((completedCount / totalActive) * 100) : 0;

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [state.logs]);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = await apiService.getChromeStatus();
      if (mounted) setChromeReady(ok);
    };
    check();
    const id = setInterval(check, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const handleOpenChrome = useCallback(async () => {
    setChromeLoading(true);
    const result = await apiService.openChrome();
    if (!result.ok) alert(result.message);
    setTimeout(async () => {
      const ok = await apiService.getChromeStatus();
      setChromeReady(ok);
      setChromeLoading(false);
    }, 3000);
  }, []);

  const runningAgent = agents.find(a => a.id === state.currentAgent);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        failedCount={failedCount}
        onShowManualReview={onShowManualReview}
        onShowHiringPosts={onShowHiringPosts}
        status={state.status}
      />

      <main className="main-content flex-1 grid-bg">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-7">

          {/* ── Top Bar ───────────────────────────────── */}
          <div className="flex items-start justify-between anim-fade-up">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-3xl font-bold text-grd-indigo tracking-tight">Dashboard</h1>
                {isRunning && (
                  <span className="badge badge-running ml-1">
                    <span className="live-dot" />Live
                  </span>
                )}
              </div>
              <p className="text-slate-500 text-sm">
                {isRunning && runningAgent
                  ? <>Running <span className="text-indigo-400 font-medium">{runningAgent.name}</span></>
                  : 'All agents ready — configure and launch'}
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                <input
                  type="text"
                  value={prefs.jobTitle}
                  onChange={e => setPrefs({ ...prefs, jobTitle: e.target.value })}
                  placeholder="Job Title"
                  className="input pl-9 w-44"
                />
              </div>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                <input
                  type="text"
                  value={prefs.location}
                  onChange={e => setPrefs({ ...prefs, location: e.target.value })}
                  placeholder="Location"
                  className="input pl-9 w-36"
                />
              </div>
              {isRunning ? (
                <button onClick={handleStop} className="btn-danger">
                  <Square fill="currentColor" className="w-3.5 h-3.5" /> Stop
                </button>
              ) : (
                <button onClick={handleStartAll} className="btn-primary">
                  <Sparkles className="w-3.5 h-3.5" /> Start All
                </button>
              )}
            </div>
          </div>

          {/* ── Stat Cards ────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Activity}       label="Active Agents"  value={activeCount}     sub={isRunning ? runningAgent?.name ?? '…' : 'None running'} color="bg-indigo-500/15 text-indigo-400"  delay={0}   />
            <StatCard icon={CheckCircle2}   label="Completed"      value={completedCount}  sub={`of ${totalActive} agents`}                            color="bg-emerald-500/15 text-emerald-400" delay={60}  />
            <StatCard icon={AlertTriangle}  label="Review Queue"   value={failedCount}     sub={failedCount > 0 ? 'Needs manual apply' : 'All clear'}  color={failedCount > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-800 text-slate-600'} delay={120} />
            <StatCard icon={BarChart2}      label="Log Events"     value={state.logs.length} sub="This session"                                        color="bg-violet-500/15 text-violet-400"   delay={180} />
          </div>

          {/* ── Progress Row ──────────────────────────── */}
          {(isRunning || completedCount > 0) && (
            <div className="card px-6 py-4 anim-fade-in">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-semibold text-slate-300">Session Progress</span>
                </div>
                <span className="text-sm font-bold text-indigo-400">{progressPct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-slate-600 mt-2">{completedCount} of {totalActive} agents completed</p>
            </div>
          )}

          {/* ── Agent Grid ────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-4 anim-fade-up delay-200">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Agents</h2>
              </div>
              <span className="text-xs text-slate-600 font-medium">
                {agents.filter(a => !a.stub).length} active · {agents.filter(a => a.stub).length} coming soon
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent, i) => {
                const isCurrentlyRunning = agent.id === state.currentAgent && isRunning;
                const agentIdx = agents.findIndex(a => a.id === agent.id);
                const currentIdx = agents.findIndex(a => a.id === state.currentAgent);
                const isDone = state.status === 'Success' ||
                  ((isRunning || state.status === 'Failed') && currentIdx > agentIdx);

                return (
                  <div
                    key={agent.id}
                    className={`agent-card anim-fade-up ${isCurrentlyRunning ? 'is-running' : ''} ${isDone ? 'is-done' : ''}`}
                    style={{ animationDelay: `${i * 60 + 200}ms` }}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300 ${
                        isCurrentlyRunning
                          ? 'bg-indigo-600/20 border-indigo-500/40'
                          : isDone
                          ? 'bg-emerald-600/15 border-emerald-500/25'
                          : 'bg-white/5 border-white/8'
                      }`}>
                        <AgentStatusIcon agentId={agent.id} state={state} />
                      </div>

                      {agent.stub ? (
                        <span className="badge badge-soon">Soon</span>
                      ) : isCurrentlyRunning ? (
                        <span className="badge badge-running"><span className="live-dot" />Running</span>
                      ) : isDone ? (
                        <span className="badge badge-success">Done</span>
                      ) : (
                        <span className="badge badge-idle">Idle</span>
                      )}
                    </div>

                    {/* Body */}
                    <h3 className="font-bold text-slate-200 text-sm mb-1.5">{agent.name}</h3>
                    <p className="text-xs text-slate-500 flex-1 mb-5 leading-relaxed">{agent.desc}</p>

                    {/* Actions */}
                    <div className="mt-auto space-y-2">
                      <button
                        onClick={() => handleStartAgent(agent.id)}
                        disabled={isRunning || !!agent.stub}
                        className="btn-agent"
                      >
                        <Play className="w-3.5 h-3.5" fill="currentColor" />
                        {isCurrentlyRunning ? 'Running…' : 'Run Agent'}
                      </button>

                      {/* Chrome helper — Indeed only */}
                      {agent.id === 'Indeed Agent' && (
                        <div className="pt-2 border-t border-white/[0.05] space-y-1.5">
                          <button
                            onClick={handleOpenChrome}
                            disabled={chromeLoading}
                            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-40"
                          >
                            <Chrome className="w-3.5 h-3.5" />
                            {chromeLoading ? 'Launching Chrome…' : 'Open Chrome (port 9222)'}
                          </button>
                          <div className="flex items-center justify-center gap-1.5 text-[10px]">
                            {chromeReady ? (
                              <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-500">Connected</span></>
                            ) : (
                              <><WifiOff className="w-3 h-3 text-slate-700" /><span className="text-slate-700">Not connected</span></>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Live Logs ─────────────────────────────── */}
          <div className="card overflow-hidden anim-fade-up delay-300">
            {/* Log header */}
            <button
              onClick={() => setLogsOpen(o => !o)}
              className="w-full flex items-center justify-between px-6 py-4 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <span className="font-bold text-slate-300 text-sm">Live Logs</span>
                {state.logs.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-500 text-xs border border-white/[0.08]">
                    {state.logs.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium">
                    <span className="live-dot" />Live
                  </span>
                )}
                <ChevronRight className={`w-4 h-4 text-slate-600 transition-transform duration-200 ${logsOpen ? 'rotate-90' : ''}`} />
              </div>
            </button>

            {logsOpen && (
              <div className="h-72 overflow-y-auto p-5" style={{ background: 'rgba(4, 6, 10, 0.8)' }}>
                {state.logs.length === 0 ? (
                  <div className="empty-state py-12">
                    <div className="empty-icon">
                      <Terminal className="w-7 h-7 text-slate-600" />
                    </div>
                    <p className="text-slate-600 text-sm font-medium">No logs yet</p>
                    <p className="text-slate-700 text-xs">Start an agent to see live output here</p>
                  </div>
                ) : (
                  <div>
                    {state.logs.map((log, i) => (
                      <LogLine key={`${i}-${log.slice(0, 12)}`} log={log} idx={i} />
                    ))}
                    {isRunning && (
                      <div className="log-line text-slate-600 cursor-blink mt-1">›</div>
                    )}
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
