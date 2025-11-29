/**
 * Message Formatters for Telegram
 *
 * Format data from Gateway into readable Telegram messages
 * Uses Markdown formatting for better readability
 */

/**
 * Format balance response
 */
export function formatBalance(balance: { amount: number; currency: string }): string {
  const emoji = balance.amount >= 0 ? '💰' : '📉';
  return (
    `${emoji} *Balance*\n\n` +
    `Amount: \`${balance.amount.toFixed(2)} ${balance.currency}\``
  );
}

/**
 * Format portfolio/open positions
 */
export function formatStatus(portfolio: {
  positions: any[];
  count: number;
  totalProfit: number;
}): string {
  if (portfolio.count === 0) {
    return `📊 *Open Positions*\n\nNo open positions`;
  }

  const profitEmoji = portfolio.totalProfit >= 0 ? '🟢' : '🔴';
  const profitSign = portfolio.totalProfit >= 0 ? '+' : '';

  let message =
    `📊 *Open Positions* (${portfolio.count})\n\n` +
    `Total P/L: ${profitEmoji} \`${profitSign}${portfolio.totalProfit.toFixed(2)}\`\n\n`;

  // List each position (limit to 10 to avoid message size issues)
  const displayPositions = portfolio.positions.slice(0, 10);
  for (const pos of displayPositions) {
    const posProfit = pos.profit || pos.pnl || 0;
    const posEmoji = posProfit >= 0 ? '🟢' : '🔴';
    const symbol = pos.symbol || pos.asset || 'Unknown';
    const direction = pos.direction || pos.contract_type || '';

    message += `${posEmoji} \`${symbol}\` ${direction} | P/L: \`${posProfit.toFixed(2)}\`\n`;
  }

  if (portfolio.positions.length > 10) {
    message += `\n_...and ${portfolio.positions.length - 10} more_`;
  }

  return message;
}

/**
 * Format profit table (closed trades)
 */
export function formatProfit(profitTable: {
  contracts: any[];
  count: number;
  totalProfit: number;
  wins: number;
  losses: number;
  winRate: number;
}): string {
  const profitEmoji = profitTable.totalProfit >= 0 ? '📈' : '📉';
  const profitSign = profitTable.totalProfit >= 0 ? '+' : '';

  let message =
    `${profitEmoji} *Last 24h Performance*\n\n` +
    `Trades: \`${profitTable.count}\`\n` +
    `Wins: \`${profitTable.wins}\` | Losses: \`${profitTable.losses}\`\n` +
    `Win Rate: \`${profitTable.winRate.toFixed(1)}%\`\n` +
    `Net P/L: \`${profitSign}${profitTable.totalProfit.toFixed(2)}\``;

  // Show recent trades if available
  if (profitTable.contracts && profitTable.contracts.length > 0) {
    message += `\n\n*Recent Trades:*\n`;
    const recentTrades = profitTable.contracts.slice(0, 5);
    for (const trade of recentTrades) {
      const result = trade.profit > 0 ? '✅' : '❌';
      const symbol = trade.symbol || trade.underlying || 'Unknown';
      const profit = trade.profit || trade.sell_price - trade.buy_price || 0;
      const profitStr = profit >= 0 ? `+${profit.toFixed(2)}` : profit.toFixed(2);
      message += `${result} \`${symbol}\` | \`${profitStr}\`\n`;
    }
  }

  return message;
}

/**
 * Format daily statistics - supports both old format and new by-strategy format
 */
