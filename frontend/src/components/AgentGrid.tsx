import React from 'react';
import { Play, Chrome, Wifi, WifiOff, CheckCircle2, AlertCircle, Circle, Bot } from 'lucide-react';
import { agents, SystemState } from '../types';

interface AgentStatusIconProps {
  agentId: string;
  state: SystemState;
}

function AgentStatusIcon({ agentId, state }: AgentStatusIconProps) {
  const agentIndex = agents.findIndex(a => a.id === agentId);
  const currentIndex = agents.findIndex(a => a.id === state.currentAgent);
  
  if (state.status === 'Success') return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
  
  if (agentId === state.currentAgent) {
    if (state.status === 'Running') return (
      <div className="w-5 h-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
    );
    if (state.status === 'Failed') return <AlertCircle className="w-5 h-5 text-rose-400" />;
  }
  
  if ((state.status === 'Running' || state.status === 'Failed') && currentIndex > agentIndex)
    return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
    
  return <Circle className="w-5 h-5 text-slate-700" />;
}

interface AgentGridProps {
  state: SystemState;
  isRunning: boolean;
  chromeReady: boolean;
  chromeLoading: boolean;
  handleStartAgent: (id: string) => void;
  handleOpenChrome: () => void;
}

export function AgentGrid({ 
  state, 
  isRunning, 
  chromeReady, 
  chromeLoading, 
  handleStartAgent, 
  handleOpenChrome 
}: AgentGridProps) {
  return (
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
  );
}
