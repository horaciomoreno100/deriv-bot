#!/usr/bin/env npx tsx
/**
 * Validación de Overfitting
 * 
 * Tests para detectar sobreajuste:
 * 1. Out-of-Sample Testing (train/test split)
 * 2. Walk-Forward Analysis
 * 3. Stability Analysis (consistencia en diferentes períodos)
 * 4. Parameter Sensitivity (cambios pequeños en parámetros)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { HIGH_PF_PRESET, CONSERVATIVE_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

function loadCandles(filepath: string): Candle[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]!) / 1000,
        open: parseFloat(parts[1]!),
        high: parseFloat(parts[2]!),
        low: parseFloat(parts[3]!),
        close: parseFloat(parts[4]!),
        volume: parts.length > 5 ? parseFloat(parts[5]!) : undefined,
      });
    }
  }

  return candles;
}

interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  netPnl: number;
  pf: number;
  winRate: number;
  maxDD: number;
  avgWin: number;
  avgLoss: number;
  riskRewardRatio: number;
}

function runBacktest(
  candles: Candle[],
  entryFn: any,
  config: any
): BacktestMetrics {
  const backtester = new FastBacktester(candles, ['rsi', 'atr', 'adx', 'bb'], {
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    bbPeriod: 20,
    bbStdDev: 2,
  });

  const result = backtester.run({
    ...config,
    entryFn,
  });
  
  return {
    trades: result.trades,
    wins: result.wins,
    losses: result.losses,
    netPnl: result.netPnl,
    pf: result.profitFactor,
    winRate: result.winRate,
    maxDD: result.maxDrawdownPct,
    avgWin: result.avgWin,
    avgLoss: result.avgLoss,
    riskRewardRatio: result.riskRewardRatio,
  };
}

async function main() {
  const asset = process.argv[2] || 'cryETHUSD';
  const presetName = asset.includes('ETH') ? 'High PF' : 'Conservative';
  const preset = asset.includes('ETH') ? HIGH_PF_PRESET : CONSERVATIVE_PRESET;

  console.log('='.repeat(80));
  console.log(`  VALIDACIÓN DE OVERFITTING - ${asset}`);
  console.log('='.repeat(80));

  const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);
  if (!fs.existsSync(filepath)) {
    console.error(`Data file not found: ${filepath}`);
    process.exit(1);
  }

  console.log('\n📊 Cargando datos...');
  const allCandles = loadCandles(filepath);
  console.log(`   Total: ${allCandles.length.toLocaleString()} velas (${(allCandles.length / (24 * 60)).toFixed(1)} días)`);

  // Configuración optimizada
  const optimizedConfig = {
    tpPct: preset.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
    slPct: preset.baseStopLossPct ?? 0.2,
    cooldown: preset.cooldownBars ?? 20,
    maxBarsInTrade: preset.maxBarsInTrade ?? 60,
    initialBalance: INITIAL_CAPITAL,
    stakePct: STAKE_PCT,
    multiplier: MULTIPLIER,
    startIndex: 50,
    zombieKiller: asset.includes('ETH')
      ? { enabled: true, bars: 15, minPnlPct: 0.05, onlyIfReversing: true }
      : { enabled: true, bars: 15, minPnlPct: 0.1 },
    exitOnBBUpper: asset.includes('ETH'), // Solo para ETH
    exitOnBBLower: asset.includes('ETH'),
    bbUpperLowerMinPnl: 0.05,
  };

  // ============================================================================
  // TEST 1: OUT-OF-SAMPLE (Train/Test Split)
  // ============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('TEST 1: OUT-OF-SAMPLE (Train/Test Split)');
  console.log('='.repeat(80));
  
  // Split: 70% train, 30% test
  const splitIndex = Math.floor(allCandles.length * 0.7);
  const trainCandles = allCandles.slice(0, splitIndex);
  const testCandles = allCandles.slice(splitIndex);
  
  console.log(`\n📈 Training Set: ${trainCandles.length.toLocaleString()} velas (${(trainCandles.length / (24 * 60)).toFixed(1)} días)`);
  console.log(`   From: ${new Date(trainCandles[0]!.timestamp * 1000).toISOString().split('T')[0]}`);
  console.log(`   To: ${new Date(trainCandles[trainCandles.length - 1]!.timestamp * 1000).toISOString().split('T')[0]}`);
  
  console.log(`\n📊 Test Set: ${testCandles.length.toLocaleString()} velas (${(testCandles.length / (24 * 60)).toFixed(1)} días)`);
  console.log(`   From: ${new Date(testCandles[0]!.timestamp * 1000).toISOString().split('T')[0]}`);
  console.log(`   To: ${new Date(testCandles[testCandles.length - 1]!.timestamp * 1000).toISOString().split('T')[0]}`);

  console.log('\n🔄 Ejecutando backtest en Training Set...');
  const trainEntryFn = createCryptoScalpV2EntryFn(trainCandles, preset, { enableMTF: true });
  const trainResult = runBacktest(trainCandles, trainEntryFn, optimizedConfig);

  console.log('\n🔄 Ejecutando backtest en Test Set...');
  const testEntryFn = createCryptoScalpV2EntryFn(testCandles, preset, { enableMTF: true });
  const testResult = runBacktest(testCandles, testEntryFn, optimizedConfig);

  console.log('\n' + '-'.repeat(80));
  console.log('RESULTADOS:');
  console.log('-'.repeat(80));
  console.log('Métrica'.padEnd(20) + '| Training'.padEnd(15) + '| Test'.padEnd(15) + '| Diferencia');
  console.log('-'.repeat(80));
  
  const metrics: Array<{ name: string; train: number; test: number; format: (v: number) => string }> = [
    { name: 'Net PnL', train: trainResult.netPnl, test: testResult.netPnl, format: (v) => `$${v.toFixed(0)}` },
    { name: 'Profit Factor', train: trainResult.pf, test: testResult.pf, format: (v) => v.toFixed(2) },
    { name: 'Win Rate', train: trainResult.winRate, test: testResult.winRate, format: (v) => `${v.toFixed(1)}%` },
    { name: 'Max Drawdown', train: trainResult.maxDD, test: testResult.maxDD, format: (v) => `${v.toFixed(1)}%` },
    { name: 'Trades', train: trainResult.trades, test: testResult.trades, format: (v) => v.toFixed(0) },
    { name: 'Avg Win', train: trainResult.avgWin, test: testResult.avgWin, format: (v) => `$${v.toFixed(2)}` },
    { name: 'Avg Loss', train: trainResult.avgLoss, test: testResult.avgLoss, format: (v) => `$${v.toFixed(2)}` },
    { name: 'R:R Ratio', train: trainResult.riskRewardRatio, test: testResult.riskRewardRatio, format: (v) => v.toFixed(2) },
  ];

  for (const m of metrics) {
    const diff = m.test - m.train;
    const diffPct = m.train !== 0 ? (diff / Math.abs(m.train)) * 100 : 0;
    const diffStr = diffPct > 0 ? `+${diffPct.toFixed(1)}%` : `${diffPct.toFixed(1)}%`;
    const marker = Math.abs(diffPct) > 30 ? ' ⚠️' : Math.abs(diffPct) > 20 ? ' ⚡' : ' ✅';
    
    console.log(
      m.name.padEnd(20) + '| ' +
      m.format(m.train).padEnd(13) + '| ' +
      m.format(m.test).padEnd(13) + '| ' +
      diffStr.padEnd(10) + marker
    );
  }

  // Análisis de overfitting
  const pfDiff = Math.abs(testResult.pf - trainResult.pf) / trainResult.pf * 100;
  const pnlDiff = Math.abs(testResult.netPnl - trainResult.netPnl) / Math.abs(trainResult.netPnl) * 100;
  
  console.log('\n📊 Análisis de Overfitting:');
  if (pfDiff > 30 || (testResult.pf < 1 && trainResult.pf > 1.2)) {
    console.log('   ⚠️  POSIBLE OVERFITTING detectado!');
    console.log(`   - Diferencia en PF: ${pfDiff.toFixed(1)}%`);
    console.log(`   - Test PF < 1 mientras Train PF > 1.2`);
  } else if (pfDiff > 20) {
    console.log('   ⚡ ADVERTENCIA: Diferencia significativa entre train/test');
    console.log(`   - Diferencia en PF: ${pfDiff.toFixed(1)}%`);
  } else {
    console.log('   ✅ Resultados consistentes entre train/test');
    console.log(`   - Diferencia en PF: ${pfDiff.toFixed(1)}%`);
  }

  // ============================================================================
  // TEST 2: WALK-FORWARD ANALYSIS (Rolling Windows)
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('TEST 2: WALK-FORWARD ANALYSIS (Rolling Windows)');
  console.log('='.repeat(80));
  
  // Dividir en 3 ventanas de 30 días cada una
  const windowSize = 30 * 24 * 60; // 30 días en minutos
  const windows: Array<{ name: string; candles: Candle[] }> = [];
  
  for (let i = 0; i < allCandles.length; i += windowSize) {
    const windowCandles = allCandles.slice(i, i + windowSize);
    if (windowCandles.length >= windowSize * 0.8) { // Al menos 80% del tamaño
      const startDate = new Date(windowCandles[0]!.timestamp * 1000).toISOString().split('T')[0];
      const endDate = new Date(windowCandles[windowCandles.length - 1]!.timestamp * 1000).toISOString().split('T')[0];
      windows.push({
        name: `Window ${windows.length + 1} (${startDate} to ${endDate})`,
        candles: windowCandles,
      });
    }
  }

  console.log(`\n📊 Analizando ${windows.length} ventanas de ~30 días cada una:`);
  
  const windowResults: Array<BacktestMetrics & { name: string }> = [];
  
  for (const window of windows) {
    console.log(`\n   ${window.name}...`);
    const entryFn = createCryptoScalpV2EntryFn(window.candles, preset, { enableMTF: true });
    const result = runBacktest(window.candles, entryFn, optimizedConfig);
    windowResults.push({ ...result, name: window.name });
  }

  console.log('\n' + '-'.repeat(80));
  console.log('RESULTADOS POR VENTANA:');
  console.log('-'.repeat(80));
  console.log('Ventana'.padEnd(30) + '| Trades | Net$  | PF   | WR%  | DD%');
  console.log('-'.repeat(80));

  for (const r of windowResults) {
    console.log(
      r.name.substring(0, 28).padEnd(30) + '| ' +
      String(r.trades).padStart(6) + ' | ' +
      ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
      r.pf.toFixed(2).padStart(4) + ' | ' +
      r.winRate.toFixed(0).padStart(4) + '% | ' +
      r.maxDD.toFixed(1).padStart(4) + '%'
    );
  }

  // Análisis de consistencia
  const profitableWindows = windowResults.filter(r => r.netPnl > 0).length;
  const avgPF = windowResults.reduce((sum, r) => sum + r.pf, 0) / windowResults.length;
  const pfStdDev = Math.sqrt(
    windowResults.reduce((sum, r) => sum + Math.pow(r.pf - avgPF, 2), 0) / windowResults.length
  );
  const pfCoeffVar = (pfStdDev / avgPF) * 100; // Coeficiente de variación

  console.log('\n📊 Análisis de Consistencia:');
  console.log(`   Ventanas rentables: ${profitableWindows}/${windowResults.length} (${(profitableWindows / windowResults.length * 100).toFixed(0)}%)`);
  console.log(`   PF promedio: ${avgPF.toFixed(2)}`);
  console.log(`   Desviación estándar PF: ${pfStdDev.toFixed(2)}`);
  console.log(`   Coeficiente de variación: ${pfCoeffVar.toFixed(1)}%`);
  
  if (profitableWindows < windowResults.length * 0.6) {
    console.log('   ⚠️  ADVERTENCIA: Menos del 60% de ventanas son rentables');
  } else if (pfCoeffVar > 50) {
    console.log('   ⚡ ADVERTENCIA: Alta variabilidad en resultados (CV > 50%)');
  } else {
    console.log('   ✅ Resultados consistentes across ventanas');
  }

  // ============================================================================
  // TEST 3: PARAMETER SENSITIVITY
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('TEST 3: PARAMETER SENSITIVITY');
  console.log('='.repeat(80));
  
  console.log('\n📊 Probando variaciones pequeñas en parámetros clave:');
  
  const baseTP = optimizedConfig.tpPct;
  const baseSL = optimizedConfig.slPct;
  const baseCooldown = optimizedConfig.cooldown;
  
  const variations = [
    { name: 'BASE', tp: baseTP, sl: baseSL, cooldown: baseCooldown },
    { name: 'TP +10%', tp: baseTP * 1.1, sl: baseSL, cooldown: baseCooldown },
    { name: 'TP -10%', tp: baseTP * 0.9, sl: baseSL, cooldown: baseCooldown },
    { name: 'SL +10%', tp: baseTP, sl: baseSL * 1.1, cooldown: baseCooldown },
    { name: 'SL -10%', tp: baseTP, sl: baseSL * 0.9, cooldown: baseCooldown },
    { name: 'Cooldown +20%', tp: baseTP, sl: baseSL, cooldown: Math.round(baseCooldown * 1.2) },
    { name: 'Cooldown -20%', tp: baseTP, sl: baseSL, cooldown: Math.round(baseCooldown * 0.8) },
  ];

  const sensitivityResults: Array<BacktestMetrics & { name: string }> = [];
  
  for (const variation of variations) {
    const entryFn = createCryptoScalpV2EntryFn(allCandles, preset, { enableMTF: true });
    const result = runBacktest(allCandles, entryFn, {
      ...optimizedConfig,
      tpPct: variation.tp,
      slPct: variation.sl,
      cooldown: variation.cooldown,
    });
    sensitivityResults.push({ ...result, name: variation.name });
  }

  console.log('\n' + '-'.repeat(80));
  console.log('RESULTADOS:');
  console.log('-'.repeat(80));
  console.log('Variación'.padEnd(20) + '| Net$  | PF   | WR%  | Trades');
  console.log('-'.repeat(80));

  const baseResult = sensitivityResults[0]!;
  
  for (const r of sensitivityResults) {
    const pnlDiff = ((r.netPnl - baseResult.netPnl) / Math.abs(baseResult.netPnl)) * 100;
    const marker = Math.abs(pnlDiff) > 20 ? ' ⚠️' : Math.abs(pnlDiff) > 10 ? ' ⚡' : ' ✅';
    
    console.log(
      r.name.padEnd(20) + '| ' +
      ('$' + r.netPnl.toFixed(0)).padStart(5) + ' | ' +
      r.pf.toFixed(2).padStart(4) + ' | ' +
      r.winRate.toFixed(0).padStart(4) + '% | ' +
      String(r.trades).padStart(6) + marker
    );
  }

  const maxPnlDiff = Math.max(...sensitivityResults.map(r => 
    Math.abs((r.netPnl - baseResult.netPnl) / Math.abs(baseResult.netPnl)) * 100
  ));

  console.log('\n📊 Análisis de Sensibilidad:');
  console.log(`   Cambio máximo en PnL: ${maxPnlDiff.toFixed(1)}%`);
  
  if (maxPnlDiff > 50) {
    console.log('   ⚠️  ADVERTENCIA: Alta sensibilidad a cambios en parámetros (>50%)');
    console.log('   - La estrategia puede ser frágil');
  } else if (maxPnlDiff > 30) {
    console.log('   ⚡ ADVERTENCIA: Sensibilidad moderada a cambios en parámetros (30-50%)');
  } else {
    console.log('   ✅ Baja sensibilidad a cambios en parámetros (<30%)');
    console.log('   - La estrategia es robusta');
  }

  // ============================================================================
  // RESUMEN FINAL
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('📋 RESUMEN FINAL - DIAGNÓSTICO DE OVERFITTING');
  console.log('='.repeat(80));
  
  const warnings: string[] = [];
  const positives: string[] = [];

  // Test 1: Out-of-Sample
  if (pfDiff > 30 || (testResult.pf < 1 && trainResult.pf > 1.2)) {
    warnings.push('❌ Test 1: Gran diferencia entre train/test (posible overfitting)');
  } else if (pfDiff < 20) {
    positives.push('✅ Test 1: Resultados consistentes entre train/test');
  }

  // Test 2: Walk-Forward
  if (profitableWindows < windowResults.length * 0.6) {
    warnings.push('❌ Test 2: Menos del 60% de ventanas son rentables');
  } else {
    positives.push(`✅ Test 2: ${profitableWindows}/${windowResults.length} ventanas rentables`);
  }

  if (pfCoeffVar > 50) {
    warnings.push('❌ Test 2: Alta variabilidad en resultados (CV > 50%)');
  } else {
    positives.push(`✅ Test 2: Baja variabilidad (CV: ${pfCoeffVar.toFixed(1)}%)`);
  }

  // Test 3: Sensitivity
  if (maxPnlDiff > 50) {
    warnings.push('❌ Test 3: Alta sensibilidad a cambios en parámetros');
  } else {
    positives.push(`✅ Test 3: Baja sensibilidad a parámetros (max cambio: ${maxPnlDiff.toFixed(1)}%)`);
  }

  console.log('\n✅ Puntos Positivos:');
  for (const p of positives) {
    console.log(`   ${p}`);
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  Advertencias:');
    for (const w of warnings) {
      console.log(`   ${w}`);
    }
  }

  if (warnings.length === 0) {
    console.log('\n🎉 CONCLUSIÓN: No se detectó overfitting significativo');
    console.log('   La estrategia parece ser robusta y generalizable');
  } else if (warnings.length <= 1) {
    console.log('\n⚡ CONCLUSIÓN: Overfitting menor detectado');
    console.log('   La estrategia es mayormente robusta, pero hay áreas de mejora');
  } else {
    console.log('\n⚠️  CONCLUSIÓN: Posible overfitting detectado');
    console.log('   Se recomienda revisar la estrategia y simplificar parámetros');
  }

  console.log('\n');
}

main().catch(console.error);

