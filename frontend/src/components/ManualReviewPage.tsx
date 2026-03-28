import React, { useState, useEffect } from 'react';
import { CheckCircle2, ExternalLink, ArrowLeft, Trash2, Link } from 'lucide-react';
import { FailedJob } from '../types';
import { apiService } from '../services/api';

export default function ManualReviewPage({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [view, setView] = useState<'list' | 'browse'>('list');

  useEffect(() => {
    apiService.getFailedJobs().then(data => {
      setJobs(data);
      setLoading(false);
    });
  }, []);

  const handleClear = async () => {
    if (!confirm('Clear the entire failed jobs list? This cannot be undone.')) return;
    await apiService.clearFailedJobs();
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
