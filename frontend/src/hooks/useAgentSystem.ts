import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SystemState, Preferences, SOCKET_URL } from '../types';
import { apiService } from '../services/api';

export function useAgentSystem() {
  const [state, setState] = useState<SystemState>({
    status: 'Idle',
    currentAgent: null,
    logs: []
  });

  const [prefs, setPrefs] = useState<Preferences>({ jobTitle: 'Software Engineer', location: 'Pune' });
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
