import React from 'react';
import { Activity, CheckCircle2, AlertTriangle, Briefcase, Linkedin } from 'lucide-react';
import { LinkedInAppliedCounts } from '../types';

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  delay?: number;
}

export function StatCard({ icon: Icon, label, value, sub, color, delay = 0 }: StatCardProps) {
  return (
    <div className="stat-card anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-slate-300 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

interface StatCardsProps {
  activeCount: number;
  runningAgentName: string;
  completedCount: number;
  totalActive: number;
  failedCount: number;
  logCount: number;
  linkedInApplied: LinkedInAppliedCounts | null;
  isRunning: boolean;
}

export function StatCards({ 
  activeCount, 
  runningAgentName, 
  completedCount, 
  totalActive, 
  failedCount, 
  logCount,
  linkedInApplied,
  isRunning
}: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <StatCard
        icon={Linkedin}
        label="LinkedIn Applied"
        value={linkedInApplied ? linkedInApplied.total : '–'}
        sub={linkedInApplied ? `${linkedInApplied.today}/${linkedInApplied.dailyLimit} today · confirmed only` : 'Backend offline'}
        color="bg-white/5 text-slate-300"
        delay={0}
      />
      <StatCard 
        icon={Activity}       
        label="Active Agents"  
        value={activeCount}     
        sub={isRunning ? runningAgentName : 'None running'} 
        color={isRunning ? "bg-indigo-500/15 text-indigo-400" : "bg-white/5 text-slate-400"}  
        delay={0}   
      />
      <StatCard 
        icon={CheckCircle2}   
        label="Completed"      
        value={completedCount}  
        sub={`of ${totalActive} agents`}                            
        color="bg-white/5 text-slate-400" 
        delay={60}  
      />
      <StatCard 
        icon={AlertTriangle}  
        label="Review Queue"   
        value={failedCount}     
        sub={failedCount > 0 ? 'Needs manual apply' : 'All clear'}  
        color={failedCount > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-white/5 text-slate-400'} 
        delay={120} 
      />
      <StatCard 
        icon={Briefcase}      
        label="Applied Jobs"     
        value={logCount} 
        sub="This session"                                        
        color="bg-white/5 text-slate-400"   
        delay={180} 
      />
    </div>
  );
}
