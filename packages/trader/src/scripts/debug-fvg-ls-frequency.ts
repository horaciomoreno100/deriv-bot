/**
 * Debug: Why so few trades in FVG-LS strategy?
 */
import * as fs from 'fs';
import * as path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'R_75_1m_90d.csv');
const content = fs.readFileSync(dataPath, 'utf-8');
const lines = content.trim().split('\n');
const candles: Array<{high: number; low: number; close: number}> = [];

for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split(',');
  candles.push({
    high: parseFloat(parts[2]),
    low: parseFloat(parts[3]),
    close: parseFloat(parts[4]),
  });
}

// Detectar swings
const swingLength = 5;
const swings: Array<{index: number; type: string; level: number}> = [];

for (let i = swingLength; i < candles.length - swingLength; i++) {
  const c = candles[i];
  let isHigh = true, isLow = true;
  for (let j = 1; j <= swingLength; j++) {
    if (c.high <= candles[i-j].high || c.high <= candles[i+j].high) isHigh = false;
    if (c.low >= candles[i-j].low || c.low >= candles[i+j].low) isLow = false;
  }
  if (isHigh) swings.push({ index: i, type: 'high', level: c.high });
  if (isLow) swings.push({ index: i, type: 'low', level: c.low });
}

// Calcular rango de precios
let maxP = candles[0].high, minP = candles[0].low;
for (const c of candles) {
  if (c.high > maxP) maxP = c.high;
  if (c.low < minP) minP = c.low;
}
const priceRange = maxP - minP;

console.log('Price range:', minP.toFixed(2), '-', maxP.toFixed(2), '=', priceRange.toFixed(2));
console.log('Total swings:', swings.length);

// Probar diferentes liquidityRangePct
console.log('\n=== ZONAS POR liquidityRangePct ===');

function groupSwings(swingList: typeof swings, tolerance: number) {
  const groups: (typeof swings)[] = [];
  const used = new Set<number>();

  for (let i = 0; i < swingList.length; i++) {
    if (used.has(i)) continue;
    const group = [swingList[i]];
    used.add(i);

    for (let j = i + 1; j < swingList.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(swingList[i].level - swingList[j].level) <= tolerance) {
        group.push(swingList[j]);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups.filter(g => g.length >= 2);
}

const highs = swings.filter(s => s.type === 'high');
const lows = swings.filter(s => s.type === 'low');

for (const pct of [0.002, 0.004, 0.006, 0.008, 0.01, 0.015, 0.02, 0.03, 0.05]) {
  const tol = priceRange * pct;
  const bsl = groupSwings(highs, tol).length;
  const ssl = groupSwings(lows, tol).length;
  const pctStr = (pct*100).toFixed(1).padStart(4);
  const totalStr = (bsl + ssl).toString().padStart(4);
  console.log(`${pctStr}%: ${totalStr} zonas (BSL: ${bsl}, SSL: ${ssl}) | tol: ${tol.toFixed(2)}`);
}

// Problema de requireCloseBack
console.log('\n=== PROBLEMA: requireCloseBack ===');
console.log('Para un sweep válido:');
console.log('- SSL: precio debe romper ABAJO y cerrar ARRIBA de la zona');
console.log('- BSL: precio debe romper ARRIBA y cerrar ABAJO de la zona');
console.log('Esto es MUY raro en 1 sola vela de 1 minuto!');
console.log('');
console.log('=== SOLUCIONES ===');
console.log('1. requireCloseBack = false');
console.log('2. Usar timeframe mayor (5min, 15min)');
console.log('3. Aumentar liquidityRangePct para más zonas');
console.log('4. Reducir minSwingsForZone a 1');
