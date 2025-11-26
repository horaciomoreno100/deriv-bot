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
  },
  action: 'opened' | 'closed'
): string {
  const symbol = trade.asset || trade.symbol || 'Unknown';
  const direction = trade.direction || trade.contract_type || '';
  const amount = trade.amount || trade.stake || 0;

  if (action === 'opened') {
    const price = trade.openPrice || trade.entry_price || 0;
    const dirEmoji = direction.toUpperCase().includes('CALL') ? '🟢' : '🔴';

    return (
      `${dirEmoji} *Trade Opened*\n\n` +
      `Symbol: \`${symbol}\`\n` +
      `Direction: \`${direction}\`\n` +
      `Stake: \`${amount.toFixed(2)}\`\n` +
      `Entry: \`${price.toFixed(5)}\`\n` +
      (trade.duration ? `Duration: \`${trade.duration}s\`\n` : '') +
      `Time: \`${new Date(trade.timestamp || Date.now()).toLocaleTimeString()}\``
    );
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
