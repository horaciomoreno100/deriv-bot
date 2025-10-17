/**
 * Interactive REPL for querying Trading System
 *
 * Connects to Gateway and provides interactive shell for:
 * - Viewing statistics
 * - Querying trades
 * - Checking balance
 * - Real-time monitoring
 */

import * as readline from 'readline/promises';
import { GatewayClient } from '@deriv-bot/trader';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

// Colored output helpers
const c = {
  success: (text: string) => `${colors.green}${text}${colors.reset}`,
  error: (text: string) => `${colors.red}${text}${colors.reset}`,
  info: (text: string) => `${colors.cyan}${text}${colors.reset}`,
  warning: (text: string) => `${colors.yellow}${text}${colors.reset}`,
  bold: (text: string) => `${colors.bold}${text}${colors.reset}`,
  dim: (text: string) => `${colors.dim}${text}${colors.reset}`,
  number: (text: string | number) => `${colors.magenta}${text}${colors.reset}`,
};

/**
 * Trading Bot REPL
 */
class TradingREPL {
  private client: GatewayClient;
  private rl: readline.Interface;

  constructor(gatewayUrl: string) {
    this.client = new GatewayClient({
      url: gatewayUrl,
      autoReconnect: true,
      enableLogging: false,
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: c.bold('deriv> '),
    });
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    console.log(c.bold('\n🤖 Trading Bot REPL'));
    console.log(c.dim('━'.repeat(50)));
    console.log(c.info('Connecting to Gateway...'));

    try {
      await this.client.connect();
      console.log(c.success('✅ Connected to Gateway\n'));

      this.showHelp();
      this.rl.prompt();

      // Handle user input
      this.rl.on('line', async (line: string) => {
        await this.handleCommand(line.trim());
        this.rl.prompt();
      });

      // Handle exit
      this.rl.on('close', async () => {
        console.log(c.info('\n\n👋 Disconnecting...'));
        await this.client.disconnect();
        process.exit(0);
      });
    } catch (error) {
      console.log(c.error(`\n❌ Failed to connect: ${error}`));
      process.exit(1);
    }
  }

  /**
   * Handle user command
   */
  private async handleCommand(line: string): Promise<void> {
    if (!line) return;

    const [cmd, ...args] = line.split(/\s+/);
    if (!cmd) return;

    try {
      switch (cmd.toLowerCase()) {
        case 'help':
        case 'h':
          this.showHelp();
          break;

        case 'stats':
        case 's':
          await this.showStats(args[0]);
          break;

        case 'trades':
        case 't':
          await this.showTrades(args[0] ? parseInt(args[0]) : 10);
          break;

        case 'balance':
        case 'b':
          await this.showBalance();
          break;

        case 'query':
        case 'q':
          await this.queryTrades(args);
          break;

        case 'wins':
        case 'w':
          await this.showWins(args[0] ? parseInt(args[0]) : 10);
          break;

        case 'losses':
        case 'l':
          await this.showLosses(args[0] ? parseInt(args[0]) : 10);
          break;

        case 'asset':
        case 'a':
          if (!args[0]) {
            console.log(c.error('Usage: asset <symbol>'));
            break;
          }
          await this.showAssetTrades(args[0], args[1] ? parseInt(args[1]) : 10);
          break;

        case 'clear':
        case 'cls':
          console.clear();
          break;

        case 'exit':
        case 'quit':
        case 'q':
          this.rl.close();
          break;

        default:
          console.log(c.error(`Unknown command: ${cmd}`));
          console.log(c.dim('Type "help" for available commands'));
      }
    } catch (error: any) {
      console.log(c.error(`Error: ${error.message}`));
    }
  }

