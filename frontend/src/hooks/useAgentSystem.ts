import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SystemState, Preferences, SOCKET_URL } from '../types';
import { apiService } from '../services/api';

const PREFS_STORAGE_KEY = 'agentPrefs';

const DEFAULT_PREFS: Preferences = {
  jobTitle:         'Software Engineer',
  location:         'Pune',
  skills:           'React, TypeScript, Node.js',
  excludeCompanies: 'HT Media',
  excludeKeywords:  'Senior, Lead, 10+ years, US Citizen only',
  minMatchScore:    60,
  jobType:          'any',
  workMode:         'any',
};

export function useAgentSystem(addToast: (type: 'success'|'error'|'info', msg: string) => void) {
  const [state, setState] = useState<SystemState>({
    status: 'Idle',
    currentAgent: null,
    logs: []
  });

  // Saved in localStorage so edits survive page reloads and `npm run dev` restarts
  const [prefs, setPrefs] = useState<Preferences>(() => {
    try {
      const saved = localStorage.getItem(PREFS_STORAGE_KEY);
      if (saved) return { ...DEFAULT_PREFS, ...JSON.parse(saved) };
    } catch { /* storage unavailable or corrupt — use defaults */ }
    return DEFAULT_PREFS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable — prefs just won't persist */ }
  }, [prefs]);
  const [failedCount, setFailedCount] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);

  const fetchFailedCount = useCallback(async () => {
    const jobs = await apiService.getFailedJobs();
    setFailedCount(jobs.length);
  }, []);

  useEffect(() => {
    fetchFailedCount();
    
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('statusUpdate', (newStatus: SystemState) => {
      setState(newStatus);
      if (newStatus.status === 'Success' || newStatus.status === 'Failed') {
        fetchFailedCount();
      }
    });

    newSocket.on('log', (logMessage: string) => {
      setState(prev => ({
        ...prev,
        logs: [...prev.logs, logMessage]
      }));

      // Trigger toasts for important events
      if (logMessage.includes('✅ Application submitted') || logMessage.includes('✓ Applied!')) {
        addToast('success', logMessage);
      } else if (logMessage.includes('[ERROR]') || logMessage.includes('Fatal') || logMessage.includes('✗')) {
        addToast('error', logMessage);
      } else if (logMessage.includes('Starting Single Agent') || logMessage.includes('Starting Universal Job Agent')) {
        addToast('info', logMessage);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [fetchFailedCount]);

  const handleStartAll = useCallback(() => {
    if (state.status === 'Running') return;
    socket?.emit('start', prefs);
  }, [state.status, socket, prefs]);

  const handleStartAgent = useCallback((agentId: string) => {
    if (state.status === 'Running') return;
    socket?.emit('start', { ...prefs, agentId });
  }, [state.status, socket, prefs]);

  const handleStop = useCallback(() => {
    socket?.emit('stop');
  }, [socket]);

  return {
    state,
    prefs,
    setPrefs,
    failedCount,
    handleStartAll,
    handleStartAgent,
    handleStop,
    refreshFailedCount: fetchFailedCount
  };
}