export function formatStats(statsResponse: {
  // New format with byStrategy
  date?: string;
  total?: {
    date: string;
    totalTrades: number;
    wins: number;
    losses: number;
    pending: number;
    winRate: number;
    totalStake: number;
    totalPayout: number;
    netPnL: number;
  };
  byStrategy?: Record<string, {
    date: string;
    totalTrades: number;
    wins: number;
    losses: number;
    pending: number;
    winRate: number;
    totalStake: number;
    totalPayout: number;
    netPnL: number;
  }>;
  // Old format (backwards compatibility)
  stats?: {
    date: string;
    totalTrades: number;
    wins: number;
    losses: number;
    pending: number;
    winRate: number;
    totalStake: number;
    totalPayout: number;
    netPnL: number;
  };
}): string {
  // Handle new format with byStrategy
  if (statsResponse.total && statsResponse.byStrategy) {
    const total = statsResponse.total;
    const byStrategy = statsResponse.byStrategy;
    const date = statsResponse.date || total.date;

    const pnlEmoji = total.netPnL >= 0 ? '🟢' : '🔴';
    const pnlSign = total.netPnL >= 0 ? '+' : '';

    let message = `📊 *Daily Statistics*\n` +
      `Date: \`${date}\`\n\n`;

    // Per-strategy breakdown
    const strategies = Object.keys(byStrategy);
    if (strategies.length > 0) {
      message += `*By Strategy:*\n`;

      for (const strategyName of strategies) {
        const s = byStrategy[strategyName];
        if (!s) continue;

        const sPnlEmoji = s.netPnL >= 0 ? '🟢' : '🔴';
        const sPnlSign = s.netPnL >= 0 ? '+' : '';

        message += `\n🎯 *${strategyName}*\n`;
        message += `├ Trades: \`${s.totalTrades}\` (W:${s.wins}/L:${s.losses})\n`;
        message += `├ Win Rate: \`${s.winRate.toFixed(1)}%\`\n`;
        message += `├ Staked: \`$${s.totalStake.toFixed(2)}\`\n`;
        message += `└ P/L: ${sPnlEmoji} \`${sPnlSign}${s.netPnL.toFixed(2)}\`\n`;
      }

      message += `\n`;
    }

    // Total summary
    message += `*Total:*\n`;
    message += `├ Trades: \`${total.totalTrades}\` (W:${total.wins}/L:${total.losses})\n`;
    message += `├ Pending: \`${total.pending}\`\n`;
    message += `├ Win Rate: \`${total.winRate.toFixed(1)}%\`\n`;
    message += `├ Staked: \`$${total.totalStake.toFixed(2)}\`\n`;
    message += `├ Payout: \`$${total.totalPayout.toFixed(2)}\`\n`;
    message += `└ Net P/L: ${pnlEmoji} \`${pnlSign}${total.netPnL.toFixed(2)}\``;

    return message;
  }

  // Handle old format (backwards compatibility)
  if (statsResponse.stats) {
    const stats = statsResponse.stats;
    const pnlEmoji = stats.netPnL >= 0 ? '🟢' : '🔴';
    const pnlSign = stats.netPnL >= 0 ? '+' : '';

    return (
      `📊 *Daily Statistics*\n` +
      `Date: \`${stats.date}\`\n\n` +
      `*Trades:*\n` +
      `├ Total: \`${stats.totalTrades}\`\n` +
      `├ Wins: \`${stats.wins}\`\n` +
      `├ Losses: \`${stats.losses}\`\n` +
      `├ Pending: \`${stats.pending}\`\n` +
      `└ Win Rate: \`${stats.winRate.toFixed(1)}%\`\n\n` +
      `*Financials:*\n` +
      `├ Staked: \`${stats.totalStake.toFixed(2)}\`\n` +
      `├ Payout: \`${stats.totalPayout.toFixed(2)}\`\n` +
      `└ Net P/L: ${pnlEmoji} \`${pnlSign}${stats.netPnL.toFixed(2)}\``
    );
  }

  return `📊 *Daily Statistics*\n\n_No data available_`;
}

/**
 * Format trade notification (opened or closed)
 */
