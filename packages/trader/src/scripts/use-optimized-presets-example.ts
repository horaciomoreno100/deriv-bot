#!/usr/bin/env npx tsx
/**
 * Ejemplo de uso de los presets optimizados
 * 
 * Muestra cómo usar ETH_OPTIMIZED_PRESET y BTC_OPTIMIZED_PRESET
 * con todas las optimizaciones aplicadas.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@deriv-bot/shared';
import { FastBacktester } from '../backtest/runners/fast-backtester.js';
import { createCryptoScalpV2EntryFn } from '../backtest/runners/crypto-scalp-v2-fast.js';
import { ETH_OPTIMIZED_PRESET, BTC_OPTIMIZED_PRESET } from '../strategies/crypto-scalp/crypto-scalp.params.js';

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

async function main() {
  console.log('='.repeat(80));
  console.log('  EJEMPLO: USO DE PRESETS OPTIMIZADOS');
  console.log('='.repeat(80));

  // ============================================================================
  // ETH OPTIMIZED PRESET
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('ETH - Preset Optimizado');
  console.log('='.repeat(80));

  const ethFilepath = path.join(dataDir, 'cryETHUSD_1m_90d.csv');
  if (fs.existsSync(ethFilepath)) {
    console.log('\n📊 Cargando datos ETH...');
    const ethCandles = loadCandles(ethFilepath);
    console.log(`   Cargadas ${ethCandles.length.toLocaleString()} velas`);

    console.log('\n🔧 Configurando ETH Optimized Preset...');
    const backtesterETH = new FastBacktester(ethCandles, ['rsi', 'atr', 'adx', 'bb'], {
      rsiPeriod: 14,
      atrPeriod: 14,
      adxPeriod: 14,
      bbPeriod: 20,
      bbStdDev: 2,
    });

    // Crear entry function con MTF habilitado
    const ethEntryFn = createCryptoScalpV2EntryFn(ethCandles, ETH_OPTIMIZED_PRESET, {
      enableMTF: true, // ✅ MTF Filter habilitado
    });

    // Configuración completa con todas las optimizaciones
    const ethConfig = {
      entryFn: ethEntryFn,
      tpPct: ETH_OPTIMIZED_PRESET.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
      slPct: ETH_OPTIMIZED_PRESET.baseStopLossPct ?? 0.2,
      cooldown: ETH_OPTIMIZED_PRESET.cooldownBars ?? 20,
      maxBarsInTrade: ETH_OPTIMIZED_PRESET.maxBarsInTrade ?? 60,
      initialBalance: INITIAL_CAPITAL,
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      startIndex: 50,
      // ✅ Optimizaciones aplicadas
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.05,
        onlyIfReversing: true, // Smart Zombie para ETH
      },
      exitOnBBUpper: true,  // ✅ Cerrar CALLs en BB Superior
      exitOnBBLower: true,  // ✅ Cerrar PUTs en BB Inferior
      bbUpperLowerMinPnl: 0.05, // Solo cerrar si hay ganancia mínima
    };

    console.log('\n⚙️  Configuración aplicada:');
    console.log('   ✅ MTF Filter: Habilitado');
    console.log('   ✅ Zombie Killer: Habilitado (Smart - solo si revierte)');
    console.log('   ✅ BB Upper/Lower Exit: Habilitado');
    console.log('   ✅ Min PnL para BB Exit: 0.05%');

    console.log('\n🔄 Ejecutando backtest...');
    const ethResult = backtesterETH.run(ethConfig);

    console.log('\n📊 Resultados:');
    console.log(`   Trades: ${ethResult.trades}`);
    console.log(`   Wins: ${ethResult.wins} | Losses: ${ethResult.losses}`);
    console.log(`   Win Rate: ${ethResult.winRate.toFixed(1)}%`);
    console.log(`   Net PnL: $${ethResult.netPnl.toFixed(2)}`);
    console.log(`   Profit Factor: ${ethResult.profitFactor.toFixed(2)}`);
    console.log(`   Max Drawdown: ${ethResult.maxDrawdownPct.toFixed(1)}%`);
    console.log(`   Risk:Reward: ${ethResult.riskRewardRatio.toFixed(2)}:1`);
  } else {
    console.log('\n⚠️  Archivo de datos ETH no encontrado');
  }

  // ============================================================================
  // BTC OPTIMIZED PRESET
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('BTC - Preset Optimizado');
  console.log('='.repeat(80));

  const btcFilepath = path.join(dataDir, 'cryBTCUSD_1m_90d.csv');
  if (fs.existsSync(btcFilepath)) {
    console.log('\n📊 Cargando datos BTC...');
    const btcCandles = loadCandles(btcFilepath);
    console.log(`   Cargadas ${btcCandles.length.toLocaleString()} velas`);

    console.log('\n🔧 Configurando BTC Optimized Preset...');
    const backtesterBTC = new FastBacktester(btcCandles, ['rsi', 'atr', 'adx', 'bb'], {
      rsiPeriod: 14,
      atrPeriod: 14,
      adxPeriod: 14,
      bbPeriod: 20,
      bbStdDev: 2,
    });

    // Crear entry function con MTF habilitado
    const btcEntryFn = createCryptoScalpV2EntryFn(btcCandles, BTC_OPTIMIZED_PRESET, {
      enableMTF: true, // ✅ MTF Filter habilitado
    });

    // Configuración completa con optimizaciones (SIN BB Exit)
    const btcConfig = {
      entryFn: btcEntryFn,
      tpPct: BTC_OPTIMIZED_PRESET.takeProfitLevels?.[0]?.profitPercent ?? 0.5,
      slPct: BTC_OPTIMIZED_PRESET.baseStopLossPct ?? 0.2,
      cooldown: BTC_OPTIMIZED_PRESET.cooldownBars ?? 20,
      maxBarsInTrade: BTC_OPTIMIZED_PRESET.maxBarsInTrade ?? 60,
      initialBalance: INITIAL_CAPITAL,
      stakePct: STAKE_PCT,
      multiplier: MULTIPLIER,
      startIndex: 50,
      // ✅ Optimizaciones aplicadas
      zombieKiller: {
        enabled: true,
        bars: 15,
        minPnlPct: 0.1, // BTC necesita umbral más alto
        // NO usar onlyIfReversing para BTC
      },
      // ❌ NO usar exitOnBBUpper/exitOnBBLower para BTC (empeora resultados)
    };

    console.log('\n⚙️  Configuración aplicada:');
    console.log('   ✅ MTF Filter: Habilitado');
    console.log('   ✅ Zombie Killer: Habilitado (umbral 0.1%)');
    console.log('   ❌ BB Upper/Lower Exit: NO habilitado (empeora resultados)');

    console.log('\n🔄 Ejecutando backtest...');
    const btcResult = backtesterBTC.run(btcConfig);

    console.log('\n📊 Resultados:');
    console.log(`   Trades: ${btcResult.trades}`);
    console.log(`   Wins: ${btcResult.wins} | Losses: ${btcResult.losses}`);
    console.log(`   Win Rate: ${btcResult.winRate.toFixed(1)}%`);
    console.log(`   Net PnL: $${btcResult.netPnl.toFixed(2)}`);
    console.log(`   Profit Factor: ${btcResult.profitFactor.toFixed(2)}`);
    console.log(`   Max Drawdown: ${btcResult.maxDrawdownPct.toFixed(1)}%`);
    console.log(`   Risk:Reward: ${btcResult.riskRewardRatio.toFixed(2)}:1`);
  } else {
    console.log('\n⚠️  Archivo de datos BTC no encontrado');
  }

  // ============================================================================
  // RESUMEN
  // ============================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('RESUMEN');
  console.log('='.repeat(80));
  console.log('\n✅ Presets optimizados listos para usar:');
  console.log('   1. ETH_OPTIMIZED_PRESET - Con todas las optimizaciones');
  console.log('   2. BTC_OPTIMIZED_PRESET - Sin BB Exit');
  console.log('\n📚 Ver CRYPTOSCALP_V2_OPTIMIZED_PRESETS.md para más detalles');
  console.log('='.repeat(80));
}

main().catch(console.error);

