#!/usr/bin/env npx tsx
/**
 * Test different hour filters for FVG-LS strategy
 */

import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('analysis-output/backtest_FVG-Liquidity-Sweep_frxAUDUSD_2025-11-29_162641.json', 'utf-8'));

const trades = data.trades;

interface SimResult {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
}

function simulate(badHours: number[], label: string): SimResult {
  const filteredTrades = trades.filter((t: any) => {
    const hour = new Date(t.entry.snapshot.timestamp).getUTCHours();
    return badHours.indexOf(hour) === -1;
  });

  const wins = filteredTrades.filter((t: any) => t.result.outcome === 'WIN').length;
  const losses = filteredTrades.filter((t: any) => t.result.outcome === 'LOSS').length;
  const pnl = filteredTrades.reduce((s: number, t: any) => s + t.result.pnl, 0);
  const winRate = wins / filteredTrades.length * 100;

  return {
    label,
    trades: filteredTrades.length,
    wins,
    losses,
    winRate,
    pnl,
  };
}

const results: SimResult[] = [
  simulate([], 'Sin filtro'),
  simulate([5, 8, 9, 11, 16, 17, 21], 'Bad 7 horas'),
  simulate([8, 11], 'Solo peores (8,11)'),
  simulate([5, 8, 9, 11], 'Mañana mala'),
  simulate([16, 17, 21], 'Tarde mala'),
  simulate([8], 'Solo 8:00'),
  simulate([11], 'Solo 11:00'),
  simulate([5, 8, 11], 'Top 3 peores'),
];

console.log('═'.repeat(75));
console.log('COMPARACIÓN DE FILTROS HORARIOS');
console.log('═'.repeat(75));
console.log('Filtro          | Trades | Wins | Loss | WinRate | P&L     | vs Base');
console.log('─'.repeat(75));

const baseline = results[0]!;

for (const r of results) {
  const diff = r.pnl - baseline.pnl;
  const diffPct = (diff / baseline.pnl * 100).toFixed(1);
  console.log(
    `${r.label.padEnd(15)} | ` +
    `${r.trades.toString().padStart(6)} | ` +
    `${r.wins.toString().padStart(4)} | ` +
    `${r.losses.toString().padStart(4)} | ` +
    `${r.winRate.toFixed(1).padStart(6)}% | ` +
    `$${r.pnl.toFixed(0).padStart(6)} | ` +
    `${diff >= 0 ? '+' : ''}${diffPct}%`
  );
}

// Find best
const best = results.reduce((a, b) => a.pnl > b.pnl ? a : b);
console.log('─'.repeat(75));
console.log(`✅ Mejor filtro: ${best.label}`);
console.log(`   P&L: $${best.pnl.toFixed(2)} | Win Rate: ${best.winRate.toFixed(1)}%`);
