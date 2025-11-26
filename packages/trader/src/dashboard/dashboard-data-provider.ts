/**
 * Data provider for the Ink-based dashboard
 * Bridges the dashboard UI with the backend services
 */

import { StrategyEngine } from '../strategy/strategy-engine.js';
import { GatewayClient } from '@deriv-bot/shared';
import type { Balance } from '@deriv-bot/shared';

export interface Position {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number;
  currentPrice: number;
  profit: number;
  profitPercentage: number;
  purchaseTime: Date;
  status: 'open' | 'sold';
}

export interface StrategyInfo {
  name: string;
  assets: string[];
  status: 'active' | 'paused';
  signalsToday: number;
}

export interface SignalProximity {
  asset: string;
  proximity: number;
  direction: 'CALL' | 'PUT' | null;
  conditions: {
    name: string;
    status: 'met' | 'not_met' | 'warning';
    value?: string | number;
  }[];
}

export interface Asset {
  symbol: string;
  price: number;
  change: number;
  status: string;
}

export interface DashboardData {
  balance: Balance | null;
  positions: Position[];
  strategies: StrategyInfo[];
  signalProximity: SignalProximity[];
  assets: Asset[];
  lastUpdate: Date;
}

export class DashboardDataProvider {
  private portfolioCache: { positions: Position[]; timestamp: number } | null = null;
  private portfolioCacheTTL = 3000; // 3 seconds

  constructor(
    private engine: StrategyEngine | null,
    private gatewayClient: GatewayClient
  ) {}

  async fetchAll(): Promise<DashboardData> {
    const [balance, positions, strategies, signalProximity, assets] = await Promise.all([
      this.getBalance(),
      this.getPositions(),
      this.getStrategies(),
      this.getSignalProximity(),
      this.getMonitoredAssets(),
    ]);

    return {
      balance,
      positions,
      strategies,
      signalProximity,
      assets,
      lastUpdate: new Date(),
    };
  }

  private async getBalance(): Promise<Balance | null> {
    try {
      return await this.gatewayClient.getBalance();
    } catch {
      return null;
    }
  }

  private async getPositions(): Promise<Position[]> {
    // Use local cache to avoid too frequent API calls
    const now = Date.now();
    if (this.portfolioCache && now - this.portfolioCache.timestamp < this.portfolioCacheTTL) {
      return this.portfolioCache.positions;
    }

    try {
      const positions = await this.gatewayClient.getPortfolio();

      // Convert purchaseTime to Date if it's a string or number
      const normalizedPositions = positions.map((pos) => ({
        ...pos,
        purchaseTime:
          pos.purchaseTime instanceof Date
            ? pos.purchaseTime
            : typeof pos.purchaseTime === 'string' || typeof pos.purchaseTime === 'number'
            ? new Date(pos.purchaseTime)
            : new Date(),
      }));

      // Update cache
      this.portfolioCache = {
        positions: normalizedPositions,
        timestamp: now,
      };
      return normalizedPositions;
    } catch (error) {
      // If error but we have cached data, return it
      if (this.portfolioCache) {
        return this.portfolioCache.positions;
      }
      return [];
    }
  }

  private async getStrategies(): Promise<StrategyInfo[]> {
    if (!this.engine) {
      // Dashboard is decoupled - strategies are running in the trader
      const symbols = (process.env.SYMBOL || 'R_75').split(',').map((s) => s.trim());
      return [
        {
          name: 'RSI + BB Scalping (Running in Trader)',
          assets: symbols,
          status: 'active' as const,
          signalsToday: 0,
        },
      ];
    }
    const strategies = this.engine.getAllStrategies();
    return strategies.map((strategy) => {
      const config = strategy.getConfig();
      return {
        name: strategy.getName(),
        assets: config.assets || [],
        status: strategy.isRunning() ? 'active' : 'paused',
        signalsToday: 0, // TODO: Track signals per strategy
      };
    });
  }

