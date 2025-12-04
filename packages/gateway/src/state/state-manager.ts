/**
 * State Manager
 *
 * Central state management for trading system.
 * Handles persistence, stats calculation, and event emission.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Trade = any;
// Note: PrismaClient is passed in constructor, not imported here
import { EventEmitter } from 'events';

export interface TradeInput {
  contractId: string;
  type: string; // CALL, PUT, MULTUP, MULTDOWN, etc.
  tradeMode: 'binary' | 'cfd';
  asset: string;
  timeframe: number | null;
  entryPrice: number;
  stake: number;
  strategyName: string;

  // CFD-specific
  multiplier?: number | null;
  takeProfit?: number | null;
  stopLoss?: number | null;
  takeProfitAmount?: number | null;
  stopLossAmount?: number | null;

  // Signal context
  signalType?: string | null;
  confidence?: number | null;

  // Indicators
  rsi?: number | null;
  bbUpper?: number | null;
  bbMiddle?: number | null;
  bbLower?: number | null;
  atr?: number | null;

  // Additional context
  bbDistancePct?: number | null;
  priceVsMiddle?: number | null;

  // Balance tracking
  balanceBefore?: number | null;

  // Metadata
  metadata?: string | null;

  // Optional fields
  expiryTime?: Date;
}

export interface TradeUpdate {
  exitPrice?: number;
  payout?: number;
  result?: 'WIN' | 'LOSS';
  closedAt?: Date;
  metadata?: string;
}

export interface StatsQuery {
  type: 'daily' | 'weekly' | 'monthly';
  date?: string;
  strategy?: string;
  asset?: string;
}

export interface DailyStatsResult {
  date: string;
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  totalStake: number;
  totalPayout: number;
  netPnL: number;
  startBalance?: number;
  endBalance?: number;
}

/**
 * State Manager - Central state and persistence
 */
