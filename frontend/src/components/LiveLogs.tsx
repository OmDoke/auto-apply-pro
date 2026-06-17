import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Terminal, ChevronRight } from 'lucide-react';

interface LogLineProps {
  log: string;
  idx: number;
}

function LogLine({ log, idx }: LogLineProps) {
  const isError   = log.includes('[ERROR]') || log.includes('Fatal') || log.includes('❌');
  const isSuccess = log.includes('✓') || log.includes('✅') || log.includes('Applied!');
  const isWarning = log.includes('⚠️') || log.includes('✗') || log.includes('Warning');
  const isInfo    = log.includes('═══') || log.includes('───') || log.includes('Phase') || log.includes('===');

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

interface LiveLogsProps {
  logs: string[];
  isRunning: boolean;
  logsOpen: boolean;
  setLogsOpen: (open: boolean) => void;
  logEndRef: React.RefObject<HTMLDivElement>;
}

export function LiveLogs({ logs, isRunning, logsOpen, setLogsOpen, logEndRef }: LiveLogsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Tracks whether the user has scrolled up (pausing auto-scroll)
  const userScrolledUp = useRef(false);
  const [filter, setFilter] = useState<'all' | 'success' | 'error' | 'warning'>('all');

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    const isError   = log.includes('[ERROR]') || log.includes('Fatal') || log.includes('❌');
    const isSuccess = log.includes('✓') || log.includes('✅') || log.includes('Applied!');
    const isWarning = log.includes('⚠️') || log.includes('✗') || log.includes('Warning');
    if (filter === 'error') return isError;
    if (filter === 'success') return isSuccess;
    if (filter === 'warning') return isWarning;
    return true;
  });

  // When user scrolls manually, check if they've gone up
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If more than 100px from bottom → user scrolled up, pause auto-scroll
    userScrolledUp.current = distanceFromBottom > 100;
  }, []);

  // Auto-scroll to bottom only if user hasn't scrolled up
  useEffect(() => {
    if (!logsOpen) return;
    if (userScrolledUp.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, logsOpen]);

  return (
    <div className="card overflow-hidden anim-fade-up delay-300">
      {/* Log header */}
      <button
        onClick={() => setLogsOpen(!logsOpen)}
        className="w-full flex items-center justify-between px-6 py-4 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <span className="font-bold text-slate-300 text-sm">Live Logs</span>
          {logs.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-white/[0.05] text-slate-500 text-xs border border-white/[0.08]">
              {logs.length}
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
        <>
          <div className="flex items-center gap-2 px-6 py-3 border-b border-white/[0.06] bg-slate-900/50">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">Filter</span>
            <button 
              onClick={() => setFilter('all')} 
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === 'all' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              All
            </button>
            <button 
              onClick={() => setFilter('success')} 
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${filter === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              ✅ Success
            </button>
            <button 
              onClick={() => setFilter('error')} 
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${filter === 'error' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              ❌ Errors
            </button>
            <button 
              onClick={() => setFilter('warning')} 
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${filter === 'warning' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              ⚠️ Warnings
            </button>
          </div>
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-72 overflow-y-auto p-5"
            style={{ background: 'rgba(4, 6, 10, 0.8)' }}
          >
          {logs.length === 0 ? (
            <div className="empty-state py-12">
              <div className="empty-icon">
                <Terminal className="w-7 h-7 text-slate-600" />
              </div>
              <p className="text-slate-600 text-sm font-medium">No logs yet</p>
              <p className="text-slate-700 text-xs">Start an agent to see live output here</p>
            </div>
          ) : (
            <div>
              {filteredLogs.map((log, i) => (
                <LogLine key={`${i}-${log.slice(0, 12)}`} log={log} idx={i} />
              ))}
              {isRunning && (
                <div className="log-line text-slate-600 cursor-blink mt-1">›</div>
              )}
            </div>
          )}
          <div ref={logEndRef} />
        </div>
        </>
      )}
    </div>
  );
}