  private async getSignalProximity(): Promise<SignalProximity[]> {
    if (!this.engine) {
      return [
        {
          asset: 'N/A',
          proximity: 0,
          direction: null,
          conditions: [
            {
              name: 'Signal proximity available in trader logs',
              status: 'warning' as const,
              value: 'Run trader:rsi-bb to see signal proximity',
            },
          ],
        },
      ];
    }

    const strategies = this.engine.getAllStrategies();
    const proximity: SignalProximity[] = [];
    const monitoredAssets = this.engine.getMonitoredAssets();

    for (const asset of monitoredAssets) {
      for (const strategy of strategies) {
        try {
          // Try to get signal proximity if strategy supports it
          if (typeof (strategy as any).getSignalProximity === 'function') {
            const candles = this.engine.getCandleDataForAsset(strategy.getName(), asset);
            if (candles.length >= 50) {
              // Need enough candles for indicators
              const prox = (strategy as any).getSignalProximity(candles);
              if (prox) {
                proximity.push({
                  asset,
                  proximity: prox.overallProximity || prox.proximity || 0,
                  direction: prox.direction
                    ? (prox.direction.toUpperCase() as 'CALL' | 'PUT')
                    : null,
                  conditions: (prox.criteria || []).map((c: any) => ({
                    name: c.name || '',
                    status: c.passed ? 'met' : 'not_met',
                    value: c.current !== undefined ? String(c.current) : undefined,
                  })),
                });
                break; // Only show one proximity per asset
              }
            }
          }
        } catch (error) {
          // Strategy doesn't support proximity or error, skip silently
        }
      }
    }

    return proximity;
  }

  private async getMonitoredAssets(): Promise<Asset[]> {
    const result: Asset[] = [];

    if (!this.engine) {
      // Dashboard is decoupled - get assets from environment
      const symbols = (process.env.SYMBOL || 'R_75').split(',').map((s) => s.trim());
      for (const symbol of symbols) {
        result.push({
          symbol,
          price: 0, // Price will be updated from Gateway tick stream
          change: 0,
          status: 'MONITORING',
        });
      }
      return result;
    }

    const assets = this.engine.getMonitoredAssets();

    for (const asset of assets) {
      try {
        let latestPrice = 0;
        let previousPrice = 0;

        const strategies = this.engine.getAllStrategies();
        for (const strategy of strategies) {
          // Try to get latest tick price
          const latestTick = (this.engine as any).getLatestTick?.(strategy.getName());
          if (latestTick && latestTick.asset === asset) {
            latestPrice = latestTick.price;
          }

          // Fallback to candle close price
          if (latestPrice === 0) {
            const candles = this.engine.getCandleDataForAsset(strategy.getName(), asset);
            if (candles.length > 0) {
              const lastCandle = candles[candles.length - 1];
              if (lastCandle) {
                latestPrice = lastCandle.close;
                if (candles.length > 1) {
                  const prevCandle = candles[candles.length - 2];
                  if (prevCandle) {
                    previousPrice = prevCandle.close;
                  }
                }
              }
            }
          } else {
            // If we have tick price, get previous candle for change calculation
            const candles = this.engine.getCandleDataForAsset(strategy.getName(), asset);
            if (candles.length > 0) {
              const lastCandle = candles[candles.length - 1];
              if (lastCandle) {
                previousPrice = lastCandle.close;
              }
            }
          }
          break;
        }

        const change = previousPrice > 0 ? ((latestPrice - previousPrice) / previousPrice) * 100 : 0;

        result.push({
          symbol: asset,
          price: latestPrice,
          change,
          status: latestPrice > 0 ? 'ACTIVE' : 'WAITING',
        });
      } catch {
        result.push({
          symbol: asset,
          price: 0,
          change: 0,
          status: 'UNKNOWN',
        });
      }
    }

    return result;
  }
}
