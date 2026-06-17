import React, { useState } from 'react';
import { useAgentSystem } from './hooks/useAgentSystem';
import AgentDashboard from './components/AgentDashboard';
import ManualReviewPage from './components/ManualReviewPage';

import HiringPostsPage from './components/HiringPostsPage';
import { SettingsModal } from './components/SettingsModal';
import { ToastContainer, ToastMessage } from './components/Toast';

function App() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [view, setView] = useState<'dashboard' | 'manualReview' | 'hiringPosts'>('dashboard');
  const [showSettings, setShowSettings] = useState(false);

  const addToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const sys = useAgentSystem(addToast);

  if (view === 'manualReview') {
    return (
      <ManualReviewPage 
        onBack={() => { 
          setView('dashboard'); 
          sys.refreshFailedCount(); 
        }} 
      />
    );
  }

  if (view === 'hiringPosts') {
    return (
      <HiringPostsPage onBack={() => setView('dashboard')} />
    );
  }

  return (
    <>
      <AgentDashboard 
        state={sys.state}
        prefs={sys.prefs}
        setPrefs={sys.setPrefs}
        failedCount={sys.failedCount}
        handleStartAll={sys.handleStartAll}
        handleStartAgent={sys.handleStartAgent}
        handleStop={sys.handleStop}
        onShowManualReview={() => setView('manualReview')}
        onShowHiringPosts={() => setView('hiringPosts')}
        onShowSettings={() => setShowSettings(true)}
      />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </>
  );
}

export default App;