export function formatTrade(
  trade: {
    id?: string;
    asset?: string;
    symbol?: string;
    direction?: string;
    contract_type?: string;
    amount?: number;
    stake?: number;
    duration?: number;
    openPrice?: number;
    entry_price?: number;
    closePrice?: number;
    exit_price?: number;
    result?: 'won' | 'lost';
    profit?: number;
    timestamp?: number;
    multiplier?: number;
    takeProfit?: number;
    stopLoss?: number;
  },
  action: 'opened' | 'closed'
): string {
  const symbol = trade.asset || trade.symbol || 'Unknown';
  const direction = trade.direction || trade.contract_type || '';
  // For CFDs, prefer stake over amount (amount is the nominal value)
  const stake = trade.stake || trade.amount || 0;

  if (action === 'opened') {
    const price = trade.openPrice || trade.entry_price || 0;
    // Handle both binary (CALL/PUT) and CFD (BUY/SELL) directions
    const dirUpper = direction.toUpperCase();
    const isLong = dirUpper.includes('CALL') || dirUpper.includes('BUY') || dirUpper === 'RISE';
    const dirEmoji = isLong ? '🟢' : '🔴';

    // Build message with optional CFD-specific fields
    let message = (
      `${dirEmoji} *Trade Opened*\n\n` +
      `Symbol: \`${symbol}\`\n` +
      `Direction: \`${direction}\`\n` +
      `Stake: \`$${stake.toFixed(2)}\`\n` +
      `Entry: \`${price.toFixed(5)}\`\n`
    );

    // Add multiplier for CFD trades
    if (trade.multiplier) {
      message += `Multiplier: \`x${trade.multiplier}\`\n`;
    }

    // Add TP/SL for CFD trades
    if (trade.takeProfit) {
      message += `TP: \`${trade.takeProfit.toFixed(2)}\`\n`;
    }
    if (trade.stopLoss) {
      message += `SL: \`${trade.stopLoss.toFixed(2)}\`\n`;
    }

    // Add duration for binary options
    if (trade.duration) {
      message += `Duration: \`${trade.duration}s\`\n`;
    }

    message += `Time: \`${new Date(trade.timestamp || Date.now()).toLocaleTimeString()}\``;

    return message;
  } else {
    // Trade closed
    const result = trade.result;
    const profit = trade.profit || 0;
    const exitPrice = trade.closePrice || trade.exit_price || 0;
    const resultEmoji = result === 'won' ? '✅' : '❌';
    const profitSign = profit >= 0 ? '+' : '';

    return (
      `${resultEmoji} *Trade Closed*\n\n` +
      `Symbol: \`${symbol}\`\n` +
      `Result: \`${result?.toUpperCase() || 'UNKNOWN'}\`\n` +
      `P/L: \`${profitSign}${profit.toFixed(2)}\`\n` +
      `Exit: \`${exitPrice.toFixed(5)}\`\n` +
      `Time: \`${new Date(trade.timestamp || Date.now()).toLocaleTimeString()}\``
    );
  }
}

/**
 * Format error message
 */
export function formatError(error: string): string {
  return `⚠️ *Error*\n\n\`${error}\``;
}

/**
 * Format assets list
 */
export function formatAssets(assets: string[]): string {
  if (assets.length === 0) {
    return `📋 *Monitored Assets*\n\nNo assets being monitored`;
  }

  return (
    `📋 *Monitored Assets* (${assets.length})\n\n` +
    assets.map((a) => `• \`${a}\``).join('\n')
  );
}

/**
 * Format bot info (strategies, uptime, status)
 */
export function formatBotInfo(info: {
  traders: Array<{
    id: string;
    name: string;
    strategy: string;
    symbols: string[];
    uptime: number;
    uptimeFormatted: string;
    isActive: boolean;
  }>;
  system: {
    connectedTraders: number;
    activeStrategies: string[];
    gatewayUptime: number;
    gatewayUptimeFormatted: string;
  };
  todayStats: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnL: number;
  } | null;
}): string {
  let message = `🤖 *Bot Information*\n\n`;

  // Active traders - group by strategy to avoid duplicates
  let uniqueTraders: typeof info.traders = [];
  if (info.traders.length > 0) {
    // Group traders by strategy+symbols to show only the most recent one
    const tradersByStrategy = new Map<string, typeof info.traders[0]>();
    for (const trader of info.traders) {
      const key = `${trader.strategy}-${trader.symbols.sort().join(',')}`;
      const existing = tradersByStrategy.get(key);
      // Keep the one with longer uptime (most likely the active one)
      if (!existing || trader.uptime > existing.uptime) {
        tradersByStrategy.set(key, trader);
      }
    }
    
    // Show only unique strategies (most recent instance)
    uniqueTraders = Array.from(tradersByStrategy.values());
  }

  // System info
  message += `*System:*\n`;
  message += `├ Gateway Uptime: \`${info.system.gatewayUptimeFormatted}\`\n`;
  message += `└ Connected Traders: \`${uniqueTraders.length}\`\n\n`;

  // Active traders
  if (uniqueTraders.length > 0) {
    message += `*Active Traders:*\n`;
    for (const trader of uniqueTraders) {
      const statusEmoji = trader.isActive ? '🟢' : '🔴';
      message += `${statusEmoji} *${trader.name}*\n`;
      message += `├ Strategy: \`${trader.strategy}\`\n`;
      message += `├ Symbols: \`${trader.symbols.join(', ')}\`\n`;
      message += `└ Uptime: \`${trader.uptimeFormatted}\`\n\n`;
    }
  } else {
    // Show strategies from trades if no traders registered
    if (info.system.activeStrategies.length > 0) {
      message += `*Strategies (from trades):*\n`;
      for (const strategy of info.system.activeStrategies) {
        message += `• \`${strategy}\`\n`;
      }
      message += '\n';
    } else {
      message += `_No active traders connected_\n\n`;
    }
  }

  // Today's stats summary
  if (info.todayStats) {
    const pnlEmoji = info.todayStats.netPnL >= 0 ? '🟢' : '🔴';
    const pnlSign = info.todayStats.netPnL >= 0 ? '+' : '';
    message += `*Today's Summary:*\n`;
    message += `├ Trades: \`${info.todayStats.totalTrades}\` (W:${info.todayStats.wins}/L:${info.todayStats.losses})\n`;
    message += `├ Win Rate: \`${info.todayStats.winRate.toFixed(1)}%\`\n`;
    message += `└ P/L: ${pnlEmoji} \`${pnlSign}${info.todayStats.netPnL.toFixed(2)}\``;
  }

  return message;
}