  /**
   * Show help
   */
  private showHelp(): void {
    console.log(c.bold('\n📚 Available Commands:'));
    console.log(c.dim('━'.repeat(50)));
    console.log(`  ${c.info('stats [date]')}     Show daily statistics (default: today)`);
    console.log(`  ${c.info('trades [n]')}       Show last N trades (default: 10)`);
    console.log(`  ${c.info('balance')}          Show account balance`);
    console.log(`  ${c.info('wins [n]')}         Show last N winning trades`);
    console.log(`  ${c.info('losses [n]')}       Show last N losing trades`);
    console.log(`  ${c.info('asset <sym> [n]')}  Show trades for specific asset`);
    console.log(`  ${c.info('query ...')}        Advanced trade query`);
    console.log(`  ${c.info('clear')}            Clear screen`);
    console.log(`  ${c.info('help')}             Show this help`);
    console.log(`  ${c.info('exit')}             Exit REPL`);
    console.log(c.dim('━'.repeat(50)));
    console.log(c.dim('Aliases: s=stats, t=trades, b=balance, w=wins, l=losses, a=asset\n'));
  }

  /**
   * Show daily statistics
   */
  private async showStats(date?: string): Promise<void> {
    const result = await this.client.getStats(date);
    const stats = result.stats || result; // Handle both response formats

    console.log(c.bold(`\n📊 Statistics for ${stats.date || date || 'today'}`));
    console.log(c.dim('━'.repeat(50)));
    console.log(`  Total Trades:   ${c.number(stats.totalTrades ?? 0)}`);
    console.log(`  Wins:           ${c.success(stats.wins ?? 0)} ${c.dim(`(${(stats.winRate ?? 0).toFixed(2)}%)`)}`);
    console.log(`  Losses:         ${c.error(stats.losses ?? 0)}`);
    console.log(`  Pending:        ${c.warning(stats.pending ?? 0)}`);
    console.log(c.dim('  ─'.repeat(25)));
    console.log(`  Total Stake:    ${c.number('$' + (stats.totalStake ?? 0).toFixed(2))}`);
    console.log(`  Total Payout:   ${c.number('$' + (stats.totalPayout ?? 0).toFixed(2))}`);

    const netPnL = stats.netPnL ?? 0;
    const pnlColor = netPnL >= 0 ? c.success : c.error;
    const pnlSign = netPnL >= 0 ? '+' : '';
    console.log(`  Net P&L:        ${pnlColor(pnlSign + '$' + netPnL.toFixed(2))}`);

    if (stats.startBalance && stats.endBalance) {
      console.log(c.dim('  ─'.repeat(25)));
      console.log(`  Start Balance:  ${c.number('$' + stats.startBalance.toFixed(2))}`);
      console.log(`  End Balance:    ${c.number('$' + stats.endBalance.toFixed(2))}`);
    }
    console.log('');
  }

  /**
   * Show recent trades
   */
  private async showTrades(limit: number): Promise<void> {
    const trades = await this.client.getTrades({ limit });

    if (trades.length === 0) {
      console.log(c.warning('\n⚠️  No trades found\n'));
      return;
    }

    console.log(c.bold(`\n📈 Last ${trades.length} Trades`));
    console.log(c.dim('━'.repeat(50)));

    for (const trade of trades) {
      this.printTrade(trade);
    }
    console.log('');
  }

  /**
   * Show account balance
   */
  private async showBalance(): Promise<void> {
    const balance = await this.client.getBalance();

    console.log(c.bold('\n💰 Account Balance'));
    console.log(c.dim('━'.repeat(50)));
    console.log(`  Amount:      ${c.number('$' + balance.amount.toFixed(2))}`);
    console.log(`  Currency:    ${balance.currency}`);
    console.log(`  Type:        ${balance.accountType}`);
    console.log('');
  }

  /**
   * Show winning trades
   */
  private async showWins(limit: number): Promise<void> {
    const trades = await this.client.getTrades({ limit, result: 'WIN' });

    if (trades.length === 0) {
      console.log(c.warning('\n⚠️  No winning trades found\n'));
      return;
    }

    console.log(c.bold(`\n✅ Last ${trades.length} Winning Trades`));
    console.log(c.dim('━'.repeat(50)));

    for (const trade of trades) {
      this.printTrade(trade);
    }
    console.log('');
  }

  /**
   * Show losing trades
   */
  private async showLosses(limit: number): Promise<void> {
    const trades = await this.client.getTrades({ limit, result: 'LOSS' });

    if (trades.length === 0) {
      console.log(c.warning('\n⚠️  No losing trades found\n'));
      return;
    }

    console.log(c.bold(`\n❌ Last ${trades.length} Losing Trades`));
    console.log(c.dim('━'.repeat(50)));

    for (const trade of trades) {
      this.printTrade(trade);
    }
    console.log('');
  }

