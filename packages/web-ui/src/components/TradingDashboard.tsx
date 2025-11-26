/**
 * Trading Dashboard - Main component
 * Conecta al Gateway y muestra el chart + stats en tiempo real
 */

import React, { useState, useEffect } from 'react';
import type { Candle, Tick } from '@deriv-bot/shared';
import { useGatewayConnection } from '../hooks/useGatewayConnection';
import { CandlestickChart, ChartIndicators, TradeMarker } from './CandlestickChart';
import './TradingDashboard.css';

interface TradingDashboardProps {
  gatewayUrl: string;
  asset: string;
}

export const TradingDashboard: React.FC<TradingDashboardProps> = ({ gatewayUrl, asset }) => {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<ChartIndicators>({});
  const [trades, setTrades] = useState<TradeMarker[]>([]);
  const [lastPrice, setLastPrice] = useState<number>(0);
  const [balance, setBalance] = useState<number>(0);
  const [stats, setStats] = useState<any>(null);

  // Conectar al Gateway
  const gateway = useGatewayConnection({
    url: gatewayUrl,

    onTick: (tick: Tick) => {
      if (tick.asset === asset) {
        setLastPrice(tick.price);
      }
    },

    onCandleUpdate: (data) => {
      if (data.asset === asset) {
        setCandles((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;

          if (lastIdx >= 0 && updated[lastIdx].timestamp === data.candle.timestamp) {
            // Update last candle
            updated[lastIdx] = data.candle;
          } else {
            // Add new candle
            updated.push(data.candle);
          }

          // Keep last 200 candles
          return updated.slice(-200);
        });
      }
    },

    onCandleClosed: (data) => {
      if (data.asset === asset) {
        console.log('[Dashboard] Candle closed:', data.candle);
      }
    },

    onIndicators: (data) => {
      if (data.asset === asset) {
        setIndicators({
          rsi: data.rsi,
          bbUpper: data.bbUpper,
          bbMiddle: data.bbMiddle,
          bbLower: data.bbLower,
          atr: data.atr,
        });
      }
    },

    onTradeExecuted: (data) => {
      console.log('[Dashboard] Trade executed:', data);

      // Add marker for trade entry
      setTrades((prev) => [
        ...prev,
        {
          time: data.timestamp * 1000,
          position: data.direction === 'CALL' ? 'belowBar' : 'aboveBar',
          color: data.direction === 'CALL' ? '#26a69a' : '#ef5350',
          shape: data.direction === 'CALL' ? 'arrowUp' : 'arrowDown',
          text: `${data.direction} Entry`,
        },
      ]);
    },

    onTradeResult: (data) => {
      console.log('[Dashboard] Trade result:', data);

      // Add marker for trade exit
      setTrades((prev) => [
        ...prev,
        {
          time: data.timestamp * 1000,
          position: data.result === 'won' ? 'aboveBar' : 'belowBar',
          color: data.result === 'won' ? '#22c55e' : '#ef4444',
          shape: data.result === 'won' ? 'arrowUp' : 'arrowDown',
          text: `${data.result.toUpperCase()} ${data.profit >= 0 ? '+' : ''}$${data.profit.toFixed(2)}`,
        },
      ]);
    },
  });

  // Initial data load
  useEffect(() => {
    if (!gateway.connected) return;

    (async () => {
      try {
        // Follow asset
        console.log('[Dashboard] Following asset:', asset);
        await gateway.follow([asset]);

        // Load initial candles (1 minute timeframe)
        console.log('[Dashboard] Loading initial candles...');
        const initialCandles = await gateway.getCandles(asset, 60, 100);
        console.log('[Dashboard] Loaded', initialCandles.length, 'candles');
        setCandles(initialCandles);

        // Get balance
        const balanceData = await gateway.getBalance();
        setBalance(balanceData.amount);

        // Get stats
        const statsData = await gateway.getStats();
        setStats(statsData.stats || statsData);

        console.log('[Dashboard] Initial data loaded');
      } catch (error) {
        console.error('[Dashboard] Error loading initial data:', error);
      }
    })();
  }, [gateway.connected, asset]);

  // Handle loading more historical data when user scrolls left
  const handleLoadMore = async (oldestTimestamp: number) => {
    console.log('[Dashboard] Loading more candles before timestamp:', oldestTimestamp);

    try {
      // Request 100 candles BEFORE the oldest timestamp
      const olderCandles = await gateway.getCandles(asset, 60, 100, oldestTimestamp);

      if (olderCandles.length > 0) {
        console.log('[Dashboard] Loaded', olderCandles.length, 'older candles');

        // Prepend new candles to existing ones, removing duplicates
        setCandles(prev => {
          // Create a Map to deduplicate by timestamp (keep the first occurrence)
          const candleMap = new Map<number, Candle>();

          // Add older candles first
          olderCandles.forEach(c => candleMap.set(c.timestamp, c));

          // Add existing candles (will overwrite any duplicates with newer data)
          prev.forEach(c => candleMap.set(c.timestamp, c));

          // Convert back to array and sort
          const uniqueCandles = Array.from(candleMap.values());
          return uniqueCandles.sort((a, b) => a.timestamp - b.timestamp);
        });
      } else {
        console.log('[Dashboard] No more historical data available');
      }
    } catch (error) {
      console.error('[Dashboard] Error loading more candles:', error);
    }
  };

  return (
    <div className="trading-dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1>🤖 Deriv Bot - Live Trading</h1>
          <div className="connection-status">
            {gateway.connected ? (
              <span className="status-connected">● Connected</span>
            ) : (
              <span className="status-disconnected">● Disconnected</span>
            )}
          </div>
        </div>
        <div className="header-right">
          <div className="stat-item">
            <span className="stat-label">Asset:</span>
            <span className="stat-value">{asset}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Price:</span>
            <span className="stat-value">${lastPrice.toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Balance:</span>
            <span className="stat-value">${balance.toFixed(2)}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="dashboard-content">
        {/* Chart */}
        <div className="chart-section">
          {candles.length > 0 ? (
            <CandlestickChart
              candles={candles}
              indicators={indicators}
              trades={trades}
              title={`${asset} - 1 Minute`}
              onLoadMore={handleLoadMore}
            />
          ) : (
            <div className="loading">
              <p>Loading chart data...</p>
            </div>
          )}
        </div>

        {/* Stats panel */}
        <aside className="stats-panel">
          <div className="panel-section">
            <h3>Today's Stats</h3>
            {stats ? (
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-card-label">Trades</span>
                  <span className="stat-card-value">{stats.totalTrades || 0}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card-label">Wins</span>
                  <span className="stat-card-value success">{stats.wins || 0}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card-label">Losses</span>
                  <span className="stat-card-value error">{stats.losses || 0}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-card-label">Win Rate</span>
                  <span className="stat-card-value">
                    {stats.totalTrades > 0
                      ? ((stats.wins / stats.totalTrades) * 100).toFixed(1)
                      : '0.0'}%
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-card-label">Net P&L</span>
                  <span className={`stat-card-value ${stats.netPnL >= 0 ? 'success' : 'error'}`}>
                    ${stats.netPnL?.toFixed(2) || '0.00'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="no-data">No stats available</p>
            )}
          </div>

          <div className="panel-section">
            <h3>Indicators</h3>
            <div className="indicators-list">
              {indicators.rsi && (
                <div className="indicator-item">
                  <span className="indicator-label">RSI:</span>
                  <span className="indicator-value">{indicators.rsi.toFixed(1)}</span>
                </div>
              )}
              {indicators.bbUpper && (
                <>
                  <div className="indicator-item">
                    <span className="indicator-label">BB Upper:</span>
                    <span className="indicator-value">{indicators.bbUpper.toFixed(2)}</span>
                  </div>
                  <div className="indicator-item">
                    <span className="indicator-label">BB Middle:</span>
                    <span className="indicator-value">{indicators.bbMiddle?.toFixed(2)}</span>
                  </div>
                  <div className="indicator-item">
                    <span className="indicator-label">BB Lower:</span>
                    <span className="indicator-value">{indicators.bbLower?.toFixed(2)}</span>
                  </div>
                </>
              )}
              {indicators.atr && (
                <div className="indicator-item">
                  <span className="indicator-label">ATR:</span>
                  <span className="indicator-value">{indicators.atr.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