/**
 * Format signal proximities - grouped by strategy
 */
export function formatSignalProximities(data: {
  proximities: Array<{
    strategy?: string;
    asset: string;
    direction: 'call' | 'put' | 'neutral';
    proximity: number;
    criteria?: Array<{
      name: string;
      current: number;
      target: number;
      unit: string;
      passed: boolean;
      distance: number;
    }>;
    readyToSignal: boolean;
    missingCriteria?: string[];
    ageFormatted: string;
  }>;
  count: number;
}): string {
  if (data.count === 0) {
    return `📡 *Signal Proximities*\n\n_No active signal data available_\n\n_Proximities are updated every 10 seconds when the trader is running._`;
  }

  // Group proximities by strategy
  const byStrategy = new Map<string, typeof data.proximities>();
  for (const prox of data.proximities) {
    const strategyName = prox.strategy || 'unknown';
    if (!byStrategy.has(strategyName)) {
      byStrategy.set(strategyName, []);
    }
    byStrategy.get(strategyName)!.push(prox);
  }

  let message = `📡 *Signal Proximities*\n`;

  // Format each strategy group
  for (const [strategy, proximities] of byStrategy) {
    message += `\n🎯 *${strategy}*\n`;

    for (const prox of proximities) {
      // Direction emoji
      const dirEmoji = prox.direction === 'call' ? '🟢' :
                       prox.direction === 'put' ? '🔴' : '⚪';

      // Proximity bar (0-100%) - proximity is already in 0-100 range
      const pct = Math.min(100, Math.max(0, prox.proximity));
      const filledBlocks = Math.round(pct / 10);
      const emptyBlocks = 10 - filledBlocks;
      const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

      // Ready indicator
      const readyEmoji = prox.readyToSignal ? '✅' : '⏳';

      message += `${dirEmoji} *${prox.asset}*\n`;
      message += `├ Direction: \`${prox.direction.toUpperCase()}\`\n`;
      message += `├ Proximity: \`${bar}\` ${pct.toFixed(0)}%\n`;
      message += `├ Ready: ${readyEmoji}\n`;

      // Show criteria if available
      if (prox.criteria && prox.criteria.length > 0) {
        message += `├ *Criteria:*\n`;
        for (const c of prox.criteria) {
          const checkEmoji = c.passed ? '✅' : '❌';
          message += `│  ${checkEmoji} ${c.name}: \`${c.current.toFixed(2)}\`/\`${c.target.toFixed(2)}\`\n`;
        }
      }

      // Show missing criteria if not ready
      if (!prox.readyToSignal && prox.missingCriteria && prox.missingCriteria.length > 0) {
        message += `├ Missing: \`${prox.missingCriteria.join(', ')}\`\n`;
      }

      message += `└ Updated: \`${prox.ageFormatted} ago\`\n\n`;
    }
  }

  return message;
}

/**
 * Format server status
 */