  /**
   * Show trades for specific asset
   */
  private async showAssetTrades(asset: string, limit: number): Promise<void> {
    const trades = await this.client.getTrades({ limit, asset });

    if (trades.length === 0) {
      console.log(c.warning(`\n⚠️  No trades found for ${asset}\n`));
      return;
    }

    console.log(c.bold(`\n📈 Last ${trades.length} Trades for ${asset}`));
    console.log(c.dim('━'.repeat(50)));

    for (const trade of trades) {
      this.printTrade(trade);
    }
    console.log('');
  }

  /**
   * Query trades with filters
   */
  private async queryTrades(args: string[]): Promise<void> {
    // Parse query arguments
    const filters: any = {};

    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];

      if (!key || !value) continue;

      switch (key.toLowerCase()) {
        case 'limit':
        case 'n':
          filters.limit = parseInt(value);
          break;
        case 'asset':
        case 'symbol':
          filters.asset = value;
          break;
        case 'strategy':
          filters.strategy = value;
          break;
        case 'result':
          filters.result = value.toUpperCase();
          break;
        case 'from':
          filters.from = value;
          break;
        case 'to':
          filters.to = value;
          break;
      }
    }

    const trades = await this.client.getTrades(filters);

    if (trades.length === 0) {
      console.log(c.warning('\n⚠️  No trades found matching query\n'));
      return;
    }

    console.log(c.bold(`\n🔍 Query Results: ${trades.length} trades`));
    console.log(c.dim('━'.repeat(50)));

    for (const trade of trades) {
      this.printTrade(trade);
    }
    console.log('');
  }

  /**
   * Print a single trade
   */
  private printTrade(trade: any): void {
    const resultIcon = trade.result === 'WIN' ? '✅' : trade.result === 'LOSS' ? '❌' : '⏳';
    const resultColor = trade.result === 'WIN' ? c.success : trade.result === 'LOSS' ? c.error : c.warning;

    const typeEmoji = trade.type === 'CALL' ? '📈' : '📉';
    const timestamp = new Date(trade.openedAt).toLocaleString();

    console.log(c.dim('  ─'.repeat(25)));
    console.log(`  ${resultIcon} ${typeEmoji} ${c.bold(trade.asset)} ${trade.type}`);
    console.log(`     ${c.dim('Contract:')} ${trade.contractId.substring(0, 12)}...`);
    console.log(`     ${c.dim('Entry:')} ${c.number(trade.entryPrice.toFixed(2))} → ${c.dim('Exit:')} ${trade.exitPrice ? c.number(trade.exitPrice.toFixed(2)) : c.dim('pending')}`);
    console.log(`     ${c.dim('Stake:')} ${c.number('$' + trade.stake.toFixed(2))} → ${c.dim('Payout:')} ${trade.payout ? c.number('$' + trade.payout.toFixed(2)) : c.dim('pending')}`);

    if (trade.result !== 'PENDING') {
      const profit = trade.payout - trade.stake;
      const profitColor = profit >= 0 ? c.success : c.error;
      const profitSign = profit >= 0 ? '+' : '';
      console.log(`     ${c.dim('Profit:')} ${profitColor(profitSign + '$' + profit.toFixed(2))} ${resultColor(trade.result)}`);
    } else {
      console.log(`     ${c.dim('Status:')} ${resultColor('PENDING')}`);
    }

    console.log(`     ${c.dim('Strategy:')} ${trade.strategyName}`);
    console.log(`     ${c.dim('Time:')} ${c.dim(timestamp)}`);
  }
}

/**
 * Main
 */
async function main() {
  const gatewayUrl = process.env.GATEWAY_URL || 'ws://localhost:3000';
  const repl = new TradingREPL(gatewayUrl);
  await repl.start();
}

main().catch((error) => {
  console.error(c.error(`Fatal error: ${error.message}`));
  process.exit(1);
});
