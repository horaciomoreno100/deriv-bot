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
 * Format daily statistics
 */
export function formatStats(statsResponse: {
  stats: {
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

  // System info
  message += `*System:*\n`;
  message += `├ Gateway Uptime: \`${info.system.gatewayUptimeFormatted}\`\n`;
  message += `└ Connected Traders: \`${info.system.connectedTraders}\`\n\n`;

  // Active traders
  if (info.traders.length > 0) {
    message += `*Active Traders:*\n`;
    for (const trader of info.traders) {
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
 * Format signal proximities
 */
export function formatSignalProximities(data: {
  proximities: Array<{
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

  let message = `📡 *Signal Proximities*\n\n`;

  for (const prox of data.proximities) {
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

  return message;
}
