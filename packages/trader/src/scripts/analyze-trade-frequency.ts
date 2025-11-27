#!/usr/bin/env tsx
/**
 * Analyze trade frequency and distribution
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { runMRBacktest, type MRBacktestConfig } from '../backtest/mr-backtest-runner.js';
import { SessionFilterService } from '../services/session-filter.service.js';

async function main() {
  const dataPath = process.env.DATA_FILE || join(process.cwd(), 'analysis-output', 'frxEURUSD_300s_365d.csv');
  const asset = process.env.ASSET || 'frxEURUSD';

  if (!existsSync(dataPath)) {
    console.error(`❌ Data file not found: ${dataPath}`);
    process.exit(1);
  }

  const config: MRBacktestConfig = {
    asset,
    dataPath,
    initialBalance: 10000,
    stakePct: 0.02,
    multiplier: 100,
    takeProfitPct: 0.005,
    stopLossPct: 0.005,
    maxBarsInTrade: 20,
    enableNewsFilter: false,
    enableSessionFilter: true,
    allowedSessions: ['LONDON', 'OVERLAP', 'NY'],
  };

  console.log('\n📊 Analizando frecuencia de trades...\n');
  const result = await runMRBacktest('BB_BOUNCE', config);

  const trades = result.trades;
  const days = 366; // 1 año
  const sessionFilter = new SessionFilterService();

  // Calculate frequency
  const tradesPerDay = trades.length / days;
  const tradesPerWeek = tradesPerDay * 7;
  const tradesPerMonth = tradesPerDay * 30;

  // Distribution by session
  const sessionStats: Record<string, { count: number; wins: number; losses: number; pnl: number }> = {
    ASIAN: { count: 0, wins: 0, losses: 0, pnl: 0 },
    LONDON: { count: 0, wins: 0, losses: 0, pnl: 0 },
    OVERLAP: { count: 0, wins: 0, losses: 0, pnl: 0 },
    NY: { count: 0, wins: 0, losses: 0, pnl: 0 },
    CLOSED: { count: 0, wins: 0, losses: 0, pnl: 0 },
  };

  // Distribution by hour
  const hourStats: Record<number, { count: number; wins: number; losses: number; pnl: number }> = {};
  for (let h = 0; h < 24; h++) {
    hourStats[h] = { count: 0, wins: 0, losses: 0, pnl: 0 };
  }

  // Distribution by day of week
  const dayStats: Record<number, { count: number; wins: number; losses: number; pnl: number }> = {};
  for (let d = 0; d < 7; d++) {
    dayStats[d] = { count: 0, wins: 0, losses: 0, pnl: 0 };
  }

  for (const trade of trades) {
    const date = new Date(trade.timestamp * 1000);
    const hour = date.getUTCHours();
    const dayOfWeek = date.getUTCDay();
    const session = sessionFilter.getSession(trade.timestamp);

    // Session stats
    sessionStats[session].count++;
    if (trade.result === 'WIN') {
      sessionStats[session].wins++;
    } else {
      sessionStats[session].losses++;
    }
    sessionStats[session].pnl += trade.pnl;

    // Hour stats
    hourStats[hour].count++;
    if (trade.result === 'WIN') {
      hourStats[hour].wins++;
    } else {
      hourStats[hour].losses++;
    }
    hourStats[hour].pnl += trade.pnl;

    // Day stats
    dayStats[dayOfWeek].count++;
    if (trade.result === 'WIN') {
      dayStats[dayOfWeek].wins++;
    } else {
      dayStats[dayOfWeek].losses++;
    }
    dayStats[dayOfWeek].pnl += trade.pnl;
  }

  // Print results
  console.log('='.repeat(80));
  console.log('📊 FRECUENCIA DE TRADES');
  console.log('='.repeat(80));
  console.log(`\nTotal Trades: ${trades.length}`);
  console.log(`Período: ${days} días (1 año)`);
  console.log(`\nTrades por día: ${tradesPerDay.toFixed(2)}`);
  console.log(`Trades por semana: ${tradesPerWeek.toFixed(1)}`);
  console.log(`Trades por mes: ${tradesPerMonth.toFixed(1)}`);
  console.log(`\nPromedio: ~${Math.round(tradesPerDay)} trade(s) por día`);

  console.log('\n' + '='.repeat(80));
  console.log('📅 DISTRIBUCIÓN POR SESIÓN');
  console.log('='.repeat(80));
  console.log('\nSesión    | Trades | Wins | Losses | WR%   | Net P&L');
  console.log('-'.repeat(60));
  for (const [session, stats] of Object.entries(sessionStats)) {
    if (stats.count > 0) {
      const wr = (stats.wins / stats.count) * 100;
      console.log(
        `${session.padEnd(10)} | ${stats.count.toString().padStart(6)} | ${stats.wins.toString().padStart(4)} | ${stats.losses.toString().padStart(6)} | ${wr.toFixed(1).padStart(5)}% | $${stats.pnl.toFixed(2)}`
      );
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('🕐 DISTRIBUCIÓN POR HORA (UTC) - Top 10');
  console.log('='.repeat(80));
  const topHours = Object.entries(hourStats)
    .filter(([_, stats]) => stats.count > 0)
    .map(([hour, stats]) => ({
      hour: parseInt(hour),
      ...stats,
      wr: (stats.wins / stats.count) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  console.log('\nHora | Trades | Wins | Losses | WR%   | Net P&L');
  console.log('-'.repeat(50));
  for (const h of topHours) {
    console.log(
      `${h.hour.toString().padStart(4)} | ${h.count.toString().padStart(6)} | ${h.wins.toString().padStart(4)} | ${h.losses.toString().padStart(6)} | ${h.wr.toFixed(1).padStart(5)}% | $${h.pnl.toFixed(2)}`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('📆 DISTRIBUCIÓN POR DÍA DE SEMANA');
  console.log('='.repeat(80));
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  console.log('\nDía  | Trades | Wins | Losses | WR%   | Net P&L');
  console.log('-'.repeat(50));
  for (let d = 0; d < 7; d++) {
    const stats = dayStats[d]!;
    if (stats.count > 0) {
      const wr = (stats.wins / stats.count) * 100;
      console.log(
        `${dayNames[d]!.padEnd(4)} | ${stats.count.toString().padStart(6)} | ${stats.wins.toString().padStart(4)} | ${stats.losses.toString().padStart(6)} | ${wr.toFixed(1).padStart(5)}% | $${stats.pnl.toFixed(2)}`
      );
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

main().catch(console.error);

