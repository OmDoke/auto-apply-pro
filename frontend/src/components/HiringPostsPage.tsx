import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, ExternalLink, Download, Mail, Phone, Search, Users, RefreshCcw } from 'lucide-react';
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
      // Sort newest scraped first (assuming array order or using scrapedAt if reliable)
      setPosts(data.reverse());
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
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Options */}
        <div className="flex items-center justify-between glass-panel p-6 rounded-2xl">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 text-sm text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </button>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent flex items-center gap-2">
                <Users className="w-6 h-6 text-emerald-400" />
                Hiring Posts
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">Actively hiring recruiters & open roles</p>
            </div>
          </div>
          
          <button
            onClick={fetchPosts}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 text-sm text-slate-300"
          >
            <RefreshCcw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="glass-panel p-4 rounded-xl flex flex-wrap gap-4 items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3 w-full md:w-auto flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search by name, company, role, or text..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none text-slate-200"
              />
            </div>
            
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-emerald-300">
              <input type="checkbox" checked={emailsOnly} onChange={e => setEmailsOnly(e.target.checked)} className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900" />
              Emails only
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-blue-300">
              <input type="checkbox" checked={withPhone} onChange={e => setWithPhone(e.target.checked)} className="rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900" />
              With Phone
            </label>
          </div>
          
          <button
            onClick={downloadJson}
            disabled={filteredPosts.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:shadow-none"
          >
            <Download className="w-4 h-4" /> Download JSON
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-3 text-sm font-medium">
          <div className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700 text-slate-300">Total: {stats.total} posts</div>
          <div className="px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20 text-emerald-400">With Email: {stats.emails}</div>
          <div className="px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20 text-blue-400">With Phone: {stats.phones}</div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="glass-panel p-12 rounded-2xl text-center text-slate-500">Loading posts...</div>
        ) : filteredPosts.length === 0 ? (
          <div className="glass-panel p-12 rounded-2xl text-center space-y-3">
             <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-600">
               <Search className="w-8 h-8" />
             </div>
             <p className="text-slate-300 font-medium">No posts found</p>
             <p className="text-slate-500 text-sm">Run the LinkedIn Post Scraper or adjust your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredPosts.map((post, idx) => (
              <div key={idx} className="glass-panel p-5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors flex flex-col md:flex-row gap-5">
                
                {/* Avatar */}
                <div className="hidden md:flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 flex items-center justify-center text-slate-300 font-bold text-lg shadow-inner">
                    {getInitials(post.authorName)}
                  </div>
                </div>
                
                {/* Main Content */}
                <div className="flex-1 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <a href={post.authorProfileUrl || '#'} target="_blank" rel="noreferrer" className="font-bold text-slate-200 hover:text-emerald-400 hover:underline">
                          {post.authorName || 'Unknown Author'}
                        </a>
                        <span className="text-xs text-slate-500">• {post.postedAt}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{post.authorTitle}</p>
                    </div>
                    
                    <a href={post.link} target="_blank" rel="noreferrer" className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" /> View Post
                    </a>
                  </div>
                  
                  {/* Entity Badges */}
                  {(post.jobTitle || post.company) && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {post.jobTitle && <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20 font-medium">Role: {post.jobTitle}</span>}
                      {post.company && <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded border border-amber-500/20 font-medium">Company: {post.company}</span>}
                    </div>
                  )}

                  {/* Text Snippet */}
                  <div className="bg-[#0a0a0a] rounded-lg p-3 text-sm text-slate-300 border border-slate-800">
                    <p className="line-clamp-3 whitespace-pre-wrap">{post.fullText || post.snippet}</p>
                  </div>

                  {/* Contacts */}
                  {(post.emails?.length || post.phones?.length) ? (
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800">
                      {post.emails?.map(e => (
                        <a key={e} href={`mailto:${e}`} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md hover:bg-emerald-500/20 transition-colors">
                          <Mail className="w-3.5 h-3.5" /> {e}
                        </a>
                      ))}
                      {post.phones?.map(p => (
                        <a key={p} href={`tel:${p}`} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md hover:bg-blue-500/20 transition-colors">
                          <Phone className="w-3.5 h-3.5" /> {p}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
