#!/usr/bin/env npx tsx
/**
 * MTF Analysis with Volume Proxy
 *
 * Sin volumen real en forex OTC, usamos proxies:
 * 1. Candle Range (high - low) = actividad
 * 2. Body Ratio (body / range) = quién ganó la pelea
 * 3. Delta Proxy = si cuerpo es verde/rojo con rango grande = presión compradora/vendedora
 *
 * Estrategia:
 * - HTF (15m): Identificar zonas de S/R y tendencia
 * - MTF (5m): Buscar patrones de reversión con "volumen" alto
 * - LTF (1m): Confirmar entrada con vela fuerte en la dirección
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCandlesFromCSV } from '../backtest/index.js';
import { resampleCandles } from '../utils/resampler.js';
import type { Candle } from '@deriv-bot/shared';

// Configuration
const ASSET = process.env.ASSET ?? 'frxEURUSD';
const DATA_FILE = process.env.DATA_FILE ?? 'data/frxEURUSD_1m_365d.csv';
const LOOKBACK = parseInt(process.env.LOOKBACK ?? '1440', 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'analysis-output';

interface VolumeCandle extends Candle {
  range: number;
  body: number;
  bodyRatio: number;
  direction: 'bull' | 'bear' | 'doji';
  volumeProxy: number; // Normalized range (0-100)
  delta: number; // Positive = buyers won, Negative = sellers won
  isHighVolume: boolean;
}

interface MTFSignal {
  index: number;
  timestamp: number;
  price: number;
  direction: 'long' | 'short';
  htfBias: 'bullish' | 'bearish' | 'neutral';
  mtfPattern: string;
  ltfConfirmation: boolean;
  volumeStrength: number;
  outcome?: {
    maxFavorable: number;
    maxAdverse: number;
    result: 'win' | 'loss' | 'pending';
  };
}

/**
 * Calculate volume proxy metrics for candles
 */
function addVolumeProxy(candles: Candle[], avgPeriod: number = 20): VolumeCandle[] {
  const result: VolumeCandle[] = [];

  // Calculate average range for normalization
  let avgRange = 0;
  for (let i = 0; i < Math.min(avgPeriod, candles.length); i++) {
    avgRange += candles[i]!.high - candles[i]!.low;
  }
  avgRange /= Math.min(avgPeriod, candles.length);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const bodyRatio = range > 0 ? body / range : 0;

    // Update rolling average
    if (i >= avgPeriod) {
      avgRange = 0;
      for (let j = i - avgPeriod; j < i; j++) {
        avgRange += candles[j]!.high - candles[j]!.low;
      }
      avgRange /= avgPeriod;
    }

    // Direction
    let direction: 'bull' | 'bear' | 'doji';
    if (bodyRatio < 0.1) {
      direction = 'doji';
    } else if (c.close > c.open) {
      direction = 'bull';
    } else {
      direction = 'bear';
    }

    // Volume proxy (normalized range 0-100)
    const volumeProxy = avgRange > 0 ? Math.min(100, (range / avgRange) * 50) : 50;

    // Delta proxy: body size * direction
    // Positive = buyers winning, Negative = sellers winning
    const delta = direction === 'bull' ? bodyRatio * volumeProxy :
                  direction === 'bear' ? -bodyRatio * volumeProxy : 0;

    // High volume = range > 1.5x average
    const isHighVolume = range > avgRange * 1.5;

    result.push({
      ...c,
      range,
      body,
      bodyRatio,
      direction,
      volumeProxy,
      delta,
      isHighVolume,
    });
  }

  return result;
}

/**
 * Detect HTF bias (trend direction from 15m)
 */