export class StateManager extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private prisma: any;
  private initialized = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(prisma: any) {
    super();
    this.prisma = prisma;
  }

  /**
   * Initialize state manager
   * Loads today's stats from DB
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[StateManager] Initializing...');

    // Ensure today's stats record exists
    const today = this.getTodayDate();
    await this.ensureDailyStats(today);

    this.initialized = true;
    console.log('[StateManager] ✅ Initialized');
  }

  /**
   * Record a new trade
   */
  async recordTrade(input: TradeInput): Promise<void> {
    console.log(`[StateManager] Recording trade ${input.contractId}`);

    const trade = await this.prisma.trade.create({
      data: {
        contractId: input.contractId,
        type: input.type,
        tradeMode: input.tradeMode,
        asset: input.asset,
        timeframe: input.timeframe,
        entryPrice: input.entryPrice,
        stake: input.stake,
        result: 'PENDING',
        expiryTime: input.expiryTime,

        // CFD-specific
        multiplier: input.multiplier,
        takeProfit: input.takeProfit,
        stopLoss: input.stopLoss,
        takeProfitAmount: input.takeProfitAmount,
        stopLossAmount: input.stopLossAmount,

        // Signal context
        signalType: input.signalType,
        confidence: input.confidence,

        // Indicators
        rsi: input.rsi,
        bbUpper: input.bbUpper,
        bbMiddle: input.bbMiddle,
        bbLower: input.bbLower,
        atr: input.atr,

        // Additional context
        bbDistancePct: input.bbDistancePct,
        priceVsMiddle: input.priceVsMiddle,

        // Balance tracking
        balanceBefore: input.balanceBefore,

        // Metadata
        metadata: input.metadata,

        strategyName: input.strategyName,
      },
    });

    // Update daily stats (pending trade)
    await this.updateDailyStatsForTrade(trade.openedAt);

    // Emit event
    this.emit('trade:opened', trade);

    console.log(`[StateManager] ✅ Trade ${input.contractId} recorded`);
  }

  /**
   * Update an existing trade (when it closes)
   */
  async updateTrade(contractId: string, update: TradeUpdate): Promise<void> {
    console.log(`[StateManager] Updating trade ${contractId}`);

    // Calculate profit if result is known
    const profit = update.result && update.payout !== undefined
      ? update.result === 'WIN'
        ? update.payout
        : -update.payout
      : undefined;

    const trade = await this.prisma.trade.update({
      where: { contractId },
      data: {
        exitPrice: update.exitPrice,
        payout: update.payout,
        result: update.result,
        profit,
        closedAt: update.closedAt || new Date(),
        ...(update.metadata && { metadata: update.metadata }),
      },
    });

    // Recalculate daily stats
    await this.updateDailyStatsForTrade(trade.openedAt);

    // Emit event
    this.emit('trade:closed', trade);

    console.log(`[StateManager] ✅ Trade ${contractId} updated (${update.result})`);
  }

  /**
   * Get daily stats for a specific date
   */
  async getDailyStats(date?: string): Promise<DailyStatsResult> {
    const targetDate = date || this.getTodayDate();

    // Ensure stats exist
    await this.ensureDailyStats(targetDate);

    const stats = await this.prisma.dailyStats.findUnique({
      where: { date: targetDate },
    });

    if (!stats) {
      throw new Error(`Stats not found for date: ${targetDate}`);
    }

    return {
      date: stats.date,
      totalTrades: stats.totalTrades,
      wins: stats.wins,
      losses: stats.losses,
      pending: stats.pending,
      winRate: stats.winRate,
      totalStake: stats.totalStake,
      totalPayout: stats.totalPayout,
      netPnL: stats.netPnL,
      startBalance: stats.startBalance ?? undefined,
      endBalance: stats.endBalance ?? undefined,
    };
  }

  /**
   * Get daily stats grouped by strategy
   */
  async getStatsByStrategy(date?: string): Promise<{
    date: string;
    total: DailyStatsResult;
    byStrategy: Record<string, DailyStatsResult>;
  }> {
    const targetDate = date || this.getTodayDate();

    // Get date boundaries
    const startOfDay = new Date(targetDate + 'T00:00:00.000Z');
    const endOfDay = new Date(targetDate + 'T23:59:59.999Z');

    // Get all trades for this day
    const trades = await this.prisma.trade.findMany({
      where: {
        openedAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // Group trades by strategy
    const strategiesMap = new Map<string, Trade[]>();
    for (const trade of trades) {
      const strategy = trade.strategyName || 'UNKNOWN';
      if (!strategiesMap.has(strategy)) {
        strategiesMap.set(strategy, []);
      }
      strategiesMap.get(strategy)!.push(trade);
    }

    // Calculate stats per strategy
    const byStrategy: Record<string, DailyStatsResult> = {};

    for (const [strategy, strategyTrades] of strategiesMap) {
      const totalTrades = strategyTrades.length;
      const wins = strategyTrades.filter((t: Trade) => t.result === 'WIN').length;
      const losses = strategyTrades.filter((t: Trade) => t.result === 'LOSS').length;
      const pending = strategyTrades.filter((t: Trade) => t.result === 'PENDING').length;
      const completedTrades = wins + losses;
      const winRate = completedTrades > 0 ? (wins / completedTrades) * 100 : 0;

      const totalStake = strategyTrades.reduce((sum: number, t: Trade) => sum + t.stake, 0);
      const totalPayout = strategyTrades.reduce((sum: number, t: Trade) => sum + (t.payout || 0), 0);
      const netPnL = strategyTrades.reduce((sum: number, t: Trade) => sum + (t.profit || 0), 0);

      byStrategy[strategy] = {
        date: targetDate,
        totalTrades,
        wins,
        losses,
        pending,
        winRate,
        totalStake,
        totalPayout,
        netPnL,
      };
    }

    // Calculate total stats
    const totalTrades = trades.length;
    const wins = trades.filter((t: Trade) => t.result === 'WIN').length;
    const losses = trades.filter((t: Trade) => t.result === 'LOSS').length;
    const pending = trades.filter((t: Trade) => t.result === 'PENDING').length;
    const completedTrades = wins + losses;
    const winRate = completedTrades > 0 ? (wins / completedTrades) * 100 : 0;

    const totalStake = trades.reduce((sum: number, t: Trade) => sum + t.stake, 0);
    const totalPayout = trades.reduce((sum: number, t: Trade) => sum + (t.payout || 0), 0);
    const netPnL = trades.reduce((sum: number, t: Trade) => sum + (t.profit || 0), 0);

    return {
      date: targetDate,
      total: {
        date: targetDate,
        totalTrades,
        wins,
        losses,
        pending,
        winRate,
        totalStake,
        totalPayout,
        netPnL,
      },
      byStrategy,
    };
  }

  /**
   * Get stats grouped by strategy and optionally by asset
   * Supports multiple time periods: daily, weekly, monthly, total
   */
  async getStatsGrouped(params: {
    period: 'daily' | 'weekly' | 'monthly' | 'total';
    date?: string; // For daily, weekly, monthly - defaults to today
    groupByAsset?: boolean; // If true, also groups by asset within each strategy
  }): Promise<{
    period: string;
    periodLabel: string;
    dateRange: { start: string; end: string };
    total: DailyStatsResult;
    byStrategy: Record<string, DailyStatsResult & { byAsset?: Record<string, DailyStatsResult> }>;
  }> {
    const targetDate = params.date || this.getTodayDate();

    // Calculate date range based on period
    let startDate: Date;
    let endDate: Date;
    let periodLabel: string;

    if (params.period === 'total') {
      // Get first trade ever
      const firstTrade = await this.prisma.trade.findFirst({
        orderBy: { openedAt: 'asc' },
      });
      startDate = firstTrade ? firstTrade.openedAt : new Date();
      endDate = new Date();
      periodLabel = 'All Time';
    } else if (params.period === 'weekly') {
      const refDate = new Date(targetDate);
      const dayOfWeek = refDate.getUTCDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
      startDate = new Date(refDate);
      startDate.setUTCDate(refDate.getUTCDate() - diff);
      startDate.setUTCHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setUTCDate(startDate.getUTCDate() + 6);
      endDate.setUTCHours(23, 59, 59, 999);
      periodLabel = `Week of ${this.formatDate(startDate)}`;
    } else if (params.period === 'monthly') {
      const refDate = new Date(targetDate);
      startDate = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      periodLabel = `${monthNames[refDate.getUTCMonth()]} ${refDate.getUTCFullYear()}`;
    } else {
      // daily
      startDate = new Date(targetDate + 'T00:00:00.000Z');
      endDate = new Date(targetDate + 'T23:59:59.999Z');
      periodLabel = targetDate;
    }

    // Get all trades in the period
    const trades = await this.prisma.trade.findMany({
      where: {
        openedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Group trades by strategy (and optionally by asset)
    const strategiesMap = new Map<string, Map<string, Trade[]>>();

    for (const trade of trades) {
      const strategy = trade.strategyName || 'UNKNOWN';
      const asset = trade.asset || 'UNKNOWN';

      if (!strategiesMap.has(strategy)) {
        strategiesMap.set(strategy, new Map());
      }

      const assetsMap = strategiesMap.get(strategy)!;
      if (!assetsMap.has(asset)) {
        assetsMap.set(asset, []);
      }
      assetsMap.get(asset)!.push(trade);
    }

    // Calculate stats per strategy
    const byStrategy: Record<string, DailyStatsResult & { byAsset?: Record<string, DailyStatsResult> }> = {};

    for (const [strategy, assetsMap] of strategiesMap) {
      // Aggregate all trades for this strategy
      const allStrategyTrades: Trade[] = [];
      for (const assetTrades of assetsMap.values()) {
        allStrategyTrades.push(...assetTrades);
      }

      const totalTrades = allStrategyTrades.length;
      const wins = allStrategyTrades.filter((t: Trade) => t.result === 'WIN').length;
      const losses = allStrategyTrades.filter((t: Trade) => t.result === 'LOSS').length;
      const pending = allStrategyTrades.filter((t: Trade) => t.result === 'PENDING').length;
      const completedTrades = wins + losses;
      const winRate = completedTrades > 0 ? (wins / completedTrades) * 100 : 0;

      const totalStake = allStrategyTrades.reduce((sum: number, t: Trade) => sum + t.stake, 0);
      const totalPayout = allStrategyTrades.reduce((sum: number, t: Trade) => sum + (t.payout || 0), 0);
      const netPnL = allStrategyTrades.reduce((sum: number, t: Trade) => sum + (t.profit || 0), 0);

      byStrategy[strategy] = {
        date: periodLabel,
        totalTrades,
        wins,
        losses,
        pending,
        winRate,
        totalStake,
        totalPayout,
        netPnL,
      };

      // If groupByAsset is true, also calculate per-asset stats
      if (params.groupByAsset) {
        const byAsset: Record<string, DailyStatsResult> = {};

        for (const [asset, assetTrades] of assetsMap) {
          const assetTotalTrades = assetTrades.length;
          const assetWins = assetTrades.filter((t: Trade) => t.result === 'WIN').length;
          const assetLosses = assetTrades.filter((t: Trade) => t.result === 'LOSS').length;
          const assetPending = assetTrades.filter((t: Trade) => t.result === 'PENDING').length;
          const assetCompletedTrades = assetWins + assetLosses;
          const assetWinRate = assetCompletedTrades > 0 ? (assetWins / assetCompletedTrades) * 100 : 0;

          const assetTotalStake = assetTrades.reduce((sum: number, t: Trade) => sum + t.stake, 0);
          const assetTotalPayout = assetTrades.reduce((sum: number, t: Trade) => sum + (t.payout || 0), 0);
          const assetNetPnL = assetTrades.reduce((sum: number, t: Trade) => sum + (t.profit || 0), 0);

          byAsset[asset] = {
            date: periodLabel,
            totalTrades: assetTotalTrades,
            wins: assetWins,
            losses: assetLosses,
            pending: assetPending,
            winRate: assetWinRate,
            totalStake: assetTotalStake,
            totalPayout: assetTotalPayout,
            netPnL: assetNetPnL,
          };
        }

        byStrategy[strategy].byAsset = byAsset;
      }
    }

    // Calculate total stats
    const totalTrades = trades.length;
    const wins = trades.filter((t: Trade) => t.result === 'WIN').length;
    const losses = trades.filter((t: Trade) => t.result === 'LOSS').length;
    const pending = trades.filter((t: Trade) => t.result === 'PENDING').length;
    const completedTrades = wins + losses;
    const winRate = completedTrades > 0 ? (wins / completedTrades) * 100 : 0;

    const totalStake = trades.reduce((sum: number, t: Trade) => sum + t.stake, 0);
    const totalPayout = trades.reduce((sum: number, t: Trade) => sum + (t.payout || 0), 0);
    const netPnL = trades.reduce((sum: number, t: Trade) => sum + (t.profit || 0), 0);

    return {
      period: params.period,
      periodLabel,
      dateRange: {
        start: this.formatDate(startDate),
        end: this.formatDate(endDate),
      },
      total: {
        date: periodLabel,
        totalTrades,
        wins,
        losses,
        pending,
        winRate,
        totalStake,
        totalPayout,
        netPnL,
      },
      byStrategy,
    };
  }

  /**
   * Get trades with filters
   */
  async getTrades(params: {
    limit?: number;
    asset?: string;
    strategy?: string;
    result?: string;
    from?: Date;
    to?: Date;
  }): Promise<any[]> {
    const where: any = {};

    if (params.asset) where.asset = params.asset;
    if (params.strategy) where.strategyName = params.strategy;
    if (params.result) where.result = params.result;

    if (params.from || params.to) {
      where.openedAt = {};
      if (params.from) where.openedAt.gte = params.from;
      if (params.to) where.openedAt.lte = params.to;
    }

    return this.prisma.trade.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      take: params.limit || 100,
    });
  }

  /**
   * Get open trades (not closed yet)
   * Returns trades where closedAt is null
   */
  async getOpenTrades(): Promise<Trade[]> {
    return this.prisma.trade.findMany({
      where: {
        closedAt: null,
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  /**
   * Ensure daily stats record exists for a date
   */
  private async ensureDailyStats(date: string): Promise<void> {
    const existing = await this.prisma.dailyStats.findUnique({
      where: { date },
    });

    if (!existing) {
      await this.prisma.dailyStats.create({
        data: { date },
      });
    }
  }

  /**
   * Update daily stats based on trades
   */
  private async updateDailyStatsForTrade(tradeDate: Date): Promise<void> {
    const date = this.formatDate(tradeDate);

    // Get all trades for this day
    const startOfDay = new Date(tradeDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(tradeDate);
    endOfDay.setHours(23, 59, 59, 999);

    const trades = await this.prisma.trade.findMany({
      where: {
        openedAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // Calculate stats
    const totalTrades = trades.length;
    const wins = trades.filter((t: Trade) => t.result === 'WIN').length;
    const losses = trades.filter((t: Trade) => t.result === 'LOSS').length;
    const pending = trades.filter((t: Trade) => t.result === 'PENDING').length;
    const completedTrades = wins + losses;
    const winRate = completedTrades > 0 ? (wins / completedTrades) * 100 : 0;

    const totalStake = trades.reduce((sum: number, t: Trade) => sum + t.stake, 0);
    const totalPayout = trades.reduce((sum: number, t: Trade) => sum + (t.payout || 0), 0);
    const netPnL = trades.reduce((sum: number, t: Trade) => sum + (t.profit || 0), 0);

    // Ensure stats record exists, then update
    await this.ensureDailyStats(date);

    // Update stats record
    await this.prisma.dailyStats.update({
      where: { date },
      data: {
        totalTrades,
        wins,
        losses,
        pending,
        winRate,
        totalStake,
        totalPayout,
        netPnL,
      },
    });
  }

  /**
   * Get today's date in YYYY-MM-DD format
   */
  private getTodayDate(): string {
    return this.formatDate(new Date());
  }

  /**
   * Format date to YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const formatted = date.toISOString().split('T')[0];
    if (!formatted) {
      throw new Error('Failed to format date');
    }
    return formatted;
  }

  /**
   * Shutdown state manager
   */
  async shutdown(): Promise<void> {
    console.log('[StateManager] Shutting down...');
    await this.prisma.$disconnect();
    this.initialized = false;
    console.log('[StateManager] ✅ Shutdown complete');
  }
}
