import React from 'react';
import { Zap, LayoutDashboard, Briefcase, FileSearch, Activity, Settings as SettingsIcon } from 'lucide-react';

interface SidebarProps {
  failedCount: number;
  onShowManualReview: () => void;
  onShowHiringPosts: () => void;
  onShowSettings: () => void;
  status: string;
}

export function Sidebar({ failedCount, onShowManualReview, onShowHiringPosts, onShowSettings, status }: SidebarProps) {
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

        <div className="nav-item" onClick={onShowSettings}>
          <SettingsIcon className="w-4 h-4 shrink-0" />
          <span>Profile Settings</span>
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
