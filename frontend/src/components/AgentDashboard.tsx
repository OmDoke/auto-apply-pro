import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Square, Search, MapPin, Layers,
  ChevronDown, ChevronUp, Sliders, Target,
  BriefcaseBusiness, Wifi, XCircle,
} from 'lucide-react';
import { SystemState, Preferences, agents } from '../types';
import { apiService } from '../services/api';
import { Sidebar } from './Sidebar';
import { StatCards } from './StatCards';
import { AgentGrid } from './AgentGrid';
import { LiveLogs } from './LiveLogs';

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
  onShowSettings: () => void;
}

// ── Main Dashboard ────────────────────────────────────────────────────────
export default function AgentDashboard({
  state, prefs, setPrefs, failedCount,
  handleStartAll, handleStartAgent, handleStop,
  onShowManualReview, onShowHiringPosts, onShowSettings,
}: DashboardProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [chromeReady, setChromeReady] = useState(false);
  const [chromeLoading, setChromeLoading] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        onShowSettings={onShowSettings}
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
              {isRunning && (
                <button onClick={handleStop} className="btn-danger">
                  <Square fill="currentColor" className="w-3.5 h-3.5" /> Stop
                </button>
              )}
            </div>
          </div>

          {/* ── Preferences & Screening Panel ────────────────────── */}
          <div className="card anim-fade-up">
            <button
              id="settings-panel-toggle"
              className="w-full flex items-center justify-between px-5 py-4 text-left"
              onClick={() => setSettingsOpen(v => !v)}
            >
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold text-slate-200">
                  Search Preferences & Screening
                </span>
                {prefs.minMatchScore > 0 ? (
                  <span className="badge badge-running text-xs px-2 py-0.5 ml-1">
                    Match ≥ {prefs.minMatchScore}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-500 ml-1">(scoring off)</span>
                )}
              </div>
              {settingsOpen
                ? <ChevronUp  className="w-4 h-4 text-slate-500" />
                : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {settingsOpen && (
              <div className="px-5 pb-5 grid grid-cols-1 gap-4 border-t border-slate-800 pt-4">

                {/* Skills */}
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Must-Have Skills (comma-separated)
                  </label>
                  <input
                    id="pref-skills"
                    type="text"
                    value={prefs.skills}
                    onChange={e => setPrefs({ ...prefs, skills: e.target.value })}
                    placeholder="React, TypeScript, Node.js, Python..."
                    className="input w-full"
                  />
                  <p className="text-xs text-slate-600 mt-1">
                    Used by Gemini to score job descriptions before applying
                  </p>
                </div>

                {/* Match Score Slider */}
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Minimum Match Score:&nbsp;
                    <span className="text-indigo-400 font-bold">{prefs.minMatchScore}%</span>
                    {prefs.minMatchScore === 0 && (
                      <span className="text-slate-500 ml-1">— apply all jobs (scoring disabled)</span>
                    )}
                  </label>
                  <input
                    id="pref-match-score"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={prefs.minMatchScore}
                    onChange={e => setPrefs({ ...prefs, minMatchScore: Number(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-slate-600 mt-1">
                    <span>0 (off)</span>
                    <span>20 (lenient)</span>
                    <span>60 (balanced)</span>
                    <span>80 (strict)</span>
                    <span>100</span>
                  </div>
                </div>

                {/* Job Type + Work Mode */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                      <BriefcaseBusiness className="w-3.5 h-3.5" /> Job Type
                    </label>
                    <select
                      id="pref-job-type"
                      value={prefs.jobType}
                      onChange={e => setPrefs({ ...prefs, jobType: e.target.value as Preferences['jobType'] })}
                      className="input w-full"
                    >
                      <option value="any">Any</option>
                      <option value="full-time">Full-time</option>
                      <option value="internship">Internship</option>
                      <option value="contract">Contract</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                      <Wifi className="w-3.5 h-3.5" /> Work Mode
                    </label>
                    <select
                      id="pref-work-mode"
                      value={prefs.workMode}
                      onChange={e => setPrefs({ ...prefs, workMode: e.target.value as Preferences['workMode'] })}
                      className="input w-full"
                    >
                      <option value="any">Any</option>
                      <option value="remote">Remote</option>
                      <option value="hybrid">Hybrid</option>
                      <option value="onsite">Onsite</option>
                    </select>
                  </div>
                </div>

                {/* Exclude Companies + Keywords */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Exclude Companies
                    </label>
                    <input
                      id="pref-exclude-companies"
                      type="text"
                      value={prefs.excludeCompanies}
                      onChange={e => setPrefs({ ...prefs, excludeCompanies: e.target.value })}
                      placeholder="HT Media, NIIT, Wipro..."
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Exclude Keywords in JD
                    </label>
                    <input
                      id="pref-exclude-keywords"
                      type="text"
                      value={prefs.excludeKeywords}
                      onChange={e => setPrefs({ ...prefs, excludeKeywords: e.target.value })}
                      placeholder="Senior, Lead, 5+ years, US Citizen..."
                      className="input w-full"
                    />
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* ── Stat Cards ────────────────────────────── */}
          <StatCards 
            activeCount={activeCount}
            runningAgentName={runningAgent?.name ?? '…'}
            completedCount={completedCount}
            totalActive={totalActive}
            failedCount={failedCount}
            logCount={state.appliedCount || 0}
            isRunning={isRunning}
          />

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
          <AgentGrid 
            state={state}
            isRunning={isRunning}
            chromeReady={chromeReady}
            chromeLoading={chromeLoading}
            handleStartAgent={handleStartAgent}
            handleOpenChrome={handleOpenChrome}
          />

          {/* ── Live Logs ─────────────────────────────── */}
          <LiveLogs 
            logs={state.logs}
            isRunning={isRunning}
            logsOpen={logsOpen}
            setLogsOpen={setLogsOpen}
            logEndRef={logEndRef}
          />

        </div>
      </main>
    </div>
  );
}

