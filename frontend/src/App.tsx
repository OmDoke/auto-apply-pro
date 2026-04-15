import React, { useState } from 'react';
import { useAgentSystem } from './hooks/useAgentSystem';
import AgentDashboard from './components/AgentDashboard';
import ManualReviewPage from './components/ManualReviewPage';

import HiringPostsPage from './components/HiringPostsPage';

function App() {
  const [view, setView] = useState<'dashboard' | 'manualReview' | 'hiringPosts'>('dashboard');
  const sys = useAgentSystem();

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
    />
  );
}

export default App;
