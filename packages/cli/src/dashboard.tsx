/**
 * Ink-based Trading Dashboard
 * Uses React for terminal rendering with efficient updates
 * Orchestrates Gateway and Trader processes
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { spawn, ChildProcess } from 'child_process';
import { GatewayClient } from '@deriv-bot/trader';
import type { Tick } from '@deriv-bot/shared';

type ProcessStatus = 'stopped' | 'starting' | 'running' | 'error';

interface DashboardProps {
  gatewayUrl: string;
  asset: string;
}

const Dashboard: React.FC<DashboardProps> = ({ gatewayUrl, asset }) => {
  const { exit } = useApp();

  // No process management - Gateway and Trader run independently

  // Connection state
  const [connected, setConnected] = useState(false);
  const [balance, setBalance] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [lastPrice, setLastPrice] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [sessionStart] = useState(new Date());
  const [tickPulse, setTickPulse] = useState(false); // Visual pulse when tick arrives

  // Stats
  const [stats, setStats] = useState({
    trades: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    stake: 0,
    payout: 0,
    pnl: 0,
  });

  // Mock indicators (replace with real data later)
  const [rsi, setRsi] = useState(50);
  const [bbUpper, setBbUpper] = useState(0);
  const [bbMiddle, setBbMiddle] = useState(0);
  const [bbLower, setBbLower] = useState(0);
  const [atr, setAtr] = useState(12);

  const [client] = useState(() => new GatewayClient({
    url: gatewayUrl,
    autoReconnect: true,
    enableLogging: true,
  }));

  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Handle keyboard input
  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
    }
  });

  // Connect to Gateway on mount
  useEffect(() => {
    let mounted = true;
    let statsInterval: NodeJS.Timeout | null = null;
    let tickHandler: ((tick: Tick) => void) | null = null;
    let indicatorsHandler: ((indicators: any) => void) | null = null;

    const connect = async () => {
      try {
        await client.connect();
        if (!mounted) return;

        setConnected(true);
        setConnectionError(null);

        // Get balance from Deriv API
        try {
          const balanceInfo = await client.getBalance();
          if (mounted && balanceInfo) {
            setBalance(balanceInfo.amount);
            setCurrency(balanceInfo.currency);
          }
        } catch (error) {
          // Continue without balance
        }

        // Get stats (includes balance info)
        try {
          const result = await client.getStats();
          const statsData = result.stats || result;
          if (mounted) {
            setStats({
              trades: statsData.totalTrades || 0,
              wins: statsData.wins || 0,
              losses: statsData.losses || 0,
              pending: statsData.pending || 0,
              stake: statsData.totalStake || 0,
              payout: statsData.totalPayout || 0,
              pnl: statsData.netPnL || 0,
            });

            // Use endBalance from stats if available, otherwise use startBalance
            if (statsData.endBalance) {
              setBalance(statsData.endBalance);
            } else if (statsData.startBalance) {
              setBalance(statsData.startBalance + (statsData.netPnL || 0));
            }
          }
        } catch (error) {
          // Continue without stats
        }

        // Listen to ticks
        tickHandler = (tick: Tick) => {
          if (tick.asset === asset) {
            setLastPrice(tick.price);
            setLastUpdate(new Date());

            // Visual pulse
            setTickPulse(true);
            setTimeout(() => setTickPulse(false), 300);
          }
        };

        // Listen to indicators (real values from strategy)
        indicatorsHandler = (indicators: any) => {
          console.log('[Dashboard] Indicators received:', indicators);
          if (indicators.asset === asset) {
            console.log('[Dashboard] Updating indicators for', asset);
            setRsi(indicators.rsi);
            setBbUpper(indicators.bbUpper);
            setBbMiddle(indicators.bbMiddle);
            setBbLower(indicators.bbLower);
            setAtr(indicators.atr);
          } else {
            console.log('[Dashboard] Ignoring indicators for', indicators.asset, '(waiting for', asset, ')');
          }
        };

        client.on('tick', tickHandler);
        client.on('indicators', indicatorsHandler);

        // Subscribe to ticks
        await client.follow([asset]);

        // Update stats every 10 seconds
        statsInterval = setInterval(async () => {
          if (!mounted) return;
          try {
            const result = await client.getStats();
            const statsData = result.stats || result;
            const newStats = {
              trades: statsData.totalTrades || 0,
              wins: statsData.wins || 0,
              losses: statsData.losses || 0,
              pending: statsData.pending || 0,
              stake: statsData.totalStake || 0,
              payout: statsData.totalPayout || 0,
              pnl: statsData.netPnL || 0,
            };
            setStats(newStats);

            // Update balance from stats
            if (statsData.endBalance) {
              setBalance(statsData.endBalance);
            } else if (statsData.startBalance) {
              setBalance(statsData.startBalance + (statsData.netPnL || 0));
            }
          } catch (error) {
            // Silent fail
          }
        }, 10000);
      } catch (error: any) {
        setConnectionError(error.message || 'Failed to connect to Gateway');
        setConnected(false);
      }
    };

    connect();

    return () => {
      mounted = false;
      if (statsInterval) {
        clearInterval(statsInterval);
      }
      if (tickHandler) {
        client.off('tick', tickHandler);
      }
      if (indicatorsHandler) {
        client.off('indicators', indicatorsHandler);
      }
      client.disconnect();
    };
  }, [client, asset]);

  // Calculate uptime
  const uptime = Date.now() - sessionStart.getTime();
  const hours = Math.floor(uptime / 3600000);
  const minutes = Math.floor((uptime % 3600000) / 60000);
  const seconds = Math.floor((uptime % 60000) / 1000);

  // Calculate P&L
  const pnl = stats.pnl;
  const pnlPercent = stats.stake > 0 ? (pnl / stats.stake) * 100 : 0;

  // Calculate win rate
  const winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;

  // Signal proximity - calculate how close we are to signal thresholds
  // CALL signal triggers at RSI < 17 (starts showing proximity from RSI < 40)
  const callProximity = rsi <= 17
    ? 100 // Already in signal zone
    : rsi <= 40
      ? Math.max(0, ((40 - rsi) / (40 - 17)) * 100) // Approaching signal (40 to 17)
      : 0; // Too far

  // PUT signal triggers at RSI > 83 (starts showing proximity from RSI > 60)
  const putProximity = rsi >= 83
    ? 100 // Already in signal zone
    : rsi >= 60
      ? Math.max(0, ((rsi - 60) / (83 - 60)) * 100) // Approaching signal (60 to 83)
      : 0; // Too far


  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" padding={1} flexDirection="column">
        <Text bold color="cyan">🤖 DERIV BOT - MEAN REVERSION v2 - Dashboard</Text>
      </Box>

      {/* Connection Status */}
      {!connected && (
        <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={2} paddingY={1} flexDirection="column">
          <Text bold color="yellow">⚠️  NOT CONNECTED TO GATEWAY</Text>
          <Text dimColor>─────────────────────────────────────────</Text>
          {connectionError ? (
            <>
              <Text color="red">Error: {connectionError}</Text>
              <Text dimColor>Make sure Gateway is running:</Text>
              <Text color="cyan">  pnpm --filter @deriv-bot/gateway dev</Text>
            </>
          ) : (
            <Text color="yellow">Attempting to connect to {gatewayUrl}...</Text>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press </Text>
            <Text color="cyan" bold>q</Text>
            <Text dimColor> to quit</Text>
          </Box>
        </Box>
      )}

      {connected && (
        <>
      {/* Market & Account */}
      <Box marginTop={1}>
        <Box borderStyle="single" width="50%" paddingX={1} flexDirection="column">
          <Text bold color="cyan">📊 MARKET STATUS {tickPulse && <Text color="green">●</Text>}</Text>
          <Text dimColor>─────────────────────</Text>
          <Text>Asset:        <Text color="cyan">{asset}</Text></Text>
          <Text>
            Last Price:
            <Text color={tickPulse ? 'green' : 'magenta'} bold={tickPulse}>
              {lastPrice.toFixed(2)}
            </Text>
          </Text>
          <Text>
            Last Update:
            <Text dimColor>
              {lastUpdate.toLocaleTimeString('es-AR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </Text>
          </Text>
        </Box>

        <Box borderStyle="single" width="50%" paddingX={1} flexDirection="column">
          <Text bold color="cyan">💰 ACCOUNT</Text>
          <Text dimColor>─────────────────────</Text>
          {balance > 0 ? (
            <>
              <Text>Balance:      <Text color="magenta">${balance.toFixed(2)}</Text></Text>
              <Text>
                Today P&L:
                <Text color={pnl >= 0 ? 'green' : 'red'}>
                  {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                </Text>
              </Text>
            </>
          ) : (
            <>
              <Text dimColor>Balance:      <Text dimColor>(waiting for data)</Text></Text>
              <Text>
                Today P&L:
                <Text color={pnl >= 0 ? 'green' : 'red'}>
                  {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                </Text>
              </Text>
            </>
          )}
          <Text>Uptime:       <Text dimColor>{hours}h {minutes}m {seconds}s</Text></Text>
        </Box>
      </Box>

      {/* Indicators & Signal Proximity */}
      <Box marginTop={1}>
        <Box borderStyle="single" width="50%" paddingX={1} flexDirection="column">
          <Text bold color="cyan">🎯 INDICATORS</Text>
          <Text dimColor>─────────────────────</Text>
          <Text>
            RSI:
            <Text color={rsi <= 30 ? 'green' : rsi >= 70 ? 'red' : 'magenta'}>
              {rsi.toFixed(1)}
            </Text>
          </Text>
          <Text dimColor>  Oversold: &lt; 17</Text>
          <Text dimColor>  Overbought: &gt; 83</Text>
          <Text marginTop={1}>Bollinger Bands:</Text>
          <Text>  Upper:  <Text color="magenta">{bbUpper.toFixed(2)}</Text></Text>
          <Text>  Middle: <Text color="magenta">{bbMiddle.toFixed(2)}</Text></Text>
          <Text>  Lower:  <Text color="magenta">{bbLower.toFixed(2)}</Text></Text>
          <Text marginTop={1}>
            {(() => {
              const price = lastPrice;

              // Wait for real data
              if (price === 0 || bbUpper === 0) {
                return <Text dimColor>Price: Waiting for tick data...</Text>;
              }

              const distToUpper = ((bbUpper - price) / bbUpper) * 100;
              const distToLower = ((price - bbLower) / bbLower) * 100;

              let position = '';
              let positionColor = 'white';

              if (price > bbUpper) {
                position = `ABOVE upper (${distToUpper.toFixed(1)}%)`;
                positionColor = 'red';
              } else if (price < bbLower) {
                position = `BELOW lower (${distToLower.toFixed(1)}%)`;
                positionColor = 'green';
              } else if (Math.abs(price - bbMiddle) < (bbUpper - bbMiddle) * 0.2) {
                position = 'near MIDDLE';
                positionColor = 'cyan';
              } else if (price > bbMiddle) {
                position = `moving to upper (${((price - bbMiddle) / (bbUpper - bbMiddle) * 100).toFixed(0)}%)`;
                positionColor = 'yellow';
              } else {
                position = `moving to lower (${((bbMiddle - price) / (bbMiddle - bbLower) * 100).toFixed(0)}%)`;
                positionColor = 'yellow';
              }

              return (
                <Text>
                  Price: <Text color={positionColor}>{position}</Text>
                </Text>
              );
            })()}
          </Text>
          <Text marginTop={1}>
            ATR:
            <Text color="magenta">{atr.toFixed(1)}</Text>
            <Text color={atr >= 10 ? 'green' : 'yellow'}> ({atr >= 10 ? 'volatility OK' : 'low volatility'})</Text>
          </Text>
        </Box>

        <Box borderStyle="single" width="50%" paddingX={1} flexDirection="column">
          <Text bold color="cyan">🔔 SIGNAL PROXIMITY</Text>
          <Text dimColor>─────────────────────</Text>
          <Text>
            CALL Signal:
            <Text color="magenta">{callProximity.toFixed(0)}%</Text>
          </Text>
          <Text dimColor>  Triggers: RSI &lt; 17</Text>
          <Text dimColor>            BB lower breach</Text>
          <Text dimColor>            ATR confirmation</Text>
          <Text marginTop={1}>
            PUT Signal:
            <Text color="magenta">{putProximity.toFixed(0)}%</Text>
          </Text>
          <Text dimColor>  Triggers: RSI &gt; 83</Text>
          <Text dimColor>            BB upper breach</Text>
          <Text dimColor>            ATR confirmation</Text>
          <Text marginTop={1}>
            🚦 Status:
            <Text color="yellow">🟡 MONITORING</Text>
          </Text>
        </Box>
      </Box>

      {/* Today's Statistics */}
      <Box marginTop={1} borderStyle="single" paddingX={1} flexDirection="column">
        <Text bold color="cyan">📊 TODAY'S STATISTICS</Text>
        <Text dimColor>───────────────────────────────────────────────</Text>
        <Text>
          Trades: <Text color="magenta">{stats.trades}</Text>  │
          Wins: <Text color="green">{stats.wins}</Text> (<Text dimColor>{winRate.toFixed(2)}%</Text>)  │
          Losses: <Text color="red">{stats.losses}</Text>  │
          Pending: <Text color="yellow">{stats.pending}</Text>
        </Text>
        <Text>
          Stake: <Text color="magenta">${stats.stake.toFixed(2)}</Text>  │
          Payout: <Text color="magenta">${stats.payout.toFixed(2)}</Text>  │
          Net P&L: <Text color={pnl >= 0 ? 'green' : 'red'}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
          </Text>
        </Text>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Press </Text>
        <Text color="cyan" bold>q</Text>
        <Text dimColor> to quit</Text>
      </Box>
      </>
      )}
    </Box>
  );
};

// Main function
async function main() {
  const gatewayUrl = process.env.GATEWAY_URL || 'ws://localhost:3000';
  const asset = process.env.ASSET || 'R_75';

  render(<Dashboard gatewayUrl={gatewayUrl} asset={asset} />);
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