function getHTFBias(candles15m: VolumeCandle[]): 'bullish' | 'bearish' | 'neutral' {
  if (candles15m.length < 10) return 'neutral';

  // Use last 10 candles
  const recent = candles15m.slice(-10);

  // Calculate cumulative delta
  let cumDelta = 0;
  for (const c of recent) {
    cumDelta += c.delta;
  }

  // Simple trend: compare close vs open of period
  const startPrice = recent[0]!.open;
  const endPrice = recent[recent.length - 1]!.close;
  const priceDelta = endPrice - startPrice;

  if (cumDelta > 50 && priceDelta > 0) return 'bullish';
  if (cumDelta < -50 && priceDelta < 0) return 'bearish';
  return 'neutral';
}

/**
 * Find reversal patterns on MTF (5m) with high volume
 */
function findMTFReversalPatterns(
  candles5m: VolumeCandle[],
  htfBias: 'bullish' | 'bearish' | 'neutral'
): { index: number; pattern: string; direction: 'long' | 'short' }[] {
  const patterns: { index: number; pattern: string; direction: 'long' | 'short' }[] = [];

  for (let i = 2; i < candles5m.length - 1; i++) {
    const c = candles5m[i]!;
    const prev = candles5m[i - 1]!;
    const prev2 = candles5m[i - 2]!;

    // Only trade with high volume candles
    if (!c.isHighVolume && !prev.isHighVolume) continue;

    // BULLISH REVERSAL: Red candle(s) followed by strong green with high volume
    if (
      (htfBias === 'bullish' || htfBias === 'neutral') &&
      prev.direction === 'bear' &&
      c.direction === 'bull' &&
      c.bodyRatio > 0.6 &&
      c.isHighVolume &&
      c.delta > 30
    ) {
      patterns.push({ index: i, pattern: 'BULL_REV', direction: 'long' });
    }

    // BEARISH REVERSAL: Green candle(s) followed by strong red with high volume
    if (
      (htfBias === 'bearish' || htfBias === 'neutral') &&
      prev.direction === 'bull' &&
      c.direction === 'bear' &&
      c.bodyRatio > 0.6 &&
      c.isHighVolume &&
      c.delta < -30
    ) {
      patterns.push({ index: i, pattern: 'BEAR_REV', direction: 'short' });
    }

    // ENGULFING with volume
    if (
      (htfBias === 'bullish' || htfBias === 'neutral') &&
      prev.direction === 'bear' &&
      c.direction === 'bull' &&
      c.body > prev.body * 1.5 &&
      c.close > prev.open &&
      c.isHighVolume
    ) {
      patterns.push({ index: i, pattern: 'BULL_ENG', direction: 'long' });
    }

    if (
      (htfBias === 'bearish' || htfBias === 'neutral') &&
      prev.direction === 'bull' &&
      c.direction === 'bear' &&
      c.body > prev.body * 1.5 &&
      c.close < prev.open &&
      c.isHighVolume
    ) {
      patterns.push({ index: i, pattern: 'BEAR_ENG', direction: 'short' });
    }
  }

  return patterns;
}

/**
 * Confirm entry on LTF (1m)
 */
function confirmOnLTF(
  candles1m: VolumeCandle[],
  mtfIndex: number,
  direction: 'long' | 'short',
  mtfTimestamp: number
): { confirmed: boolean; index: number; strength: number } {
  // Find corresponding 1m candles (5m = 5 1m candles)
  // Look for confirmation in the next few 1m candles after the 5m signal

  for (let i = 0; i < candles1m.length; i++) {
    const c = candles1m[i]!;
    if (c.timestamp < mtfTimestamp) continue;
    if (c.timestamp > mtfTimestamp + 300) break; // Only look 5 minutes ahead

    if (direction === 'long') {
      // Strong bullish 1m candle with high volume
      if (c.direction === 'bull' && c.bodyRatio > 0.5 && c.delta > 20) {
        return { confirmed: true, index: i, strength: c.delta };
      }
    } else {
      // Strong bearish 1m candle with high volume
      if (c.direction === 'bear' && c.bodyRatio > 0.5 && c.delta < -20) {
        return { confirmed: true, index: i, strength: Math.abs(c.delta) };
      }
    }
  }

  return { confirmed: false, index: -1, strength: 0 };
}

