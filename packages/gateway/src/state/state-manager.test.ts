/**
 * State Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { StateManager, type TradeInput } from './state-manager.js';

describe('StateManager', () => {
  let prisma: PrismaClient;
  let stateManager: StateManager;

  beforeEach(async () => {
    // Use unique in-memory SQLite for each test (no cache=shared)
    // This ensures test isolation
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: 'file::memory:',
        },
      },
    });

    // Create tables manually (since we can't run migrations in-memory easily)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "candles" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "asset" TEXT NOT NULL,
        "timeframe" INTEGER NOT NULL,
        "timestamp" INTEGER NOT NULL,
        "open" REAL NOT NULL,
        "high" REAL NOT NULL,
        "low" REAL NOT NULL,
        "close" REAL NOT NULL,
        "volume" REAL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ticks" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "asset" TEXT NOT NULL,
        "price" REAL NOT NULL,
        "timestamp" INTEGER NOT NULL,
        "direction" INTEGER,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "symbols" (
        "symbol" TEXT NOT NULL PRIMARY KEY,
        "displayName" TEXT NOT NULL,
        "market" TEXT NOT NULL,
        "submarket" TEXT NOT NULL,
        "isOpen" INTEGER NOT NULL,
        "pipSize" REAL NOT NULL,
        "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "trades" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "contractId" TEXT NOT NULL UNIQUE,
        "type" TEXT NOT NULL,
        "asset" TEXT NOT NULL,
        "timeframe" INTEGER NOT NULL,
        "entryPrice" REAL NOT NULL,
        "exitPrice" REAL,
        "stake" REAL NOT NULL,
        "payout" REAL,
        "result" TEXT,
        "profit" REAL,
        "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedAt" DATETIME,
        "expiryTime" DATETIME,
        "signalType" TEXT,
        "rsi" REAL,
        "bbUpper" REAL,
        "bbMiddle" REAL,
        "bbLower" REAL,
        "atr" REAL,
        "strategyName" TEXT NOT NULL
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "daily_stats" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "date" TEXT NOT NULL UNIQUE,
        "totalTrades" INTEGER NOT NULL DEFAULT 0,
        "wins" INTEGER NOT NULL DEFAULT 0,
        "losses" INTEGER NOT NULL DEFAULT 0,
        "pending" INTEGER NOT NULL DEFAULT 0,
        "winRate" REAL NOT NULL DEFAULT 0,
        "totalStake" REAL NOT NULL DEFAULT 0,
        "totalPayout" REAL NOT NULL DEFAULT 0,
        "netPnL" REAL NOT NULL DEFAULT 0,
        "startBalance" REAL,
        "endBalance" REAL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endedAt" DATETIME,
        "strategyName" TEXT NOT NULL,
        "asset" TEXT NOT NULL,
        "trades" INTEGER NOT NULL DEFAULT 0,
        "wins" INTEGER NOT NULL DEFAULT 0,
        "losses" INTEGER NOT NULL DEFAULT 0,
        "pnl" REAL NOT NULL DEFAULT 0,
        "startBalance" REAL NOT NULL,
        "endBalance" REAL
      );
    `);

    stateManager = new StateManager(prisma);
    await stateManager.initialize();
  });

  afterEach(async () => {
    // Clean up all data before shutting down
    await prisma.trade.deleteMany({});
    await prisma.dailyStats.deleteMany({});
    await stateManager.shutdown();
  });

  describe('initialize', () => {
    it('should initialize and create today stats record', async () => {
      const today = new Date().toISOString().split('T')[0];

      const stats = await prisma.dailyStats.findUnique({
        where: { date: today },
      });

      expect(stats).toBeDefined();
      expect(stats?.totalTrades).toBe(0);
    });

    it('should not fail if called multiple times', async () => {
      await stateManager.initialize();
      await stateManager.initialize();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('recordTrade', () => {
    it('should create a new trade in database', async () => {
      const tradeInput: TradeInput = {
        contractId: 'CT_RECORD_1',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
        signalType: 'RSI_OVERSOLD',
        rsi: 15.2,
      };

      await stateManager.recordTrade(tradeInput);

      const trade = await prisma.trade.findUnique({
        where: { contractId: 'CT_RECORD_1' },
      });

      expect(trade).toBeDefined();
      expect(trade?.type).toBe('CALL');
      expect(trade?.asset).toBe('R_75');
      expect(trade?.result).toBe('PENDING');
      expect(trade?.rsi).toBe(15.2);
    });

    it('should emit trade:opened event', async () => {
      const tradeInput: TradeInput = {
        contractId: 'CT_EMIT_1',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      };

      const eventSpy = vi.fn();
      stateManager.on('trade:opened', eventSpy);

      await stateManager.recordTrade(tradeInput);

      expect(eventSpy).toHaveBeenCalledOnce();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'CT_EMIT_1',
          result: 'PENDING',
        })
      );
    });

    it('should update daily stats with pending trade', async () => {
      const tradeInput: TradeInput = {
        contractId: 'CT_STATS_1',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      };

      await stateManager.recordTrade(tradeInput);

      const today = new Date().toISOString().split('T')[0];
      const stats = await prisma.dailyStats.findUnique({
        where: { date: today },
      });

      expect(stats?.totalTrades).toBe(1);
      expect(stats?.pending).toBe(1);
      expect(stats?.totalStake).toBe(10.00);
    });
  });

  describe('updateTrade', () => {
    it('should update trade result to WIN', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_UPDATE_WIN',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.updateTrade('CT_UPDATE_WIN', {
        exitPrice: 57050.30,
        payout: 18.50,
        result: 'WIN',
      });

      const trade = await prisma.trade.findUnique({
        where: { contractId: 'CT_UPDATE_WIN' },
      });

      expect(trade?.result).toBe('WIN');
      expect(trade?.exitPrice).toBe(57050.30);
      expect(trade?.payout).toBe(18.50);
      expect(trade?.profit).toBe(18.50);
      expect(trade?.closedAt).toBeDefined();
    });

    it('should update trade result to LOSS', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_UPDATE_LOSS',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.updateTrade('CT_UPDATE_LOSS', {
        exitPrice: 57000.00,
        payout: 10.00,
        result: 'LOSS',
      });

      const trade = await prisma.trade.findUnique({
        where: { contractId: 'CT_UPDATE_LOSS' },
      });

      expect(trade?.result).toBe('LOSS');
      expect(trade?.profit).toBe(-10.00);
    });

    it('should emit trade:closed event', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_UPDATE_EVENT',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      const eventSpy = vi.fn();
      stateManager.on('trade:closed', eventSpy);

      await stateManager.updateTrade('CT_UPDATE_EVENT', {
        exitPrice: 57050.30,
        payout: 18.50,
        result: 'WIN',
      });

      expect(eventSpy).toHaveBeenCalledOnce();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'CT_UPDATE_EVENT',
          result: 'WIN',
        })
      );
    });

    it('should update daily stats correctly', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_UPDATE_STATS',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.updateTrade('CT_UPDATE_STATS', {
        exitPrice: 57050.30,
        payout: 18.50,
        result: 'WIN',
      });

      const today = new Date().toISOString().split('T')[0];
      const stats = await prisma.dailyStats.findUnique({
        where: { date: today },
      });

      expect(stats?.wins).toBe(1);
      expect(stats?.losses).toBe(0);
      expect(stats?.pending).toBe(0);
      expect(stats?.winRate).toBe(100);
      expect(stats?.totalPayout).toBe(18.50);
      expect(stats?.netPnL).toBe(18.50);
    });
  });

  describe('getDailyStats', () => {
    it('should return stats for today', async () => {
      // Create some trades
      await stateManager.recordTrade({
        contractId: 'CT_STATS_TODAY_1',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.updateTrade('CT_STATS_TODAY_1', {
        exitPrice: 57050.30,
        payout: 18.50,
        result: 'WIN',
      });

      const stats = await stateManager.getDailyStats();

      expect(stats.totalTrades).toBe(1);
      expect(stats.wins).toBe(1);
      expect(stats.winRate).toBe(100);
      expect(stats.netPnL).toBe(18.50);
    });

    it('should calculate win rate correctly with wins and losses', async () => {
      // Win trade
      await stateManager.recordTrade({
        contractId: 'CT_WINRATE_WIN',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });
      await stateManager.updateTrade('CT_WINRATE_WIN', {
        payout: 18.50,
        result: 'WIN',
      });

      // Loss trade
      await stateManager.recordTrade({
        contractId: 'CT_WINRATE_LOSS',
        type: 'PUT',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57100.00,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });
      await stateManager.updateTrade('CT_WINRATE_LOSS', {
        payout: 10.00,
        result: 'LOSS',
      });

      const stats = await stateManager.getDailyStats();

      expect(stats.totalTrades).toBe(2);
      expect(stats.wins).toBe(1);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBe(50);
      expect(stats.netPnL).toBe(8.50); // 18.50 - 10.00
    });
  });

  describe('getTrades', () => {
    it('should get all trades with limit', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_GET_ALL_1',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.recordTrade({
        contractId: 'CT_GET_ALL_2',
        type: 'PUT',
        asset: 'R_100',
        timeframe: 60,
        entryPrice: 12345.00,
        stake: 15.00,
        strategyName: 'breakout-v1',
      });

      const trades = await stateManager.getTrades({ limit: 10 });

      expect(trades).toHaveLength(2);
    });

    it('should filter by asset', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_FILTER_ASSET_R75',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.recordTrade({
        contractId: 'CT_FILTER_ASSET_R100',
        type: 'PUT',
        asset: 'R_100',
        timeframe: 60,
        entryPrice: 12345.00,
        stake: 15.00,
        strategyName: 'breakout-v1',
      });

      const trades = await stateManager.getTrades({ asset: 'R_75' });

      expect(trades).toHaveLength(1);
      expect(trades[0].asset).toBe('R_75');
    });

    it('should filter by strategy', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_FILTER_STRAT_MR',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.recordTrade({
        contractId: 'CT_FILTER_STRAT_BO',
        type: 'PUT',
        asset: 'R_100',
        timeframe: 60,
        entryPrice: 12345.00,
        stake: 15.00,
        strategyName: 'breakout-v1',
      });

      const trades = await stateManager.getTrades({ strategy: 'mean-reversion-v2' });

      expect(trades).toHaveLength(1);
      expect(trades[0].strategyName).toBe('mean-reversion-v2');
    });

    it('should filter by result', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_FILTER_RESULT_WIN',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      await stateManager.recordTrade({
        contractId: 'CT_FILTER_RESULT_PENDING',
        type: 'PUT',
        asset: 'R_100',
        timeframe: 60,
        entryPrice: 12345.00,
        stake: 15.00,
        strategyName: 'breakout-v1',
      });

      await stateManager.updateTrade('CT_FILTER_RESULT_WIN', {
        payout: 18.50,
        result: 'WIN',
      });

      const trades = await stateManager.getTrades({ result: 'WIN' });

      expect(trades).toHaveLength(1);
      expect(trades[0].result).toBe('WIN');
    });

    it('should order by most recent first', async () => {
      await stateManager.recordTrade({
        contractId: 'CT_ORDER_FIRST',
        type: 'CALL',
        asset: 'R_75',
        timeframe: 60,
        entryPrice: 57025.50,
        stake: 10.00,
        strategyName: 'mean-reversion-v2',
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      await stateManager.recordTrade({
        contractId: 'CT_ORDER_SECOND',
        type: 'PUT',
        asset: 'R_100',
        timeframe: 60,
        entryPrice: 12345.00,
        stake: 15.00,
        strategyName: 'breakout-v1',
      });

      const trades = await stateManager.getTrades({});

      // CT_ORDER_SECOND was created after CT_ORDER_FIRST
      expect(trades[0].contractId).toBe('CT_ORDER_SECOND');
      expect(trades[1].contractId).toBe('CT_ORDER_FIRST');
    });
  });
});
