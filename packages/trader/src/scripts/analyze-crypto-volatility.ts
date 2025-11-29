/**
 * Analyze crypto volatility to determine optimal FVG-LS parameters
 */

import * as fs from 'fs';
import * as path from 'path';

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

function loadCSV(filePath: string): Candle[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 5) {
      candles.push({
        timestamp: parseInt(parts[0]) || new Date(parts[0]).getTime() / 1000,
        open: parseFloat(parts[1]),
        high: parseFloat(parts[2]),
        low: parseFloat(parts[3]),
        close: parseFloat(parts[4]),
      });
    }
  }

  return candles;
}

function analyzeAsset(candles: Candle[], name: string) {
  // Returns
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const ret = Math.abs((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    returns.push(ret);
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

  // ATR as percentage
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atrs.push((tr / candles[i].close) * 100);
  }
  const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length;

  // Candle body size
  const bodies: number[] = [];
  for (const c of candles) {
    bodies.push(Math.abs(c.close - c.open) / c.close * 100);
  }
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;

  // Wick size (potential FVG indicator)
  const wicks: number[] = [];
  for (const c of candles) {
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    wicks.push((upperWick + lowerWick) / c.close * 100);
  }
  const avgWick = wicks.reduce((a, b) => a + b, 0) / wicks.length;

  // Price range for liquidityRangePct calculation
  let maxPrice = candles[0].high;
  let minPrice = candles[0].low;
  for (const c of candles) {
    if (c.high > maxPrice) maxPrice = c.high;
    if (c.low < minPrice) minPrice = c.low;
  }
  const priceRange = ((maxPrice - minPrice) / ((maxPrice + minPrice) / 2)) * 100;

  // Gap detection - potential FVGs
  let fvgCount = 0;
  let totalGapSize = 0;
  for (let i = 2; i < candles.length; i++) {
    // Bullish FVG
    if (candles[i].low > candles[i - 2].high) {
      fvgCount++;
      totalGapSize += (candles[i].low - candles[i - 2].high) / candles[i].close * 100;
    }
    // Bearish FVG
    if (candles[i].high < candles[i - 2].low) {
      fvgCount++;
      totalGapSize += (candles[i - 2].low - candles[i].high) / candles[i].close * 100;
    }
  }
  const avgGapSize = fvgCount > 0 ? totalGapSize / fvgCount : 0;
  const fvgFrequency = (fvgCount / candles.length) * 100;

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`${name}`);
  console.log('═'.repeat(50));
  console.log(`Candles: ${candles.length.toLocaleString()}`);
  console.log(`Price: $${candles[0].close.toFixed(2)} → $${candles[candles.length - 1].close.toFixed(2)}`);
  console.log(`\nVolatility Metrics:`);
  console.log(`  Avg Return: ${(avgReturn * 100).toFixed(4)}%`);
  console.log(`  Avg ATR: ${avgATR.toFixed(4)}%`);
  console.log(`  Avg Body: ${avgBody.toFixed(4)}%`);
  console.log(`  Avg Wick: ${avgWick.toFixed(4)}%`);
  console.log(`  Price Range: ${priceRange.toFixed(2)}%`);
  console.log(`\nFVG Analysis:`);
  console.log(`  FVG Count: ${fvgCount}`);
  console.log(`  FVG Frequency: ${fvgFrequency.toFixed(2)}% of candles`);
  console.log(`  Avg Gap Size: ${avgGapSize.toFixed(4)}%`);

  console.log(`\n📊 Recommended Parameters:`);
  console.log(`  minFVGSizePct: ${(avgGapSize * 0.5).toFixed(5)} (50% of avg gap)`);
  console.log(`  liquidityRangePct: ${(avgATR * 5).toFixed(4)} (5x ATR)`);
  console.log(`  stopLossBufferPct: ${(avgATR * 1.5).toFixed(4)} (1.5x ATR)`);

  return {
    avgATR,
    avgBody,
    avgWick,
    avgGapSize,
    fvgFrequency,
    priceRange,
  };
}

// Main
const dataDir = path.join(process.cwd(), 'data');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     CRYPTO VOLATILITY ANALYSIS FOR FVG-LS                  ║');
console.log('╚════════════════════════════════════════════════════════════╝');

// Analyze all available assets
const assets = [
  { file: 'cryBTCUSD_1m_90d.csv', name: 'Bitcoin (BTC)' },
  { file: 'cryETHUSD_1m_90d.csv', name: 'Ethereum (ETH)' },
  { file: 'R_75_60s_30d.csv', name: 'R_75 (Synthetic - Reference)' },
  { file: 'R_100_60s_30d.csv', name: 'R_100 (Synthetic - Reference)' },
];

const results: Record<string, ReturnType<typeof analyzeAsset>> = {};

for (const asset of assets) {
  const filePath = path.join(dataDir, asset.file);
  if (fs.existsSync(filePath)) {
    const candles = loadCSV(filePath);
    results[asset.name] = analyzeAsset(candles, asset.name);
  } else {
    console.log(`\n⚠️ File not found: ${asset.file}`);
  }
}

// Comparison table
console.log('\n\n' + '═'.repeat(70));
console.log('COMPARISON TABLE');
console.log('═'.repeat(70));
console.log('┌─────────────────────────┬──────────┬──────────┬──────────┬──────────┐');
console.log('│ Asset                   │ Avg ATR  │ Avg Body │ FVG Freq │ Gap Size │');
console.log('├─────────────────────────┼──────────┼──────────┼──────────┼──────────┤');

for (const [name, stats] of Object.entries(results)) {
  const shortName = name.length > 23 ? name.substring(0, 20) + '...' : name.padEnd(23);
  console.log(
    `│ ${shortName} │ ${stats.avgATR.toFixed(4)}% │ ${stats.avgBody.toFixed(4)}% │ ${stats.fvgFrequency.toFixed(2)}%    │ ${stats.avgGapSize.toFixed(4)}% │`
  );
}

console.log('└─────────────────────────┴──────────┴──────────┴──────────┴──────────┘');

// Calculate optimal crypto params
const btc = results['Bitcoin (BTC)'];
const eth = results['Ethereum (ETH)'];

if (btc && eth) {
  const avgCryptoATR = (btc.avgATR + eth.avgATR) / 2;
  const avgCryptoGap = (btc.avgGapSize + eth.avgGapSize) / 2;

  console.log('\n\n' + '═'.repeat(70));
  console.log('RECOMMENDED CRYPTO_PARAMS');
  console.log('═'.repeat(70));
  console.log(`
export const CRYPTO_PARAMS: Partial<FVGLiquiditySweepParams> = {
  swingLength: 8,                           // More confirmation needed
  liquidityRangePct: ${(avgCryptoATR * 8 / 100).toFixed(4)},        // ${(avgCryptoATR * 8).toFixed(2)}% range (wider for crypto)
  minSwingsForZone: 2,                      // Keep standard
  minFVGSizePct: ${(avgCryptoGap * 0.3 / 100).toFixed(5)},         // ${(avgCryptoGap * 0.3).toFixed(4)}% minimum gap
  stopLossBufferPct: ${(avgCryptoATR * 2 / 100).toFixed(4)},       // ${(avgCryptoATR * 2).toFixed(2)}% buffer (2x ATR)
  takeProfitRR: 1.5,                        // Lower R:R for higher win rate
  maxBarsAfterSweep: 15,                    // Tighter window
  maxBarsForEntry: 10,                      // Faster entry
  cooldownSeconds: 180,                     // Longer cooldown
  minConfidence: 0.75,                      // Higher confidence threshold
};
`);
}