/**
 * Calculate outcome
 */
function calculateOutcome(
  candles: VolumeCandle[],
  signalIndex: number,
  direction: 'long' | 'short',
  entryPrice: number,
  lookAhead: number = 30
): MTFSignal['outcome'] {
  let maxFavorable = 0;
  let maxAdverse = 0;

  for (let i = 1; i <= lookAhead && signalIndex + i < candles.length; i++) {
    const c = candles[signalIndex + i]!;

    if (direction === 'long') {
      maxFavorable = Math.max(maxFavorable, c.high - entryPrice);
      maxAdverse = Math.max(maxAdverse, entryPrice - c.low);
    } else {
      maxFavorable = Math.max(maxFavorable, entryPrice - c.low);
      maxAdverse = Math.max(maxAdverse, c.high - entryPrice);
    }
  }

  const result = maxFavorable >= maxAdverse * 1.5 ? 'win' :
                 maxAdverse > maxFavorable ? 'loss' : 'pending';

  return { maxFavorable, maxAdverse, result };
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function filterContinuousCandles(allCandles: Candle[], maxCandles: number): Candle[] {
  if (allCandles.length === 0) return [];

  const result: Candle[] = [];
  let prevTimestamp = allCandles[allCandles.length - 1]!.timestamp;

  for (let i = allCandles.length - 1; i >= 0 && result.length < maxCandles; i--) {
    const candle = allCandles[i]!;
    const gap = prevTimestamp - candle.timestamp;

    if (gap > 120 && result.length > 0) {
      break;
    }

    result.unshift(candle);
    prevTimestamp = candle.timestamp;
  }

  return result;
}

function generateHTML(
  candles1m: VolumeCandle[],
  signals: MTFSignal[],
  asset: string
): string {
  const timestamps = candles1m.map((c) => formatTimestamp(c.timestamp));
  const opens = candles1m.map((c) => c.open);
  const highs = candles1m.map((c) => c.high);
  const lows = candles1m.map((c) => c.low);
  const closes = candles1m.map((c) => c.close);
  const volumeProxy = candles1m.map((c) => c.volumeProxy);
  const delta = candles1m.map((c) => c.delta);

  // Stats
  const wins = signals.filter(s => s.outcome?.result === 'win').length;
  const losses = signals.filter(s => s.outcome?.result === 'loss').length;
  const winRate = signals.length > 0 ? ((wins / signals.length) * 100).toFixed(1) : '0';

  // Signal annotations
  const signalAnnotations = signals.map((sig) => {
    const idx = sig.index;
    const arrow = sig.direction === 'long' ? '⬆️' : '⬇️';
    const outcomeEmoji = sig.outcome?.result === 'win' ? '✅' :
                         sig.outcome?.result === 'loss' ? '❌' : '⏳';
    const label = `${arrow} ${sig.mtfPattern} ${outcomeEmoji}`;

    let bgcolor: string;
    if (sig.outcome?.result === 'win') {
      bgcolor = '#00cc00';
    } else if (sig.outcome?.result === 'loss') {
      bgcolor = '#cc0000';
    } else {
      bgcolor = '#666666';
    }

    return {
      x: timestamps[idx],
      y: sig.direction === 'long' ? lows[idx]! * 0.9998 : highs[idx]! * 1.0002,
      text: label,
      showarrow: true,
      arrowhead: 2,
      ax: 0,
      ay: sig.direction === 'long' ? 35 : -35,
      font: { size: 10, color: 'white' },
      bgcolor,
      bordercolor: 'white',
    };
  });

  return `<!DOCTYPE html>
<html>
<head>
  <title>MTF Volume Analysis - ${asset}</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d4ff; margin-bottom: 10px; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-box { background: #16213e; padding: 15px 25px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .stat-label { font-size: 12px; color: #888; margin-top: 5px; }
    .chart-container { background: #0f0f23; border-radius: 8px; padding: 10px; margin-bottom: 20px; }
    .info-box { background: #16213e; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>📊 MTF Volume Analysis - ${asset}</h1>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-value">${candles1m.length}</div>
      <div class="stat-label">1M Candles</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ffcc00">${signals.length}</div>
      <div class="stat-label">Signals</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #00ff00">${wins}</div>
      <div class="stat-label">✅ Wins</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: #ff4444">${losses}</div>
      <div class="stat-label">❌ Losses</div>
    </div>
    <div class="stat-box">
      <div class="stat-value" style="color: ${parseFloat(winRate) >= 50 ? '#00ff00' : '#ff4444'}">${winRate}%</div>
      <div class="stat-label">Win Rate</div>
    </div>
  </div>

  <div class="info-box">
    <h3 style="margin: 0 0 10px 0; color: #00d4ff;">📈 MTF con Volume Proxy</h3>
    <p style="margin: 5px 0; font-size: 14px;">
      <strong>Sin volumen real</strong>, usamos el rango de vela (high-low) como proxy de actividad.
    </p>
    <p style="margin: 5px 0; font-size: 14px;">
      <strong>Delta Proxy</strong> = Body ratio × Volume proxy × Dirección. Verde = compradores, Rojo = vendedores.
    </p>
    <p style="margin: 5px 0; font-size: 14px;">
      <strong>Estrategia</strong>: HTF(15m) bias → MTF(5m) patrón con alto volumen → LTF(1m) confirmación
    </p>
  </div>

  <div class="chart-container">
    <div id="priceChart" style="height: 400px;"></div>
  </div>

  <div class="chart-container">
    <div id="volumeChart" style="height: 150px;"></div>
  </div>

  <div class="chart-container">
    <div id="deltaChart" style="height: 150px;"></div>
  </div>

  <script>
    // Price chart
    const candlestick = {
      x: ${JSON.stringify(timestamps)},
      open: ${JSON.stringify(opens)},
      high: ${JSON.stringify(highs)},
      low: ${JSON.stringify(lows)},
      close: ${JSON.stringify(closes)},
      type: 'candlestick',
      name: '${asset}',
      increasing: { line: { color: '#26a69a' } },
      decreasing: { line: { color: '#ef5350' } },
    };

    const priceLayout = {
      title: 'Price with MTF Signals',
      xaxis: { rangeslider: { visible: false }, color: '#888' },
      yaxis: { title: 'Price', color: '#888', side: 'right' },
      annotations: ${JSON.stringify(signalAnnotations)},
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: false,
      margin: { t: 40, b: 30, l: 50, r: 60 },
    };

    Plotly.newPlot('priceChart', [candlestick], priceLayout, { responsive: true, scrollZoom: true });

    // Volume proxy chart
    const volumeColors = ${JSON.stringify(candles1m.map(c => c.isHighVolume ? '#ffcc00' : '#444'))};
    const volumeTrace = {
      x: ${JSON.stringify(timestamps)},
      y: ${JSON.stringify(volumeProxy)},
      type: 'bar',
      marker: { color: volumeColors },
      name: 'Volume Proxy',
    };

    const volumeLayout = {
      title: 'Volume Proxy (Candle Range)',
      xaxis: { color: '#888' },
      yaxis: { title: 'Volume', color: '#888' },
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: false,
      margin: { t: 30, b: 30, l: 50, r: 60 },
    };

    Plotly.newPlot('volumeChart', [volumeTrace], volumeLayout, { responsive: true });

    // Delta chart
    const deltaColors = ${JSON.stringify(candles1m.map(c => c.delta > 0 ? '#26a69a' : '#ef5350'))};
    const deltaTrace = {
      x: ${JSON.stringify(timestamps)},
      y: ${JSON.stringify(delta)},
      type: 'bar',
      marker: { color: deltaColors },
      name: 'Delta',
    };

    const deltaLayout = {
      title: 'Delta Proxy (Buyer/Seller Pressure)',
      xaxis: { color: '#888' },
      yaxis: { title: 'Delta', color: '#888' },
      paper_bgcolor: '#0f0f23',
      plot_bgcolor: '#0f0f23',
      font: { color: '#eee' },
      showlegend: false,
      margin: { t: 30, b: 30, l: 50, r: 60 },
      shapes: [{ type: 'line', x0: '${timestamps[0]}', x1: '${timestamps[timestamps.length - 1]}', y0: 0, y1: 0, line: { color: '#666', dash: 'dot' } }],
    };

    Plotly.newPlot('deltaChart', [deltaTrace], deltaLayout, { responsive: true });
  </script>
</body>
</html>`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           MTF Volume Proxy Analysis');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log();

  // Load 1m data
  const dataPath = path.join(process.cwd(), DATA_FILE);
  console.log(`📂 Loading from: ${DATA_FILE}`);
  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampColumn: 'timestamp',
    timestampFormat: 'unix_ms',
  });

  console.log(`   ✅ Loaded ${allCandles.length} candles`);

  const rawCandles = filterContinuousCandles(allCandles, LOOKBACK);
  console.log(`   📊 Using ${rawCandles.length} continuous candles`);

  if (rawCandles.length === 0) {
    console.log('No candles found!');
    return;
  }

  // Add volume proxy to 1m
  const candles1m = addVolumeProxy(rawCandles, 20);

  // Resample to 5m and 15m
  console.log('\n🔄 Resampling to MTF...');
  const candles5m = addVolumeProxy(resampleCandles(rawCandles, 'M5'), 20);
  const candles15m = addVolumeProxy(resampleCandles(rawCandles, 'M15'), 20);
  console.log(`   5M: ${candles5m.length} candles`);
  console.log(`   15M: ${candles15m.length} candles`);

  // Get HTF bias
  console.log('\n📈 Analyzing HTF bias...');
  const htfBias = getHTFBias(candles15m);
  console.log(`   HTF Bias: ${htfBias.toUpperCase()}`);

  // Find MTF patterns
  console.log('\n🔍 Finding MTF reversal patterns with high volume...');
  const mtfPatterns = findMTFReversalPatterns(candles5m, htfBias);
  console.log(`   Found ${mtfPatterns.length} potential patterns`);

  // Confirm on LTF and generate signals
  console.log('\n✅ Confirming on LTF...');
  const signals: MTFSignal[] = [];

  for (const pattern of mtfPatterns) {
    const mtfCandle = candles5m[pattern.index]!;
    const confirmation = confirmOnLTF(candles1m, pattern.index, pattern.direction, mtfCandle.timestamp);

    if (confirmation.confirmed) {
      const entryCandle = candles1m[confirmation.index]!;
      signals.push({
        index: confirmation.index,
        timestamp: entryCandle.timestamp,
        price: entryCandle.close,
        direction: pattern.direction,
        htfBias,
        mtfPattern: pattern.pattern,
        ltfConfirmation: true,
        volumeStrength: confirmation.strength,
        outcome: calculateOutcome(candles1m, confirmation.index, pattern.direction, entryCandle.close, 30),
      });
    }
  }

  console.log(`   ✅ ${signals.length} confirmed signals`);

  const wins = signals.filter(s => s.outcome?.result === 'win').length;
  const losses = signals.filter(s => s.outcome?.result === 'loss').length;
  const winRate = signals.length > 0 ? ((wins / signals.length) * 100).toFixed(1) : '0';
  console.log(`   📊 Win Rate: ${winRate}% (${wins}W / ${losses}L)`);

  // Generate HTML
  console.log('\n📝 Generating chart...');
  const html = generateHTML(candles1m, signals, ASSET);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `mtf-volume_${ASSET}_${timestamp}.html`;
  const filepath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, html);
  console.log(`\n✅ Chart saved to: ${filepath}`);
}

main().catch(console.error);
