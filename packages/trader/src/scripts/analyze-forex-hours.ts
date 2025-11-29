#!/usr/bin/env npx tsx
/**
 * Analyze bad hours for all forex pairs and generate optimal config
 */

import * as fs from 'fs';
import * as path from 'path';

interface HourStats {
  wins: number;
  losses: number;
  pnl: number;
}

interface AssetAnalysis {
  asset: string;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  totalPnl: number;
  winRate: number;
  badHours: number[];
  goodHours: number[];
  hourStats: Map<number, HourStats>;
  filteredPnl: number;
  filteredWinRate: number;
  improvement: number;
}

function analyzeAsset(jsonPath: string): AssetAnalysis | null {
  if (!fs.existsSync(jsonPath)) {
    console.log(`File not found: ${jsonPath}`);
    return null;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const trades = data.trades;
  const asset = data.metadata.asset;

  // Initialize hour stats
  const hourStats = new Map<number, HourStats>();
  for (let h = 0; h < 24; h++) {
    hourStats.set(h, { wins: 0, losses: 0, pnl: 0 });
  }

  // Calculate stats per hour
  for (const trade of trades) {
    const hour = new Date(trade.entry.snapshot.timestamp).getUTCHours();
    const stats = hourStats.get(hour)!;

    if (trade.result.outcome === 'WIN') {
      stats.wins++;
    } else {
      stats.losses++;
    }
    stats.pnl += trade.result.pnl;
  }

  // Find bad hours (win rate < 45% with at least 15 trades)
  const badHours: number[] = [];
  const goodHours: number[] = [];

  for (let h = 0; h < 24; h++) {
    const stats = hourStats.get(h)!;
    const total = stats.wins + stats.losses;
    if (total < 10) continue;

    const winRate = stats.wins / total * 100;
    if (winRate < 45) badHours.push(h);
    if (winRate > 55) goodHours.push(h);
  }

  // Calculate totals
  const totalWins = trades.filter((t: any) => t.result.outcome === 'WIN').length;
  const totalLosses = trades.filter((t: any) => t.result.outcome === 'LOSS').length;
  const totalPnl = trades.reduce((s: number, t: any) => s + t.result.pnl, 0);

  // Calculate filtered results (excluding bad hours)
  const filteredTrades = trades.filter((t: any) => {
    const hour = new Date(t.entry.snapshot.timestamp).getUTCHours();
    return badHours.indexOf(hour) === -1;
  });

  const filteredWins = filteredTrades.filter((t: any) => t.result.outcome === 'WIN').length;
  const filteredPnl = filteredTrades.reduce((s: number, t: any) => s + t.result.pnl, 0);

  return {
    asset,
    totalTrades: trades.length,
    totalWins,
    totalLosses,
    totalPnl,
    winRate: totalWins / trades.length * 100,
    badHours,
    goodHours,
    hourStats,
    filteredPnl,
    filteredWinRate: filteredTrades.length > 0 ? filteredWins / filteredTrades.length * 100 : 0,
    improvement: totalPnl > 0 ? (filteredPnl - totalPnl) / totalPnl * 100 : 0,
  };
}

async function main() {
  const analysisDir = path.join(process.cwd(), 'analysis-output');

  // Find all forex backtest JSON files
  const files = fs.readdirSync(analysisDir)
    .filter(f => f.startsWith('backtest_FVG-Liquidity-Sweep_frx') && f.endsWith('.json'))
    .sort();

  console.log('═'.repeat(80));
  console.log('ANÁLISIS DE HORAS MALAS POR PAR FOREX');
  console.log('═'.repeat(80));
  console.log('');

  const results: AssetAnalysis[] = [];

  for (const file of files) {
    const analysis = analyzeAsset(path.join(analysisDir, file));
    if (analysis) {
      results.push(analysis);
    }
  }

  // Print summary table
  console.log('Asset      | Trades | WinRate | P&L     | Bad Hours              | Filtered P&L | Mejora');
  console.log('─'.repeat(95));

  for (const r of results) {
    const badHoursStr = r.badHours.length > 0 ? r.badHours.join(',') : 'ninguna';
    console.log(
      `${r.asset.padEnd(10)} | ` +
      `${r.totalTrades.toString().padStart(6)} | ` +
      `${r.winRate.toFixed(1).padStart(6)}% | ` +
      `$${r.totalPnl.toFixed(0).padStart(6)} | ` +
      `${badHoursStr.padEnd(22)} | ` +
      `$${r.filteredPnl.toFixed(0).padStart(11)} | ` +
      `${r.improvement >= 0 ? '+' : ''}${r.improvement.toFixed(1)}%`
    );
  }

  // Find common bad hours
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('HORAS PROBLEMÁTICAS COMUNES');
  console.log('═'.repeat(80));

  const hourFrequency: { [h: number]: number } = {};
  for (const r of results) {
    for (const h of r.badHours) {
      hourFrequency[h] = (hourFrequency[h] || 0) + 1;
    }
  }

  const commonBadHours = Object.entries(hourFrequency)
    .filter(([_, count]) => count >= 2)
    .map(([h]) => parseInt(h))
    .sort((a, b) => a - b);

  console.log('Horas malas en 2+ pares:', commonBadHours.join(', ') || 'ninguna');

  // Generate config recommendation
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('CONFIGURACIÓN RECOMENDADA PARA PARAMS.TS');
  console.log('═'.repeat(80));
  console.log('');

  for (const r of results) {
    if (r.badHours.length > 0) {
      console.log(`// ${r.asset}`);
      console.log(`hourFilterEnabled: true,`);
      console.log(`badHoursUTC: [${r.badHours.join(', ')}],`);
      console.log(`// Mejora estimada: ${r.improvement >= 0 ? '+' : ''}${r.improvement.toFixed(1)}%`);
      console.log('');
    }
  }

  // Print hour by hour analysis for top pair
  const topPair = results.reduce((a, b) => a.totalPnl > b.totalPnl ? a : b);
  console.log('\n');
  console.log('═'.repeat(80));
  console.log(`DETALLE POR HORA: ${topPair.asset} (mejor par)`);
  console.log('═'.repeat(80));
  console.log('Hora  | Wins | Loss | WinRate | P&L');
  console.log('─'.repeat(45));

  for (let h = 0; h < 24; h++) {
    const stats = topPair.hourStats.get(h)!;
    const total = stats.wins + stats.losses;
    if (total < 5) continue;

    const winRate = stats.wins / total * 100;
    const marker = winRate < 45 ? ' ⚠️' : winRate > 55 ? ' ✅' : '';
    console.log(
      `${String(h).padStart(2)}:00 | ` +
      `${stats.wins.toString().padStart(4)} | ` +
      `${stats.losses.toString().padStart(4)} | ` +
      `${winRate.toFixed(1).padStart(6)}% | ` +
      `$${stats.pnl.toFixed(0).padStart(5)}${marker}`
    );
  }
}

main().catch(console.error);
