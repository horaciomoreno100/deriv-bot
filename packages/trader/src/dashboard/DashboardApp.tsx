import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { Balance } from '@deriv-bot/shared';

import { Header } from './components/Header.js';
import { AccountStatus } from './components/AccountStatus.js';
import { OpenPositions, type Position } from './components/OpenPositions.js';
import { Strategies, type StrategyInfo } from './components/Strategies.js';
import { SignalProximityPanel, type SignalProximity } from './components/SignalProximity.js';
import { MonitoredAssets, type Asset } from './components/MonitoredAssets.js';
import { Commands } from './components/Commands.js';

interface DashboardData {
  balance: Balance | null;
  positions: Position[];
  strategies: StrategyInfo[];
  signalProximity: SignalProximity[];
  assets: Asset[];
  lastUpdate: Date;
}

interface DashboardAppProps {
  fetchData: () => Promise<DashboardData>;
  updateInterval?: number;
  compact?: boolean;
}

export const DashboardApp: React.FC<DashboardAppProps> = ({
  fetchData,
  updateInterval = 3000,
  compact: initialCompact = false,
}) => {
  const { exit } = useApp();
  const [data, setData] = useState<DashboardData>({
    balance: null,
    positions: [],
    strategies: [],
    signalProximity: [],
    assets: [],
    lastUpdate: new Date(),
  });
  const [compact, setCompact] = useState(initialCompact);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data function
  const refreshData = async () => {
    try {
      setError(null);
      const newData = await fetchData();
      setData(newData);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    refreshData();
  }, []);

  // Auto-refresh
  useEffect(() => {
    const timer = setInterval(() => {
      refreshData();
    }, updateInterval);

    return () => clearInterval(timer);
  }, [updateInterval]);

  // Keyboard input handling
  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    } else if (input === 'r') {
      refreshData();
    } else if (input === 'c') {
      setCompact(!compact);
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Box marginTop={1}>
          <Text color="yellow">Loading dashboard...</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Press 'r' to retry or 'q' to quit</Text>
        </Box>
      </Box>
    );
  }

  if (compact) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Box marginTop={1}>
          <AccountStatus balance={data.balance} lastUpdate={data.lastUpdate} />
        </Box>
        <Box marginTop={1}>
          <OpenPositions positions={data.positions} />
        </Box>
        <Box marginTop={1}>
          <SignalProximityPanel proximity={data.signalProximity} />
        </Box>
        <Box marginTop={1}>
          <Commands />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {/* Row 1: Account Status + Open Positions */}
      <Box marginTop={1} gap={1}>
        <Box width="50%">
          <AccountStatus balance={data.balance} lastUpdate={data.lastUpdate} />
        </Box>
        <Box width="50%">
          <OpenPositions positions={data.positions} />
        </Box>
      </Box>

      {/* Row 2: Strategies + Signal Proximity */}
      <Box marginTop={1} gap={1}>
        <Box width="50%">
          <Strategies strategies={data.strategies} />
        </Box>
        <Box width="50%">
          <SignalProximityPanel proximity={data.signalProximity} />
        </Box>
      </Box>

      {/* Row 3: Monitored Assets + Commands */}
      <Box marginTop={1} gap={1}>
        <Box width="50%">
          <MonitoredAssets assets={data.assets} />
        </Box>
        <Box width="50%">
          <Commands />
        </Box>
      </Box>

      {/* Footer Note */}
      <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray" dimColor>
          💡 This dashboard monitors only - it does NOT execute trades. To execute trades, run the
          trader script separately.
        </Text>
      </Box>
    </Box>
  );
};
