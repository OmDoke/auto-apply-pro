import React, { useState } from 'react';
import { useAgentSystem } from './hooks/useAgentSystem';
import AgentDashboard from './components/AgentDashboard';
import ManualReviewPage from './components/ManualReviewPage';

function App() {
  const [showManualReview, setShowManualReview] = useState(false);
  const sys = useAgentSystem();

  if (showManualReview) {
    return (
      <ManualReviewPage 
        onBack={() => { 
          setShowManualReview(false); 
          sys.refreshFailedCount(); 
        }} 
      />
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
      onShowManualReview={() => setShowManualReview(true)}
    />
  );
}

export default App;
