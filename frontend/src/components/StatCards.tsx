import React from 'react';
import { Activity, CheckCircle2, AlertTriangle, BarChart2 } from 'lucide-react';

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
      <p className="text-3xl font-bold text-slate-100 tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>}
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
  isRunning: boolean;
}

export function StatCards({ 
  activeCount, 
  runningAgentName, 
  completedCount, 
  totalActive, 
  failedCount, 
  logCount, 
  isRunning 
}: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard 
        icon={Activity}       
        label="Active Agents"  
        value={activeCount}     
        sub={isRunning ? runningAgentName : 'None running'} 
        color="bg-indigo-500/15 text-indigo-400"  
        delay={0}   
      />
      <StatCard 
        icon={CheckCircle2}   
        label="Completed"      
        value={completedCount}  
        sub={`of ${totalActive} agents`}                            
        color="bg-emerald-500/15 text-emerald-400" 
        delay={60}  
      />
      <StatCard 
        icon={AlertTriangle}  
        label="Review Queue"   
        value={failedCount}     
        sub={failedCount > 0 ? 'Needs manual apply' : 'All clear'}  
        color={failedCount > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-800 text-slate-600'} 
        delay={120} 
      />
      <StatCard 
        icon={BarChart2}      
        label="Log Events"     
        value={logCount} 
        sub="This session"                                        
        color="bg-violet-500/15 text-violet-400"   
        delay={180} 
      />
    </div>
  );
}