export function formatServerStatus(status: {
  cpu: {
    count: number;
    usage: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePct: number;
    totalFormatted: string;
    usedFormatted: string;
    freeFormatted: string;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    usagePct: number;
    totalFormatted: string;
    usedFormatted: string;
    availableFormatted: string;
  };
  system: {
    platform: string;
    hostname: string;
    uptime: number;
    uptimeFormatted: string;
    loadAvg: number[];
  };
  processes: Array<{
    name: string;
    status: string;
    cpu: number;
    memory: number;
    memoryFormatted: string;
    uptime: number;
    uptimeFormatted: string;
    restarts: number;
  }>;
}): string {
  // Memory emoji based on usage
  const memEmoji = status.memory.usagePct > 80 ? '🔴' : status.memory.usagePct > 60 ? '🟡' : '🟢';
  // Disk emoji based on usage
  const diskEmoji = status.disk.usagePct > 80 ? '🔴' : status.disk.usagePct > 60 ? '🟡' : '🟢';

  let message = `🖥️ *Server Status*\n\n`;

  // System info
  message += `*System:*\n`;
  message += `├ Host: \`${status.system.hostname}\`\n`;
  message += `├ Platform: \`${status.system.platform}\`\n`;
  message += `├ Uptime: \`${status.system.uptimeFormatted}\`\n`;
  message += `└ Load: \`${status.system.loadAvg.join(', ')}\`\n\n`;

  // CPU
  message += `*CPU:* \`${status.cpu.usage.toFixed(1)}%\` (${status.cpu.count} cores)\n\n`;

  // Memory
  message += `*Memory:* ${memEmoji}\n`;
  message += `├ Used: \`${status.memory.usedFormatted}\` / \`${status.memory.totalFormatted}\`\n`;
  message += `└ Usage: \`${status.memory.usagePct.toFixed(1)}%\`\n\n`;

  // Disk
  message += `*Disk:* ${diskEmoji}\n`;
  message += `├ Used: \`${status.disk.usedFormatted}\` / \`${status.disk.totalFormatted}\`\n`;
  message += `└ Usage: \`${status.disk.usagePct}%\`\n\n`;

  // PM2 Processes
  if (status.processes.length > 0) {
    message += `*PM2 Processes:*\n`;
    for (const proc of status.processes) {
      const statusEmoji = proc.status === 'online' ? '🟢' : '🔴';
      message += `${statusEmoji} *${proc.name}*\n`;
      message += `├ Memory: \`${proc.memoryFormatted}\`\n`;
      message += `├ Uptime: \`${proc.uptimeFormatted}\`\n`;
      message += `└ Restarts: \`${proc.restarts}\`\n\n`;
    }
  }

  return message;
}

/**
 * Format logs for Telegram (max 4096 chars)
 */
export function formatLogs(data: {
  logs: Array<{
    service: string;
    type: string;
    content: string;
  }>;
  service: string;
  lines: number;
}): string {
  if (data.logs.length === 0) {
    return `📋 *Logs*\n\n_No logs available_`;
  }

  // Telegram max message is 4096 chars, leave room for header
  const MAX_TOTAL_LENGTH = 3800;
  const MAX_PER_LOG = 1500;

  let message = `📋 *Logs* (${data.service})\n\n`;

  for (const log of data.logs) {
    // Check if we're approaching the limit
    if (message.length > MAX_TOTAL_LENGTH) {
      message += `\n_...more logs truncated_`;
      break;
    }

    const typeEmoji = log.type === 'error' ? '❌' : '📄';
    let content = log.content || '';

    // Take only last N lines and limit total chars
    const lines = content.split('\n').filter(l => l.trim()).slice(-15);
    content = lines.join('\n');

    if (content.length > MAX_PER_LOG) {
      content = '...' + content.slice(-MAX_PER_LOG);
    }

    // Skip if empty
    if (!content.trim()) continue;

    const logBlock = `${typeEmoji} *${log.service}* (${log.type}):\n\`\`\`\n${content}\n\`\`\`\n\n`;

    // Check if adding this would exceed limit
    if (message.length + logBlock.length > MAX_TOTAL_LENGTH) {
      message += `\n_...truncated (message too long)_`;
      break;
    }

    message += logBlock;
  }

  return message;
}
