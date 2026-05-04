import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, ExternalLink, Download, Mail, Phone, Search, Users,
  RefreshCcw, Filter, Briefcase, Calendar, User, Globe, ChevronRight,
} from 'lucide-react';
import { HiringPost } from '../types';
import { apiService } from '../services/api';

export default function HiringPostsPage({ onBack }: { onBack: () => void }) {
  const [posts, setPosts] = useState<HiringPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailsOnly, setEmailsOnly] = useState(false);
  const [withPhone, setWithPhone] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = () => {
    setLoading(true);
    apiService.getHiringPosts().then(data => {
      // Sort newest scraped first
      setPosts([...data].reverse());
      setLoading(false);
    });
  };

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        (post.authorName || '').toLowerCase().includes(q) ||
        (post.company || '').toLowerCase().includes(q) ||
        (post.jobTitle || '').toLowerCase().includes(q) ||
        (post.snippet || '').toLowerCase().includes(q) ||
        (post.fullText || '').toLowerCase().includes(q);

      const hasEmails = post.emails && post.emails.length > 0;
      const hasPhones = post.phones && post.phones.length > 0;

      if (emailsOnly && !hasEmails) return false;
      if (withPhone && !hasPhones) return false;
      return matchSearch;
    });
  }, [posts, searchQuery, emailsOnly, withPhone]);

  const stats = useMemo(() => {
    let emailCount = 0;
    let phoneCount = 0;
    filteredPosts.forEach(p => {
      if (p.emails && p.emails.length > 0) emailCount++;
      if (p.phones && p.phones.length > 0) phoneCount++;
    });
    return { total: filteredPosts.length, emails: emailCount, phones: phoneCount };
  }, [filteredPosts]);

  const downloadJson = () => {
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(filteredPosts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hiring_posts_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getInitials = (name?: string) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <div className="min-h-screen grid-bg">
      {/* Top Bar */}
      <div className="border-b border-white/[0.06] bg-black/20 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="btn-ghost px-3 py-2 text-sm">
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </button>
            <div className="w-px h-6 bg-white/10" />
            <div>
              <h1 className="text-lg font-bold text-grd-emerald leading-tight flex items-center gap-2">
                <Users className="w-5 h-5" />
                Hiring Posts
              </h1>
              <p className="text-slate-500 text-xs">Actively hiring recruiters & open roles</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchPosts}
              className="btn btn-ghost px-3 py-2 text-xs"
              disabled={loading}
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={downloadJson}
              disabled={filteredPosts.length === 0}
              className="btn btn-success px-4 py-2 text-xs"
            >
              <Download className="w-3.5 h-3.5" /> Export JSON
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
        
        {/* Filters & Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Filter Panel */}
          <div className="lg:col-span-3 card p-4 flex flex-col md:flex-row gap-4 items-center anim-fade-up">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input 
                type="text" 
                placeholder="Search by name, company, role, or keywords..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="input pl-10"
              />
            </div>
            
            <div className="flex items-center gap-4 shrink-0">
              <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-400 cursor-pointer hover:text-emerald-400 transition-colors">
                <div className="relative flex items-center">
                  <input 
                    type="checkbox" 
                    checked={emailsOnly} 
                    onChange={e => setEmailsOnly(e.target.checked)} 
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-white/5 border border-white/10 rounded-full peer peer-checked:bg-emerald-500/20 peer-checked:border-emerald-500/40 transition-all"></div>
                  <div className="absolute left-1 top-1 w-2 h-2 bg-slate-600 rounded-full peer-checked:left-5 peer-checked:bg-emerald-400 transition-all"></div>
                </div>
                Emails Only
              </label>
              
              <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-400 cursor-pointer hover:text-blue-400 transition-colors">
                <div className="relative flex items-center">
                  <input 
                    type="checkbox" 
                    checked={withPhone} 
                    onChange={e => setWithPhone(e.target.checked)} 
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-white/5 border border-white/10 rounded-full peer peer-checked:bg-blue-500/20 peer-checked:border-blue-500/40 transition-all"></div>
                  <div className="absolute left-1 top-1 w-2 h-2 bg-slate-600 rounded-full peer-checked:left-5 peer-checked:bg-blue-400 transition-all"></div>
                </div>
                With Phone
              </label>
            </div>
          </div>

          {/* Mini Stats Card */}
          <div className="card p-4 flex flex-col justify-center anim-fade-up delay-100">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              <Filter className="w-3 h-3" />
              <span>Results</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">{stats.total}</span>
              <span className="text-xs text-slate-500 font-medium">matches</span>
            </div>
            <div className="flex gap-2 mt-2">
              <div className="chip bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{stats.emails} @</div>
              <div className="chip bg-blue-500/10 text-blue-400 border-blue-500/20">{stats.phones} ✆</div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-6 h-48 skeleton" />
            ))}
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="card empty-state anim-fade-in">
             <div className="empty-icon w-20 h-20 rounded-3xl">
               <Search className="w-9 h-9 text-slate-600" />
             </div>
             <p className="text-slate-300 font-bold text-lg">No posts found</p>
             <p className="text-slate-600 text-sm max-w-sm">Try adjusting your filters or run the LinkedIn Post Scraper agent to find new leads.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredPosts.map((post, idx) => (
              <div 
                key={idx} 
                className="card p-6 hover:border-white/20 transition-all duration-300 anim-fade-up"
                style={{ animationDelay: `${Math.min(idx * 50, 500)}ms` }}
              >
                <div className="flex flex-col md:flex-row gap-6">
                  {/* Left Column: Avatar & Meta */}
                  <div className="flex md:flex-col items-center gap-3 shrink-0">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center text-slate-300 font-bold text-xl shadow-lg glow-indigo/5">
                      {getInitials(post.authorName)}
                    </div>
                    <div className="md:hidden flex-1">
                      <h3 className="font-bold text-slate-100">{post.authorName || 'Anonymous'}</h3>
                      <p className="text-[11px] text-slate-500">{post.authorTitle}</p>
                    </div>
                  </div>
                  
                  {/* Right Column: Content */}
                  <div className="flex-1 min-w-0 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="hidden md:block">
                        <div className="flex items-center gap-2">
                          <a href={post.authorProfileUrl || '#'} target="_blank" rel="noreferrer" className="text-lg font-bold text-slate-100 hover:text-emerald-400 transition-colors">
                            {post.authorName || 'Anonymous'}
                          </a>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-500 font-bold uppercase tracking-tight">Recruiter</span>
                        </div>
                        <p className="text-sm text-slate-400 mt-0.5 max-w-md line-clamp-1">{post.authorTitle}</p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-600 font-medium">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {post.postedAt}</span>
                          {post.company && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {post.company}</span>}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <a href={post.link} target="_blank" rel="noreferrer" className="btn btn-ghost py-1.5 px-3 text-xs opacity-70 hover:opacity-100 group">
                          <Globe className="w-3.5 h-3.5 group-hover:text-blue-400 transition-colors" /> View Original
                          <ChevronRight className="w-3 h-3 ml-0.5 opacity-40 group-hover:translate-x-0.5 transition-transform" />
                        </a>
                      </div>
                    </div>
                    
                    {/* Badge Row */}
                    {(post.jobTitle || post.company) && (
                      <div className="flex flex-wrap gap-2">
                        {post.jobTitle && (
                          <div className="badge badge-running text-[10px] py-0.5">
                            <User className="w-3 h-3" /> {post.jobTitle}
                          </div>
                        )}
                        {post.company && (
                          <div className="badge badge-idle text-[10px] py-0.5">
                            <Briefcase className="w-3 h-3" /> {post.company}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Content Snippet */}
                    <div className="relative group/text">
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-sm text-slate-300 leading-relaxed group-hover/text:border-white/10 transition-colors">
                        <p className="whitespace-pre-wrap line-clamp-4 group-hover/text:line-clamp-none transition-all duration-300">
                          {post.fullText || post.snippet}
                        </p>
                      </div>
                    </div>

                    {/* Contacts & Footer */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                      <div className="flex flex-wrap gap-2">
                        {post.emails?.map(e => (
                          <a key={e} href={`mailto:${e}`} className="btn-link text-emerald-400/80 hover:text-emerald-300 bg-emerald-500/5 px-2.5 py-1.5 rounded-lg border border-emerald-500/10 hover:border-emerald-500/20 transition-all text-xs">
                            <Mail className="w-3.5 h-3.5" /> {e}
                          </a>
                        ))}
                        {post.phones?.map(p => (
                          <a key={p} href={`tel:${p}`} className="btn-link text-blue-400/80 hover:text-blue-300 bg-blue-500/5 px-2.5 py-1.5 rounded-lg border border-blue-500/10 hover:border-blue-500/20 transition-all text-xs">
                            <Phone className="w-3.5 h-3.5" /> {p}
                          </a>
                        ))}
                        {(!post.emails?.length && !post.phones?.length) && (
                          <span className="text-[11px] text-slate-600 italic">No direct contact info extracted</span>
                        )}
                      </div>
                      
                      <div className="text-[10px] text-slate-700 font-bold uppercase tracking-widest bg-white/[0.02] px-2 py-1 rounded">
                        Scraped {post.scrapedAt || 'recently'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
