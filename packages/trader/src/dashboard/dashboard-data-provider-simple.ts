/**
 * Simple Data Provider for Ink Dashboard (Pure Consumer)
 *
 * This provider ONLY reads from the Gateway - it does NOT:
 * - Run strategies
 * - Calculate indicators
 * - Generate signals
 * - Execute trades
 *
 * It's a pure consumer that displays what the Gateway provides.
 */

import { GatewayClient } from '@deriv-bot/shared';
import type { Balance, SignalProximity } from '@deriv-bot/shared';

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

export interface SignalProximityView {
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
  signalProximity: SignalProximityView[];
  assets: Asset[];
  lastUpdate: Date;
}

export class SimpleDashboardDataProvider {
  private portfolioCache: { positions: Position[]; timestamp: number } | null = null;
  private portfolioCacheTTL = 3000; // 3 seconds

  // Store latest signal proximity data received from Gateway
  private signalProximityCache: Map<string, SignalProximity> = new Map();

  constructor(private gatewayClient: GatewayClient) {
    // Listen for signal proximity updates from Gateway
    this.gatewayClient.on('signal:proximity', (data: SignalProximity | SignalProximity[]) => {
      const proximities = Array.isArray(data) ? data : [data];

      for (const prox of proximities) {
        this.signalProximityCache.set(prox.asset, prox);
      }
    });
  }

  async fetchAll(): Promise<DashboardData> {
    const [balance, positions, strategies, assets] = await Promise.all([
      this.getBalance(),
      this.getPositions(),
      this.getStrategies(),
      this.getMonitoredAssets(),
    ]);

    const signalProximity = this.getSignalProximity();

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
    // Dashboard doesn't know about strategies running in trader
    // Show placeholder
    const symbols = (process.env.SYMBOL || 'R_75').split(',').map((s) => s.trim());
    return [
      {
        name: 'Trading Strategy (Running in Trader)',
        assets: symbols,
        status: 'active' as const,
        signalsToday: 0,
      },
    ];
  }

  private getSignalProximity(): SignalProximityView[] {
    // Return cached signal proximity data from Gateway
    const result: SignalProximityView[] = [];

    for (const [asset, prox] of this.signalProximityCache.entries()) {
      result.push({
        asset,
        proximity: prox.overallProximity,
        direction: prox.direction === 'neutral' ? null : (prox.direction.toUpperCase() as 'CALL' | 'PUT'),
        conditions: prox.criteria.map((c) => ({
          name: c.name,
          status: c.passed ? 'met' : 'not_met',
          value: c.current,
        })),
      });
    }

    // If no signal proximity data yet, show placeholder
    if (result.length === 0) {
      const symbols = (process.env.SYMBOL || 'R_75').split(',').map((s) => s.trim());
      for (const symbol of symbols) {
        result.push({
          asset: symbol,
          proximity: 0,
          direction: null,
          conditions: [
            {
              name: 'Waiting for trader to publish signal proximity...',
              status: 'warning' as const,
              value: 'Start the trader to see signal proximity',
            },
          ],
        });
      }
    }

    return result;
  }

  private async getMonitoredAssets(): Promise<Asset[]> {
    const result: Asset[] = [];

    // Get assets from environment (dashboard doesn't know what trader is monitoring)
    const symbols = (process.env.SYMBOL || 'R_75').split(',').map((s) => s.trim());

    for (const symbol of symbols) {
      result.push({
        symbol,
        price: 0, // Price will be updated from tick stream in run-dashboard-simple.ts
        change: 0,
        status: 'MONITORING',
      });
    }

    return result;
  }
}
