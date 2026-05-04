import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, ExternalLink, ArrowLeft, Trash2,
  ChevronLeft, ChevronRight, AlertCircle, Briefcase, Globe,
} from 'lucide-react';
import { FailedJob } from '../types';
import { apiService } from '../services/api';

function getHostname(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export default function ManualReviewPage({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [view, setView] = useState<'list' | 'browse'>('list');

  useEffect(() => {
    apiService.getFailedJobs().then(data => { setJobs(data); setLoading(false); });
  }, []);

  const handleClear = async () => {
    if (!confirm('Clear the entire failed jobs list? This cannot be undone.')) return;
    await apiService.clearFailedJobs();
    setJobs([]);
  };

  const job = jobs[currentIdx];

  return (
    <div className="min-h-screen grid-bg">
      {/* Top bar */}
      <div className="border-b border-white/[0.06] bg-black/20 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="btn-ghost px-3 py-2 text-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="w-px h-6 bg-white/10" />
            <div>
              <h1 className="text-lg font-bold text-grd-amber leading-tight">Manual Review Queue</h1>
              <p className="text-slate-500 text-xs">Jobs the agent couldn't auto-apply to</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {jobs.length > 0 && (
              <>
                <span className="badge badge-soon">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={() => { setCurrentIdx(0); setView('browse'); }}
                  className={`btn ${view === 'browse' ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <ChevronRight className="w-4 h-4" />
                  Browse Mode
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`btn ${view === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <Briefcase className="w-4 h-4" />
                  List View
                </button>
                <button
                  onClick={handleClear}
                  className="btn btn-ghost text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/30 px-3"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">

        {/* ── Browse Mode ────────────────────────────── */}
        {view === 'browse' && jobs.length > 0 && job && (
          <div className="anim-fade-in">
            {/* Progress */}
            <div className="flex items-center justify-between mb-4 text-sm text-slate-500">
              <span className="font-medium">Job <span className="text-slate-300">{currentIdx + 1}</span> of <span className="text-slate-300">{jobs.length}</span></span>
              <div className="progress-track w-48">
                <div className="progress-fill" style={{ width: `${((currentIdx + 1) / jobs.length) * 100}%` }} />
              </div>
            </div>

            {/* Main card */}
            <div className="card p-8 space-y-6">
              {/* Company + Title */}
              <div className="flex items-start gap-5">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Briefcase className="w-6 h-6 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold text-slate-100 leading-tight">{job.title}</h2>
                  <p className="text-base text-slate-400 mt-1 font-medium">
                    {job.company || <span className="text-slate-600 italic text-sm">Company not listed</span>}
                  </p>
                  {job.url && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-600">
                      <Globe className="w-3 h-3" />
                      <span>{getHostname(job.url)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* CTA */}
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary w-full justify-center py-4 rounded-xl text-base"
              >
                <ExternalLink className="w-5 h-5" />
                Open Job & Apply Manually
              </a>

              {/* Navigation */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                  disabled={currentIdx === 0}
                  className="btn btn-ghost py-3 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <button
                  onClick={() => setCurrentIdx(Math.min(jobs.length - 1, currentIdx + 1))}
                  disabled={currentIdx === jobs.length - 1}
                  className="btn btn-ghost py-3 disabled:opacity-30"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── List Mode ──────────────────────────────── */}
        {view === 'list' && (
          <div className="card overflow-hidden anim-fade-up">
            {loading ? (
              <div className="p-8 space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl border border-white/[0.05]">
                    <div className="skeleton w-10 h-10 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-48 rounded" />
                      <div className="skeleton h-3 w-32 rounded" />
                    </div>
                    <div className="skeleton h-8 w-20 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon w-20 h-20 rounded-3xl">
                  <CheckCircle2 className="w-9 h-9 text-emerald-400" />
                </div>
                <p className="text-slate-300 font-bold text-lg">All clear!</p>
                <p className="text-slate-600 text-sm max-w-sm">No failed jobs in the queue. The agent handled everything automatically.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {jobs.map((j, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.025] transition-colors group anim-fade-up"
                    style={{ animationDelay: `${idx * 40}ms` }}
                  >
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-4.5 h-4.5 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-200 truncate text-sm">{j.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {j.company || (
                          <span className="italic text-slate-600">
                            {j.url ? getHostname(j.url) : 'Unknown source'}
                          </span>
                        )}
                      </p>
                    </div>
                    <a
                      href={j.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost shrink-0 py-2 px-4 text-xs opacity-70 group-hover:opacity-100"
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
