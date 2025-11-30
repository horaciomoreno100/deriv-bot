#!/usr/bin/env npx tsx
/**
 * Análisis de TP/SL para optimización de toma de ganancias
 * 
 * Analiza:
 * - Cuántos trades tocan BB superior/inferior antes de cerrar
 * - Máxima ganancia favorable vs ganancia real
 * - Trades que alcanzan ganancias altas y luego caen
 * - Análisis de TP vs SL hit rates
 * - Sugerencias de optimización
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { createIndicatorCache } from '../backtest/data/indicator-cache.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { HIGH_PF_PRESET, CONSERVATIVE_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';

const INITIAL_CAPITAL = 1000;
const STAKE_PCT = 0.03;
const MULTIPLIER = 100;
const dataDir = path.join(process.cwd(), 'data');

interface TradeAnalysis {
  entryIndex: number;
  exitIndex: number;
  direction: 'CALL' | 'PUT';
  entryPrice: number;
  exitPrice: number;
  tpPrice: number;
  slPrice: number;
  outcome: 'WIN' | 'LOSS';
  exitReason: string;
  pnl: number;
  
  // Análisis adicional
  maxFavorablePct: number; // Máxima ganancia alcanzada (%)
  maxFavorablePrice: number; // Precio al que alcanzó máxima ganancia
  maxFavorableIndex: number; // Índice donde alcanzó máxima ganancia
  finalPnlPct: number; // Ganancia final (%)
  
  // BB touches
  touchedBBUpper: boolean;
  touchedBBLower: boolean;
  touchedBBMiddle: boolean;
  bbUpperTouchIndex: number | null;
  bbLowerTouchIndex: number | null;
  bbMiddleTouchIndex: number | null;
  
  // Price excursion
  maxPrice: number; // Precio máximo alcanzado (para CALL)
  minPrice: number; // Precio mínimo alcanzado (para PUT)
  priceAtBBUpper: number | null;
  priceAtBBLower: number | null;
  
  // Opportunity lost
  opportunityLost: number; // Ganancia que se perdió (maxFavorable - final)
  opportunityLostPct: number; // % de ganancia perdida
}

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

function analyzeTrades(
  candles: Candle[],
  indicatorCache: any,
  entryFn: any,
  config: any
): TradeAnalysis[] {
  const {
    tpPct,
    slPct,
    cooldown,
    maxBarsInTrade = 50,
    initialBalance = 1000,
    stakePct = 0.03,
    multiplier = 100,
    startIndex = 0,
    endIndex = candles.length,
  } = config;

  let equity = initialBalance;
  let cooldownUntil = startIndex;
  const trades: TradeAnalysis[] = [];

  for (let i = startIndex; i < endIndex; i++) {
    if (i < cooldownUntil) continue;

    const indicators = indicatorCache.getSnapshot(i);
    const indicatorRecord: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(indicators)) {
      indicatorRecord[key] = value as number | boolean;
    }

    const signal = entryFn(i, indicatorRecord);
    if (!signal) continue;

    const entryPrice = signal.price > 0 ? signal.price : candles[i]!.close;
    const stake = equity * stakePct;
    const tpPrice = signal.direction === 'CALL'
      ? entryPrice * (1 + tpPct / 100)
      : entryPrice * (1 - tpPct / 100);
    const slPrice = signal.direction === 'CALL'
      ? entryPrice * (1 - slPct / 100)
      : entryPrice * (1 + slPct / 100);

    // Track maximum favorable excursion
    let maxFavorablePct = 0;
    let maxFavorablePrice = entryPrice;
    let maxFavorableIndex = i;
    let maxPrice = entryPrice;
    let minPrice = entryPrice;
    
    // Track BB touches
    let touchedBBUpper = false;
    let touchedBBLower = false;
    let touchedBBMiddle = false;
    let bbUpperTouchIndex: number | null = null;
    let bbLowerTouchIndex: number | null = null;
    let bbMiddleTouchIndex: number | null = null;
    let priceAtBBUpper: number | null = null;
    let priceAtBBLower: number | null = null;

    let exitPrice = entryPrice;
    let outcome: 'WIN' | 'LOSS' = 'LOSS';
    let exitIndex = i;
    let exitReason = 'TIMEOUT';

    // Simulate trade and track all metrics
    for (let j = i + 1; j < Math.min(i + maxBarsInTrade + 1, endIndex); j++) {
      const candle = candles[j]!;
      const exitIndicators = indicatorCache.getSnapshot(j);
      const bbUpper = exitIndicators.bbUpper as number | undefined;
      const bbMiddle = exitIndicators.bbMiddle as number | undefined;
      const bbLower = exitIndicators.bbLower as number | undefined;
      const currentPrice = candle.close;

      // Update max/min prices
      maxPrice = Math.max(maxPrice, candle.high);
      minPrice = Math.min(minPrice, candle.low);

      // Track maximum favorable excursion
      if (signal.direction === 'CALL') {
        const favorablePct = ((candle.high - entryPrice) / entryPrice) * 100;
        if (favorablePct > maxFavorablePct) {
          maxFavorablePct = favorablePct;
          maxFavorablePrice = candle.high;
          maxFavorableIndex = j;
        }
      } else {
        const favorablePct = ((entryPrice - candle.low) / entryPrice) * 100;
        if (favorablePct > maxFavorablePct) {
          maxFavorablePct = favorablePct;
          maxFavorablePrice = candle.low;
          maxFavorableIndex = j;
        }
      }

      // Track BB touches
      if (typeof bbUpper === 'number') {
        if (candle.high >= bbUpper && !touchedBBUpper) {
          touchedBBUpper = true;
          bbUpperTouchIndex = j;
          priceAtBBUpper = Math.min(candle.high, bbUpper);
        }
      }
      if (typeof bbLower === 'number') {
        if (candle.low <= bbLower && !touchedBBLower) {
          touchedBBLower = true;
          bbLowerTouchIndex = j;
          priceAtBBLower = Math.max(candle.low, bbLower);
        }
      }
      if (typeof bbMiddle === 'number') {
        if (!touchedBBMiddle) {
          if (signal.direction === 'CALL' && candle.high >= bbMiddle) {
            touchedBBMiddle = true;
            bbMiddleTouchIndex = j;
          } else if (signal.direction === 'PUT' && candle.low <= bbMiddle) {
            touchedBBMiddle = true;
            bbMiddleTouchIndex = j;
          }
        }
      }

      // Check exit conditions
      if (signal.direction === 'CALL') {
        if (candle.low <= slPrice) {
          exitPrice = slPrice;
          outcome = 'LOSS';
          exitIndex = j;
          exitReason = 'SL';
          break;
        }
        if (candle.high >= tpPrice) {
          exitPrice = tpPrice;
          outcome = 'WIN';
          exitIndex = j;
          exitReason = 'TP';
          break;
        }
        if (config.zombieKiller?.enabled) {
          const barsHeld = j - i;
          if (barsHeld >= config.zombieKiller.bars) {
            const currentPnl = (currentPrice - entryPrice) / entryPrice * 100;
            const minPnl = config.zombieKiller.minPnlPct || 0.05;
            const isReversing = config.zombieKiller.onlyIfReversing
              ? (j > i + 1 && currentPrice < candles[j - 1]!.close)
              : true;
            
            if (currentPnl < minPnl && isReversing) {
              exitPrice = currentPrice;
              outcome = currentPnl >= 0 ? 'WIN' : 'LOSS';
              exitIndex = j;
              exitReason = 'ZOMBIE';
              break;
            }
          }
        }
      } else {
        if (candle.high >= slPrice) {
          exitPrice = slPrice;
          outcome = 'LOSS';
          exitIndex = j;
          exitReason = 'SL';
          break;
        }
        if (candle.low <= tpPrice) {
          exitPrice = tpPrice;
          outcome = 'WIN';
          exitIndex = j;
          exitReason = 'TP';
          break;
        }
        if (config.zombieKiller?.enabled) {
          const barsHeld = j - i;
          if (barsHeld >= config.zombieKiller.bars) {
            const currentPnl = (entryPrice - currentPrice) / entryPrice * 100;
            const minPnl = config.zombieKiller.minPnlPct || 0.05;
            const isReversing = config.zombieKiller.onlyIfReversing
              ? (j > i + 1 && currentPrice > candles[j - 1]!.close)
              : true;
            
            if (currentPnl < minPnl && isReversing) {
              exitPrice = currentPrice;
              outcome = currentPnl >= 0 ? 'WIN' : 'LOSS';
              exitIndex = j;
              exitReason = 'ZOMBIE';
              break;
            }
          }
        }
      }
    }

    if (exitIndex === i) {
      exitIndex = Math.min(i + maxBarsInTrade, endIndex - 1);
      exitPrice = candles[exitIndex]!.close;
      if (signal.direction === 'CALL') {
        outcome = exitPrice >= entryPrice ? 'WIN' : 'LOSS';
      } else {
        outcome = exitPrice <= entryPrice ? 'WIN' : 'LOSS';
      }
    }

    const finalPnlPct = signal.direction === 'CALL'
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;
    const priceDiff = signal.direction === 'CALL'
      ? (exitPrice - entryPrice) / entryPrice * 100
      : (entryPrice - exitPrice) / entryPrice * 100;
    const pnl = priceDiff > 0 ? stake * multiplier * (priceDiff / 100) : -stake;

    const opportunityLost = maxFavorablePct - finalPnlPct;
    const opportunityLostPct = maxFavorablePct > 0 
      ? (opportunityLost / maxFavorablePct) * 100 
      : 0;

    equity += pnl;
    cooldownUntil = exitIndex + cooldown;

    trades.push({
      entryIndex: i,
      exitIndex,
      direction: signal.direction,
      entryPrice,
      exitPrice,
      tpPrice,
      slPrice,
      outcome,
      exitReason,
      pnl,
      maxFavorablePct,
      maxFavorablePrice,
      maxFavorableIndex,
      finalPnlPct,
      touchedBBUpper,
      touchedBBLower,
      touchedBBMiddle,
      bbUpperTouchIndex,
      bbLowerTouchIndex,
      bbMiddleTouchIndex,
      maxPrice,
      minPrice,
      priceAtBBUpper,
      priceAtBBLower,
      opportunityLost,
      opportunityLostPct,
    });
  }

  return trades;
}

async function main() {
  const asset = process.argv[2] || 'cryETHUSD';
  const presetName = asset.includes('ETH') ? 'High PF' : 'Conservative';
  const preset = asset.includes('ETH') ? HIGH_PF_PRESET : CONSERVATIVE_PRESET;

  console.log('='.repeat(80));
  console.log(`  ANÁLISIS TP/SL - ${asset}`);
  console.log('='.repeat(80));

  const filepath = path.join(dataDir, `${asset}_1m_90d.csv`);
  if (!fs.existsSync(filepath)) {
    console.error(`Data file not found: ${filepath}`);
    process.exit(1);
  }

  console.log('\n📊 Cargando datos...');
  const candles = loadCandles(filepath);
  console.log(`   Cargadas ${candles.length.toLocaleString()} velas`);

  console.log(`\n💰 Balance inicial: $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`   Stake por trade: ${(INITIAL_CAPITAL * STAKE_PCT * 100).toFixed(1)}% = $${(INITIAL_CAPITAL * STAKE_PCT).toFixed(2)}`);

  console.log('\n🔧 Pre-calculando indicadores...');
  const indicatorCache = createIndicatorCache(candles, ['rsi', 'atr', 'adx', 'bb', 'vwap'], {
    rsiPeriod: 14,
    atrPeriod: 14,
    adxPeriod: 14,
    bbPeriod: 20,
    bbStdDev: 2,
  });

  const entryFn = createCryptoScalpV2EntryFn(candles, preset, { enableMTF: true });

  const baseConfig = {
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
  };

  console.log(`\n⚙️  Configuración:`);
  console.log(`   TP: ${baseConfig.tpPct}%`);
  console.log(`   SL: ${baseConfig.slPct}%`);
  console.log(`   Zombie Killer: ${baseConfig.zombieKiller.enabled ? 'Sí' : 'No'}`);

  console.log('\n🔄 Ejecutando backtest con análisis...');
  const trades = analyzeTrades(candles, indicatorCache, entryFn, baseConfig);

  console.log(`\n✅ Analizados ${trades.length} trades\n`);

  // Análisis 1: TP vs SL hit rates
  const tpHits = trades.filter(t => t.exitReason === 'TP').length;
  const slHits = trades.filter(t => t.exitReason === 'SL').length;
  const zombieHits = trades.filter(t => t.exitReason === 'ZOMBIE').length;
  const timeoutHits = trades.filter(t => t.exitReason === 'TIMEOUT').length;

  console.log('='.repeat(80));
  console.log('1. ANÁLISIS DE SALIDAS');
  console.log('='.repeat(80));
  console.log(`   TP hits: ${tpHits} (${(tpHits / trades.length * 100).toFixed(1)}%)`);
  console.log(`   SL hits: ${slHits} (${(slHits / trades.length * 100).toFixed(1)}%)`);
  console.log(`   Zombie Killer: ${zombieHits} (${(zombieHits / trades.length * 100).toFixed(1)}%)`);
  console.log(`   Timeout: ${timeoutHits} (${(timeoutHits / trades.length * 100).toFixed(1)}%)`);

  // Análisis 2: BB touches
  const callTrades = trades.filter(t => t.direction === 'CALL');
  const putTrades = trades.filter(t => t.direction === 'PUT');
  
  const callsTouchingBBUpper = callTrades.filter(t => t.touchedBBUpper).length;
  const putsTouchingBBLower = putTrades.filter(t => t.touchedBBLower).length;
  const callsTouchingBBMiddle = callTrades.filter(t => t.touchedBBMiddle).length;
  const putsTouchingBBMiddle = putTrades.filter(t => t.touchedBBMiddle).length;

  console.log('\n' + '='.repeat(80));
  console.log('2. TOQUES DE BOLLINGER BANDS');
  console.log('='.repeat(80));
  console.log(`\n   CALL trades:`);
  console.log(`   - Total: ${callTrades.length}`);
  console.log(`   - Tocaron BB Superior: ${callsTouchingBBUpper} (${(callsTouchingBBUpper / callTrades.length * 100).toFixed(1)}%)`);
  console.log(`   - Tocaron BB Medio: ${callsTouchingBBMiddle} (${(callsTouchingBBMiddle / callTrades.length * 100).toFixed(1)}%)`);
  
  console.log(`\n   PUT trades:`);
  console.log(`   - Total: ${putTrades.length}`);
  console.log(`   - Tocaron BB Inferior: ${putsTouchingBBLower} (${(putsTouchingBBLower / putTrades.length * 100).toFixed(1)}%)`);
  console.log(`   - Tocaron BB Medio: ${putsTouchingBBMiddle} (${(putsTouchingBBMiddle / putTrades.length * 100).toFixed(1)}%)`);

  // Análisis 3: Oportunidades perdidas
  const winningTrades = trades.filter(t => t.outcome === 'WIN');
  const losingTrades = trades.filter(t => t.outcome === 'LOSS');
  
  const tradesWithOpportunityLost = trades.filter(t => t.opportunityLost > 0.1); // > 0.1% perdido
  const avgOpportunityLost = tradesWithOpportunityLost.length > 0
    ? tradesWithOpportunityLost.reduce((sum, t) => sum + t.opportunityLost, 0) / tradesWithOpportunityLost.length
    : 0;
  
  const callsWithHighGainThenFall = callTrades.filter(t => 
    t.maxFavorablePct > baseConfig.tpPct * 1.5 && // Alcanzó 1.5x el TP
    t.finalPnlPct < t.maxFavorablePct * 0.5 && // Pero cerró con menos del 50% de la ganancia máxima
    t.outcome === 'WIN'
  );

  const putsWithHighGainThenFall = putTrades.filter(t => 
    t.maxFavorablePct > baseConfig.tpPct * 1.5 &&
    t.finalPnlPct < t.maxFavorablePct * 0.5 &&
    t.outcome === 'WIN'
  );

  console.log('\n' + '='.repeat(80));
  console.log('3. OPORTUNIDADES PERDIDAS');
  console.log('='.repeat(80));
  console.log(`   Trades con oportunidad perdida (>0.1%): ${tradesWithOpportunityLost.length} (${(tradesWithOpportunityLost.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`   Ganancia promedio perdida: ${avgOpportunityLost.toFixed(2)}%`);
  
  console.log(`\n   CALLs que alcanzaron alta ganancia y luego cayeron:`);
  console.log(`   - Total: ${callsWithHighGainThenFall.length} (${(callsWithHighGainThenFall.length / callTrades.length * 100).toFixed(1)}% de CALLs)`);
  if (callsWithHighGainThenFall.length > 0) {
    const avgMaxGain = callsWithHighGainThenFall.reduce((sum, t) => sum + t.maxFavorablePct, 0) / callsWithHighGainThenFall.length;
    const avgFinalGain = callsWithHighGainThenFall.reduce((sum, t) => sum + t.finalPnlPct, 0) / callsWithHighGainThenFall.length;
    const avgLost = callsWithHighGainThenFall.reduce((sum, t) => sum + t.opportunityLost, 0) / callsWithHighGainThenFall.length;
    console.log(`   - Ganancia máxima promedio: ${avgMaxGain.toFixed(2)}%`);
    console.log(`   - Ganancia final promedio: ${avgFinalGain.toFixed(2)}%`);
    console.log(`   - Ganancia perdida promedio: ${avgLost.toFixed(2)}%`);
    
    // Cuántos de estos tocaron BB superior
    const touchedBBUpper = callsWithHighGainThenFall.filter(t => t.touchedBBUpper).length;
    console.log(`   - De estos, ${touchedBBUpper} (${(touchedBBUpper / callsWithHighGainThenFall.length * 100).toFixed(0)}%) tocaron BB Superior`);
  }

  console.log(`\n   PUTs que alcanzaron alta ganancia y luego subieron:`);
  console.log(`   - Total: ${putsWithHighGainThenFall.length} (${(putsWithHighGainThenFall.length / putTrades.length * 100).toFixed(1)}% de PUTs)`);
  if (putsWithHighGainThenFall.length > 0) {
    const avgMaxGain = putsWithHighGainThenFall.reduce((sum, t) => sum + t.maxFavorablePct, 0) / putsWithHighGainThenFall.length;
    const avgFinalGain = putsWithHighGainThenFall.reduce((sum, t) => sum + t.finalPnlPct, 0) / putsWithHighGainThenFall.length;
    const avgLost = putsWithHighGainThenFall.reduce((sum, t) => sum + t.opportunityLost, 0) / putsWithHighGainThenFall.length;
    console.log(`   - Ganancia máxima promedio: ${avgMaxGain.toFixed(2)}%`);
    console.log(`   - Ganancia final promedio: ${avgFinalGain.toFixed(2)}%`);
    console.log(`   - Ganancia perdida promedio: ${avgLost.toFixed(2)}%`);
    
    const touchedBBLower = putsWithHighGainThenFall.filter(t => t.touchedBBLower).length;
    console.log(`   - De estos, ${touchedBBLower} (${(touchedBBLower / putsWithHighGainThenFall.length * 100).toFixed(0)}%) tocaron BB Inferior`);
  }

  // Análisis 4: CALLs que tocaron BB superior pero no cerraron ahí
  const callsTouchingBBUpperNotClosed = callTrades.filter(t => 
    t.touchedBBUpper && 
    t.exitReason !== 'TP' && 
    t.bbUpperTouchIndex !== null &&
    (t.bbUpperTouchIndex! < t.exitIndex || t.exitReason === 'ZOMBIE' || t.exitReason === 'TIMEOUT')
  );

  console.log('\n' + '='.repeat(80));
  console.log('4. ANÁLISIS: CERRAR EN BB SUPERIOR/INFERIOR');
  console.log('='.repeat(80));
  console.log(`\n   CALLs que tocaron BB Superior pero NO cerraron ahí:`);
  console.log(`   - Total: ${callsTouchingBBUpperNotClosed.length} (${(callsTouchingBBUpperNotClosed.length / callTrades.length * 100).toFixed(1)}% de CALLs)`);
  
  if (callsTouchingBBUpperNotClosed.length > 0) {
    const winsIfClosedAtBB = callsTouchingBBUpperNotClosed.filter(t => {
      if (t.priceAtBBUpper === null) return false;
      const pnlAtBB = ((t.priceAtBBUpper - t.entryPrice) / t.entryPrice) * 100;
      return pnlAtBB > 0;
    }).length;
    
    const avgPnlAtBB = callsTouchingBBUpperNotClosed
      .filter(t => t.priceAtBBUpper !== null)
      .reduce((sum, t) => {
        const pnlAtBB = ((t.priceAtBBUpper! - t.entryPrice) / t.entryPrice) * 100;
        return sum + pnlAtBB;
      }, 0) / callsTouchingBBUpperNotClosed.filter(t => t.priceAtBBUpper !== null).length;
    
    const avgFinalPnl = callsTouchingBBUpperNotClosed.reduce((sum, t) => sum + t.finalPnlPct, 0) / callsTouchingBBUpperNotClosed.length;
    
    console.log(`   - Si hubieran cerrado en BB Superior:`);
    console.log(`     * Ganarían: ${winsIfClosedAtBB} (${(winsIfClosedAtBB / callsTouchingBBUpperNotClosed.length * 100).toFixed(1)}%)`);
    console.log(`     * Ganancia promedio: ${avgPnlAtBB.toFixed(2)}%`);
    console.log(`   - Ganancia final real promedio: ${avgFinalPnl.toFixed(2)}%`);
    console.log(`   - Diferencia: ${(avgPnlAtBB - avgFinalPnl).toFixed(2)}% por trade`);
    
    // Calcular PnL total si hubieran cerrado en BB
    const totalPnlAtBB = callsTouchingBBUpperNotClosed
      .filter(t => t.priceAtBBUpper !== null)
      .reduce((sum, t) => {
        const pnlAtBB = ((t.priceAtBBUpper! - t.entryPrice) / t.entryPrice) * 100;
        const stake = INITIAL_CAPITAL * STAKE_PCT;
        return sum + (pnlAtBB > 0 ? stake * MULTIPLIER * (pnlAtBB / 100) : -stake);
      }, 0);
    
    const totalPnlReal = callsTouchingBBUpperNotClosed.reduce((sum, t) => sum + t.pnl, 0);
    console.log(`   - PnL total si cerraran en BB: $${totalPnlAtBB.toFixed(2)}`);
    console.log(`   - PnL total real: $${totalPnlReal.toFixed(2)}`);
    console.log(`   - Mejora potencial: $${(totalPnlAtBB - totalPnlReal).toFixed(2)}`);
  }

  // Análisis 5: Distribución de ganancias
  console.log('\n' + '='.repeat(80));
  console.log('5. DISTRIBUCIÓN DE GANANCIAS');
  console.log('='.repeat(80));
  
  const winningCalls = callTrades.filter(t => t.outcome === 'WIN');
  const losingCalls = callTrades.filter(t => t.outcome === 'LOSS');
  
  if (winningCalls.length > 0) {
    const avgWinCall = winningCalls.reduce((sum, t) => sum + t.finalPnlPct, 0) / winningCalls.length;
    const maxWinCall = Math.max(...winningCalls.map(t => t.finalPnlPct));
    const minWinCall = Math.min(...winningCalls.map(t => t.finalPnlPct));
    console.log(`\n   CALLs ganadores:`);
    console.log(`   - Promedio: ${avgWinCall.toFixed(2)}%`);
    console.log(`   - Máximo: ${maxWinCall.toFixed(2)}%`);
    console.log(`   - Mínimo: ${minWinCall.toFixed(2)}%`);
  }
  
  if (losingCalls.length > 0) {
    const avgLossCall = losingCalls.reduce((sum, t) => sum + Math.abs(t.finalPnlPct), 0) / losingCalls.length;
    console.log(`\n   CALLs perdedores:`);
    console.log(`   - Pérdida promedio: ${avgLossCall.toFixed(2)}%`);
  }

  // Resumen y recomendaciones
  console.log('\n' + '='.repeat(80));
  console.log('📋 RESUMEN Y RECOMENDACIONES');
  console.log('='.repeat(80));
  
  console.log(`\n✅ Hallazgos clave:`);
  console.log(`   1. ${callsTouchingBBUpper} de ${callTrades.length} CALLs (${(callsTouchingBBUpper / callTrades.length * 100).toFixed(1)}%) tocan BB Superior`);
  console.log(`   2. ${callsWithHighGainThenFall.length} CALLs alcanzaron alta ganancia y luego cayeron`);
  console.log(`   3. ${callsTouchingBBUpperNotClosed.length} CALLs tocaron BB Superior pero no cerraron ahí`);
  
  if (callsTouchingBBUpperNotClosed.length > 0 && callsTouchingBBUpperNotClosed.length / callTrades.length > 0.1) {
    console.log(`\n💡 RECOMENDACIÓN:`);
    console.log(`   Considerar cerrar CALLs cuando toquen BB Superior (exitOnBBUpper)`);
    console.log(`   - Potencial mejora: ~$${(callsTouchingBBUpperNotClosed.reduce((sum, t) => {
      if (t.priceAtBBUpper === null) return sum;
      const pnlAtBB = ((t.priceAtBBUpper - t.entryPrice) / t.entryPrice) * 100;
      const stake = INITIAL_CAPITAL * STAKE_PCT;
      const pnlAtBBValue = pnlAtBB > 0 ? stake * MULTIPLIER * (pnlAtBB / 100) : -stake;
      return sum + (pnlAtBBValue - t.pnl);
    }, 0)).toFixed(2)}`);
    console.log(`   - Esto afectaría ${callsTouchingBBUpperNotClosed.length} trades`);
  }
  
  console.log('\n');
}

main().catch(console.error);
