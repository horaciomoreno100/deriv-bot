import React, { useState } from 'react';
import { TradingDashboard } from './components/TradingDashboard';
import './App.css';

const App: React.FC = () => {
  const [gatewayUrl] = useState('ws://localhost:3000');
  const [asset] = useState('R_100');

  return (
    <div className="app">
      <TradingDashboard gatewayUrl={gatewayUrl} asset={asset} />
    </div>
  );
};

export default App;
