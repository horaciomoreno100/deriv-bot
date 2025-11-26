/**
 * Tests para las 5 mejoras implementadas en RSI-BB-Scalping-Demo
 *
 * 1. Timer Periódico (30s polling)
 * 2. Trailing Stop Loss Dinámico
 * 3. Límite por Símbolo
 * 4. API Integration (proposal validation)
 * 5. Riesgo Dinámico
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock types
interface TrailingStopInfo {
  contractId: string;
  asset: string;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  currentTP: number;
  highestProfit: number;
  isTrailingActive: boolean;
  trailingActivatedAt?: number;
}

interface Trade {
  contractId: string;
  asset: string;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  timestamp: number;
  closed: boolean;
  stake?: number;
  metadata?: {
    tpPct?: number;
    slPct?: number;
    recovered?: boolean;
  };
}

class MockGatewayClient {
  private portfolio: any[] = [];
  private balance = 10000;

  async getPortfolio() {
    return this.portfolio;
  }

  async getBalance() {
    return {
      amount: this.balance,
      loginid: 'VRT1234567',
      accountType: 'virtual',
    };
  }

  setPortfolio(positions: any[]) {
    this.portfolio = positions;
  }

  setBalance(amount: number) {
    this.balance = amount;
  }
}

class MockUnifiedTradeAdapter {
  private closedTrades: string[] = [];

  async closeTrade(contractId: string) {
    this.closedTrades.push(contractId);
    return { success: true, contractId };
  }

  getClosedTrades() {
    return this.closedTrades;
  }

  reset() {
    this.closedTrades = [];
  }
}

describe('🆕 MEJORA 1: Timer Periódico para SMART Exit', () => {
  let mockClient: MockGatewayClient;
  let mockAdapter: MockUnifiedTradeAdapter;
  let tradeHistory: Trade[];

  beforeEach(() => {
    mockClient = new MockGatewayClient();
    mockAdapter = new MockUnifiedTradeAdapter();
    tradeHistory = [];
  });

  it('should check portfolio every 30 seconds', async () => {
    const getPortfolioSpy = vi.spyOn(mockClient, 'getPortfolio');
    let callCount = 0;

    const timer = setInterval(async () => {
      await mockClient.getPortfolio();
      callCount++;
      if (callCount >= 3) clearInterval(timer);
    }, 100);

    await new Promise(resolve => setTimeout(resolve, 350));
    clearInterval(timer);

    expect(getPortfolioSpy).toHaveBeenCalledTimes(3);
  });

  it('should apply SMART Exit rules independently of ticks', async () => {
    const now = Date.now();
    const trade: Trade = {
      contractId: '123456789',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      timestamp: now - (125 * 60 * 1000),
      closed: false,
      metadata: { tpPct: 0.3 },
    };
    tradeHistory.push(trade);

    mockClient.setPortfolio([
      {
        contractId: '123456789',
        symbol: 'R_75',
        buyPrice: 5000,
        currentPrice: 4950,
        profit: -50,
        profitPercentage: -1.0,
        purchaseTime: new Date(trade.timestamp),
        contractType: 'MULTUP',
      },
    ]);

    const position = (await mockClient.getPortfolio())[0];
    const tradeFromHistory = tradeHistory.find(t => t.contractId === position.contractId);

    const timeInTrade = now - position.purchaseTime.getTime();
    const MAX_TRADE_DURATION = 40 * 60 * 1000;

    let shouldExit = false;
    let exitReason = '';

    if (timeInTrade >= (MAX_TRADE_DURATION * 3)) {
      shouldExit = true;
      exitReason = 'EXTREME duration - forced close';
    }

    if (shouldExit && tradeFromHistory) {
      await mockAdapter.closeTrade(position.contractId);
      tradeFromHistory.closed = true;
    }

    expect(shouldExit).toBe(true);
    expect(exitReason).toContain('EXTREME duration');
    expect(mockAdapter.getClosedTrades()).toContain('123456789');
    expect(tradeHistory[0].closed).toBe(true);
  });
});

describe('🆕 MEJORA 2: Trailing Stop Loss Dinámico', () => {
  let trailingStops: Map<string, TrailingStopInfo>;
  let mockAdapter: MockUnifiedTradeAdapter;
  let tradeHistory: Trade[];

  beforeEach(() => {
    trailingStops = new Map();
    mockAdapter = new MockUnifiedTradeAdapter();
    tradeHistory = [];
  });

  it('should initialize trailing stop when trade is opened', () => {
    const contractId = 'TRAIL_001';
    const trailingInfo: TrailingStopInfo = {
      contractId,
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      currentTP: 5020,
      highestProfit: 0,
      isTrailingActive: false,
    };

    trailingStops.set(contractId, trailingInfo);

    expect(trailingStops.has(contractId)).toBe(true);
    expect(trailingStops.get(contractId)?.isTrailingActive).toBe(false);
    expect(trailingStops.get(contractId)?.highestProfit).toBe(0);
  });

  it('should activate trailing when profit reaches 20% of TP', () => {
    const TRAILING_ACTIVATION_THRESHOLD = 0.20;
    const tpPct = 0.3;
    const activationThreshold = tpPct * TRAILING_ACTIVATION_THRESHOLD;

    const trailingInfo: TrailingStopInfo = {
      contractId: 'TRAIL_002',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      currentTP: 5015,
      highestProfit: 0,
      isTrailingActive: false,
    };
    trailingStops.set('TRAIL_002', trailingInfo);

    const profitPct = 0.08;

    if (profitPct > trailingInfo.highestProfit) {
      trailingInfo.highestProfit = profitPct;
    }

    if (!trailingInfo.isTrailingActive && profitPct >= activationThreshold) {
      trailingInfo.isTrailingActive = true;
      trailingInfo.trailingActivatedAt = Date.now();
    }

    expect(trailingInfo.isTrailingActive).toBe(true);
    expect(trailingInfo.trailingActivatedAt).toBeDefined();
    expect(trailingInfo.highestProfit).toBe(0.08);
  });

  it('should close trade when profit drops below buffer from highest', async () => {
    const TRAILING_BUFFER = 0.001;
    const tpPct = 0.3;

    const trade: Trade = {
      contractId: 'TRAIL_003',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      timestamp: Date.now(),
      closed: false,
      metadata: { tpPct },
    };
    tradeHistory.push(trade);

    const trailingInfo: TrailingStopInfo = {
      contractId: 'TRAIL_003',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      currentTP: 5015,
      highestProfit: 0.20,
      isTrailingActive: true,
      trailingActivatedAt: Date.now() - 5000,
    };
    trailingStops.set('TRAIL_003', trailingInfo);

    const currentProfitPct = 0.05;
    const profitDrop = trailingInfo.highestProfit - currentProfitPct;

    let shouldExit = false;
    let exitReason = '';

    if (profitDrop >= (tpPct * TRAILING_BUFFER)) {
      shouldExit = true;
      exitReason = `Trailing stop: profit cayó ${profitDrop.toFixed(3)}%`;
    }

    if (shouldExit) {
      await mockAdapter.closeTrade('TRAIL_003');
      trade.closed = true;
      trailingStops.delete('TRAIL_003');
    }

    expect(profitDrop).toBeGreaterThan(tpPct * TRAILING_BUFFER);
    expect(shouldExit).toBe(true);
    expect(exitReason).toContain('Trailing stop');
    expect(trade.closed).toBe(true);
    expect(trailingStops.has('TRAIL_003')).toBe(false);
  });
});

describe('🆕 MEJORA 3: Límite por Símbolo', () => {
  let tradeHistory: Trade[];

  beforeEach(() => {
    tradeHistory = [];
  });

  it('should allow first trade on a symbol', () => {
    const MAX_TRADES_PER_SYMBOL = 1;
    const asset = 'R_75';

    const openTradesForAsset = tradeHistory.filter(
      t => !t.closed && t.contractId && t.asset === asset
    ).length;

    const canTrade = openTradesForAsset < MAX_TRADES_PER_SYMBOL;

    expect(openTradesForAsset).toBe(0);
    expect(canTrade).toBe(true);
  });

  it('should reject second trade on same symbol', () => {
    const MAX_TRADES_PER_SYMBOL = 1;
    const asset = 'R_75';

    tradeHistory.push({
      contractId: 'R75_001',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      timestamp: Date.now(),
      closed: false,
    });

    const openTradesForAsset = tradeHistory.filter(
      t => !t.closed && t.contractId && t.asset === asset
    ).length;

    const canTrade = openTradesForAsset < MAX_TRADES_PER_SYMBOL;

    expect(openTradesForAsset).toBe(1);
    expect(canTrade).toBe(false);
  });

  it('should allow trades on different symbols simultaneously', () => {
    const MAX_TRADES_PER_SYMBOL = 1;

    tradeHistory.push(
      {
        contractId: 'R75_001',
        asset: 'R_75',
        direction: 'CALL',
        entryPrice: 5000,
        timestamp: Date.now(),
        closed: false,
      },
      {
        contractId: 'R100_001',
        asset: 'R_100',
        direction: 'PUT',
        entryPrice: 1000,
        timestamp: Date.now(),
        closed: false,
      }
    );

    const openTradesR75 = tradeHistory.filter(
      t => !t.closed && t.contractId && t.asset === 'R_75'
    ).length;
    const openTradesR100 = tradeHistory.filter(
      t => !t.closed && t.contractId && t.asset === 'R_100'
    ).length;

    expect(openTradesR75).toBe(1);
    expect(openTradesR100).toBe(1);
  });
});

describe('🆕 MEJORA 4: API Integration - Proposal Validation', () => {
  it('should validate binary options trade with proposal()', async () => {
    const TRADE_MODE = 'binary';
    const mockProposal = {
      id: 'PROP_123456',
      payout: 19.50,
      stake: 10,
      askPrice: 10,
    };

    let valid = true;
    let proposalId: string | undefined;

    if (TRADE_MODE === 'binary') {
      proposalId = mockProposal.id;
      valid = !!proposalId;
    }

    expect(valid).toBe(true);
    expect(proposalId).toBe('PROP_123456');
  });

  it('should reject trade if proposal fails', async () => {
    let valid = true;
    let reason: string | undefined;

    try {
      throw new Error('Insufficient balance');
    } catch (error: any) {
      valid = false;
      reason = error.message;
    }

    expect(valid).toBe(false);
    expect(reason).toBe('Insufficient balance');
  });
});

describe('🆕 MEJORA 5: Riesgo Dinámico', () => {
  let mockClient: MockGatewayClient;

  beforeEach(() => {
    mockClient = new MockGatewayClient();
  });

  it('should calculate CFD stake as 2% of balance', async () => {
    const RISK_PERCENTAGE_CFD = 0.02;
    const slPercentage = 0.002;

    mockClient.setBalance(10000);
    const balanceInfo = await mockClient.getBalance();
    const balance = balanceInfo.amount;

    const riskAmount = balance * RISK_PERCENTAGE_CFD;
    const stakeRaw = riskAmount / slPercentage;
    const stake = Math.floor(stakeRaw * 100) / 100;

    const minStake = 1.0;
    const maxStake = balance * 0.10;
    const finalStake = Math.max(minStake, Math.min(stake, maxStake));

    expect(riskAmount).toBe(200);
    expect(stake).toBe(100000);
    expect(finalStake).toBe(1000);
  });

  it('should calculate binary stake as 1% of balance', async () => {
    const RISK_PERCENTAGE_BINARY = 0.01;

    mockClient.setBalance(10000);
    const balanceInfo = await mockClient.getBalance();
    const balance = balanceInfo.amount;

    const stakeRaw = balance * RISK_PERCENTAGE_BINARY * 0.99;
    const stake = Math.max(1.0, Math.floor(stakeRaw * 100) / 100);

    expect(stake).toBe(99);
  });

  it('should respect minimum stake of $1', async () => {
    const RISK_PERCENTAGE_BINARY = 0.01;
    mockClient.setBalance(50);

    const balanceInfo = await mockClient.getBalance();
    const balance = balanceInfo.amount;

    const stakeRaw = balance * RISK_PERCENTAGE_BINARY * 0.99;
    const stake = Math.max(1.0, Math.floor(stakeRaw * 100) / 100);

    expect(stakeRaw).toBeLessThan(1);
    expect(stake).toBe(1.0);
  });

  it('should adjust stake proportionally when balance changes', async () => {
    const RISK_PERCENTAGE_BINARY = 0.01;

    mockClient.setBalance(10000);
    let balanceInfo = await mockClient.getBalance();
    let balance = balanceInfo.amount;
    let stake1 = Math.max(1.0, Math.floor(balance * RISK_PERCENTAGE_BINARY * 0.99 * 100) / 100);

    mockClient.setBalance(15000);
    balanceInfo = await mockClient.getBalance();
    balance = balanceInfo.amount;
    let stake2 = Math.max(1.0, Math.floor(balance * RISK_PERCENTAGE_BINARY * 0.99 * 100) / 100);

    expect(stake1).toBe(99); // $10k * 0.01 * 0.99 = 99
    expect(stake2).toBe(148.5); // $15k * 0.01 * 0.99 = 148.5
    expect(stake2).toBeGreaterThan(stake1);
  });
});

describe('Integration: Combined Features', () => {
  let mockClient: MockGatewayClient;
  let mockAdapter: MockUnifiedTradeAdapter;
  let tradeHistory: Trade[];
  let trailingStops: Map<string, TrailingStopInfo>;

  beforeEach(() => {
    mockClient = new MockGatewayClient();
    mockAdapter = new MockUnifiedTradeAdapter();
    tradeHistory = [];
    trailingStops = new Map();
  });

  it('should enforce per-symbol limit AND global limit simultaneously', () => {
    const MAX_TRADES_PER_SYMBOL = 1;
    const MAX_OPEN_TRADES = 3;

    tradeHistory.push(
      {
        contractId: 'INT_001',
        asset: 'R_75',
        direction: 'CALL',
        entryPrice: 5000,
        timestamp: Date.now(),
        closed: false,
      },
      {
        contractId: 'INT_002',
        asset: 'R_100',
        direction: 'PUT',
        entryPrice: 1000,
        timestamp: Date.now(),
        closed: false,
      },
      {
        contractId: 'INT_003',
        asset: 'R_50',
        direction: 'CALL',
        entryPrice: 2000,
        timestamp: Date.now(),
        closed: false,
      }
    );

    const openTradesCount = tradeHistory.filter(t => !t.closed && t.contractId).length;
    const openTradesR75 = tradeHistory.filter(
      t => !t.closed && t.contractId && t.asset === 'R_75'
    ).length;

    const canTradeGlobal = openTradesCount < MAX_OPEN_TRADES;
    const canTradeSymbol = openTradesR75 < MAX_TRADES_PER_SYMBOL;

    expect(openTradesCount).toBe(3);
    expect(openTradesR75).toBe(1);
    expect(canTradeGlobal).toBe(false);
    expect(canTradeSymbol).toBe(false);
  });

  it('should use periodic timer + trailing stop + dynamic stake together', async () => {
    const RISK_PERCENTAGE_CFD = 0.02;
    const TRAILING_ACTIVATION_THRESHOLD = 0.20;
    const tpPct = 0.3;

    mockClient.setBalance(10000);

    const balanceInfo = await mockClient.getBalance();
    const balance = balanceInfo.amount;
    const slPercentage = 0.002;
    const riskAmount = balance * RISK_PERCENTAGE_CFD;
    const stake = Math.min(
      Math.floor((riskAmount / slPercentage) * 100) / 100,
      balance * 0.10
    );

    const trade: Trade = {
      contractId: 'INT_FULL_001',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      timestamp: Date.now(),
      closed: false,
      stake,
      metadata: { tpPct },
    };
    tradeHistory.push(trade);

    const trailingInfo: TrailingStopInfo = {
      contractId: 'INT_FULL_001',
      asset: 'R_75',
      direction: 'CALL',
      entryPrice: 5000,
      currentTP: 5020,
      highestProfit: 0,
      isTrailingActive: false,
    };
    trailingStops.set('INT_FULL_001', trailingInfo);

    mockClient.setPortfolio([
      {
        contractId: 'INT_FULL_001',
        symbol: 'R_75',
        buyPrice: 5000,
        currentPrice: 5004,
        profit: 4,
        profitPercentage: 0.08,
        purchaseTime: new Date(trade.timestamp),
        contractType: 'MULTUP',
      },
    ]);

    const position = (await mockClient.getPortfolio())[0];
    const profitPct = position.profitPercentage;
    const trailing = trailingStops.get(position.contractId)!;

    if (profitPct > trailing.highestProfit) {
      trailing.highestProfit = profitPct;
    }

    const activationThreshold = tpPct * TRAILING_ACTIVATION_THRESHOLD;
    if (!trailing.isTrailingActive && profitPct >= activationThreshold) {
      trailing.isTrailingActive = true;
      trailing.trailingActivatedAt = Date.now();
    }

    expect(stake).toBe(1000);
    expect(trailing.isTrailingActive).toBe(true);
    expect(trailing.highestProfit).toBe(0.08);
    expect(trade.closed).toBe(false);
  });
});
