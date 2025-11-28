#!/usr/bin/env tsx
/**
 * Análisis Intraday - MTF Levels Strategy
 * 
 * Analiza el comportamiento de la estrategia en un solo día
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadCandlesFromCSV,
  runBacktest,
  createMTFLevelsStrategy,
  exportChart,
} from '../backtest/index.js';

const ASSET = process.env.ASSET || 'frxXAUUSD';
const DATA_FILE = process.env.DATA_FILE || 'data/frxXAUUSD_1m_30d.csv';
const DAYS_TO_ANALYZE = parseInt(process.env.DAYS || '1', 10);

interface HourlyStats {
  hour: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  avgPnl: number;
  maxWin: number;
  maxLoss: number;
}

interface TradeWithHour {
  trade: any;
  hour: number;
  dayOfWeek: number;
  date: string;
}

async function main() {
  console.log('='.repeat(80));
  console.log('ANÁLISIS INTRADAY - MTF Levels Strategy');
  console.log('='.repeat(80));
  console.log(`Asset: ${ASSET}`);
  console.log(`Data: ${DATA_FILE}`);
  console.log(`Días a analizar: ${DAYS_TO_ANALYZE}\n`);

  // Load data
  const dataPath = path.resolve(process.cwd(), DATA_FILE);
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ Archivo no encontrado: ${dataPath}`);
    process.exit(1);
  }

  const allCandles = loadCandlesFromCSV(dataPath, {
    asset: ASSET,
    timeframe: 60,
    timestampFormat: 'unix_ms',
  });

  console.log(`✅ Cargadas ${allCandles.length} velas totales\n`);

  // Get first N days of data
  // Los timestamps en candles están en SEGUNDOS (aunque el CSV esté en ms, se convierte)
  // Necesitamos trabajar en segundos
  const firstCandleTime = allCandles[0]!.timestamp;
  const oneDaySeconds = 24 * 60 * 60;
  const lastCandleTime = firstCandleTime + (DAYS_TO_ANALYZE * oneDaySeconds);
  
  // Filter candles by timestamp range - SOLO los candles dentro del rango
  const candles = allCandles.filter(c => {
    return c.timestamp >= firstCandleTime && c.timestamp < lastCandleTime;
  });
  
  const firstDate = new Date(firstCandleTime * 1000); // Convertir a ms para Date
  const lastDate = new Date(lastCandleTime * 1000);
  console.log(`📅 Período: ${firstDate.toISOString().split('T')[0]} ${firstDate.toISOString().split('T')[1]!.slice(0, 5)} UTC`);
  console.log(`   Hasta: ${lastDate.toISOString().split('T')[0]} ${lastDate.toISOString().split('T')[1]!.slice(0, 5)} UTC`);
  console.log(`   Velas filtradas: ${candles.length} de ${allCandles.length} totales`);
  
  if (candles.length === allCandles.length) {
    console.log(`⚠️  ADVERTENCIA: El filtro no está funcionando, usando todas las velas`);
    console.log(`   Primera vela: ${firstCandleTime} (${firstDate.toISOString()})`);
    console.log(`   Última vela del dataset: ${allCandles[allCandles.length - 1]!.timestamp} (${new Date(allCandles[allCandles.length - 1]!.timestamp * 1000).toISOString()})\n`);
  } else {
    console.log(`✅ Filtro aplicado correctamente\n`);
  }
  
  console.log(`📅 Analizando ${DAYS_TO_ANALYZE} día(s): ${candles.length} velas\n`);

  // Run backtest with IMPROVED v3 config (con filtro BB)
  const strategy = createMTFLevelsStrategy(ASSET, {
    requireTrendAlignment: false,
    allowedDirection: 'both',
    cooldownBars: 6,
    confirmationBars: 1,
    confirmationBarsPUT: 1,
    confirmationMinMove: 0.2,
    confirmationMinMoveAgainstTrend: 0.25,
    levelTolerance: 0.9,
    swingDepth5m: 2,
    swingDepth15m: 2,
    requireStrongLevelAgainstTrend: false,
    requireBBBand: true,  // MEJORA: Filtro de Bollinger Bands
    bbBandTolerance: 0.15, // 15% del ancho de banda
    takeProfitPct: 0.004,
    stopLossPct: 0.003,
  });

  console.log('🔄 Ejecutando backtest...\n');
  const result = runBacktest(strategy, candles, {
    initialBalance: 1000,
    multiplier: 100,
    stakePct: 2,
  });

  const trades = result.trades;
  const wins = trades.filter(t => t.result?.outcome === 'WIN');
  const losses = trades.filter(t => t.result?.outcome === 'LOSS');

  console.log('='.repeat(80));
  console.log('RESUMEN GENERAL');
  console.log('='.repeat(80));
  console.log(`Total trades: ${trades.length}`);
  console.log(`Wins: ${wins.length} (${((wins.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Losses: ${losses.length} (${((losses.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Net PnL: $${result.metrics.netPnl.toFixed(2)}`);
  console.log(`Profit Factor: ${result.metrics.profitFactor.toFixed(2)}`);
  console.log(`Max Drawdown: ${result.metrics.maxDrawdownPct.toFixed(1)}%\n`);

  // Analyze by hour
  const tradesWithHour: TradeWithHour[] = [];
  const hourlyStats: Map<number, HourlyStats> = new Map();

  for (const trade of trades) {
    const entryTime = new Date(trade.entry.snapshot.timestamp);
    const hour = entryTime.getUTCHours();
    const dayOfWeek = entryTime.getUTCDay();
    const date = entryTime.toISOString().split('T')[0]!;

    tradesWithHour.push({ trade, hour, dayOfWeek, date });

    if (!hourlyStats.has(hour)) {
      hourlyStats.set(hour, {
        hour,
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        netPnl: 0,
        avgPnl: 0,
        maxWin: 0,
        maxLoss: 0,
      });
    }

    const stats = hourlyStats.get(hour)!;
    stats.trades++;
    if (trade.result?.outcome === 'WIN') {
      stats.wins++;
      stats.netPnl += trade.result.pnl;
      stats.maxWin = Math.max(stats.maxWin, trade.result.pnl);
    } else {
      stats.losses++;
      stats.netPnl += trade.result?.pnl || 0;
      stats.maxLoss = Math.min(stats.maxLoss, trade.result?.pnl || 0);
    }
  }

  // Calculate win rates and averages
  for (const stats of hourlyStats.values()) {
    stats.winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;
    stats.avgPnl = stats.trades > 0 ? stats.netPnl / stats.trades : 0;
  }

  // Print hourly analysis
  console.log('='.repeat(80));
  console.log('ANÁLISIS POR HORA (UTC)');
  console.log('='.repeat(80));
  console.log(
    'Hora'.padEnd(8) +
    'Trades'.padStart(8) +
    'Wins'.padStart(6) +
    'Losses'.padStart(8) +
    'WR%'.padStart(8) +
    'NetPnL'.padStart(12) +
    'AvgPnL'.padStart(12) +
    'MaxWin'.padStart(10) +
    'MaxLoss'.padStart(10)
  );
  console.log('-'.repeat(80));

  const sortedHours = Array.from(hourlyStats.values()).sort((a, b) => a.hour - b.hour);
  for (const stats of sortedHours) {
    const wrColor = stats.winRate >= 50 ? '✅' : '❌';
    const pnlColor = stats.netPnl >= 0 ? '💰' : '📉';
    
    console.log(
      `${stats.hour.toString().padStart(2, '0')}:00`.padEnd(8) +
      String(stats.trades).padStart(8) +
      String(stats.wins).padStart(6) +
      String(stats.losses).padStart(8) +
      `${stats.winRate.toFixed(1)}%`.padStart(8) +
      `${pnlColor} $${stats.netPnl.toFixed(2)}`.padStart(12) +
      `$${stats.avgPnl.toFixed(2)}`.padStart(12) +
      `$${stats.maxWin.toFixed(2)}`.padStart(10) +
      `$${stats.maxLoss.toFixed(2)}`.padStart(10)
    );
  }

  // Find best and worst hours
  const bestHour = sortedHours.reduce((best, curr) => 
    curr.netPnl > best.netPnl ? curr : best
  );
  const worstHour = sortedHours.reduce((worst, curr) => 
    curr.netPnl < worst.netPnl ? curr : worst
  );

  console.log('\n' + '='.repeat(80));
  console.log('MEJORES Y PEORES HORAS');
  console.log('='.repeat(80));
  console.log(`✅ Mejor hora: ${bestHour.hour}:00 - ${bestHour.trades} trades, WR: ${bestHour.winRate.toFixed(1)}%, PnL: $${bestHour.netPnl.toFixed(2)}`);
  console.log(`❌ Peor hora: ${worstHour.hour}:00 - ${worstHour.trades} trades, WR: ${worstHour.winRate.toFixed(1)}%, PnL: $${worstHour.netPnl.toFixed(2)}\n`);

  // Analyze trade distribution throughout the day
  console.log('='.repeat(80));
  console.log('DISTRIBUCIÓN DE TRADES A LO LARGO DEL DÍA');
  console.log('='.repeat(80));
  
  const tradesByPeriod: Record<string, number> = {
    '00:00-06:00 (Asia)': 0,
    '06:00-12:00 (Europa)': 0,
    '12:00-18:00 (Londres/NY)': 0,
    '18:00-24:00 (NY tarde)': 0,
  };

  for (const { hour } of tradesWithHour) {
    if (hour >= 0 && hour < 6) tradesByPeriod['00:00-06:00 (Asia)']++;
    else if (hour >= 6 && hour < 12) tradesByPeriod['06:00-12:00 (Europa)']++;
    else if (hour >= 12 && hour < 18) tradesByPeriod['12:00-18:00 (Londres/NY)']++;
    else tradesByPeriod['18:00-24:00 (NY tarde)']++;
  }

  for (const [period, count] of Object.entries(tradesByPeriod)) {
    const pct = trades.length > 0 ? (count / trades.length) * 100 : 0;
    console.log(`${period}: ${count} trades (${pct.toFixed(1)}%)`);
  }

  // Show timeline of trades
  console.log('\n' + '='.repeat(80));
  console.log('TIMELINE DE TRADES (primeros 20)');
  console.log('='.repeat(80));
  
  for (let i = 0; i < Math.min(20, trades.length); i++) {
    const { trade, hour, date } = tradesWithHour[i]!;
    const time = new Date(trade.entry.snapshot.timestamp).toISOString().split('T')[1]!.slice(0, 5);
    const outcome = trade.result?.outcome === 'WIN' ? '✅ WIN' : '❌ LOSS';
    const pnl = trade.result?.pnl || 0;
    const direction = trade.direction;
    
    console.log(
      `${date} ${time} UTC (${hour}:00) - ${direction} ${outcome} - $${pnl.toFixed(2)}`
    );
  }

  if (trades.length > 20) {
    console.log(`... y ${trades.length - 20} trades más`);
  }

  // Generate charts
  console.log('\n' + '='.repeat(80));
  console.log('GENERANDO GRÁFICOS');
  console.log('='.repeat(80));
  
  const dateStr = new Date(firstCandleTime).toISOString().split('T')[0]!.replace(/-/g, '');
  const chartFilename = `analysis-output/mtf-levels-${ASSET}-intraday-${dateStr}-${DAYS_TO_ANALYZE}d.html`;
  
  try {
    console.log(`📊 Generando gráfico: ${chartFilename}...`);
    await exportChart(result, chartFilename, {
      title: `MTF Levels - ${ASSET} - ${DAYS_TO_ANALYZE} día(s) - Análisis Intraday`,
      showTrades: true,
      showEquity: true,
    });
    console.log(`✅ Gráfico generado: ${chartFilename}\n`);
  } catch (error) {
    console.error('❌ Error generando gráfico:', error);
  }

  // Generate summary chart with hourly breakdown
  console.log('📊 Generando gráfico de resumen por hora...');
  try {
    const summaryChartFilename = `analysis-output/mtf-levels-${ASSET}-hourly-summary-${dateStr}.html`;
    
    // Create a simple HTML chart for hourly stats
    const hourlyData = sortedHours.map(h => ({
      hour: h.hour,
      trades: h.trades,
      winRate: h.winRate,
      netPnl: h.netPnl,
      avgPnl: h.avgPnl,
    }));

    const html = generateHourlyChartHTML(hourlyData, ASSET, DAYS_TO_ANALYZE);
    fs.writeFileSync(summaryChartFilename, html);
    console.log(`✅ Gráfico de resumen generado: ${summaryChartFilename}\n`);
  } catch (error) {
    console.error('❌ Error generando gráfico de resumen:', error);
  }

  console.log('='.repeat(80));
  console.log('Análisis completado');
  console.log('='.repeat(80));
}

function generateHourlyChartHTML(hourlyData: Array<{hour: number; trades: number; winRate: number; netPnl: number; avgPnl: number}>, asset: string, days: number): string {
  const hours = hourlyData.map(d => d.hour);
  const trades = hourlyData.map(d => d.trades);
  const winRates = hourlyData.map(d => d.winRate);
  const netPnls = hourlyData.map(d => d.netPnl);
  const colors = netPnls.map(pnl => pnl >= 0 ? '#22c55e' : '#ef4444');

  return `<!DOCTYPE html>
<html>
<head>
  <title>MTF Levels - ${asset} - Resumen por Hora</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      color: #e0e0e0;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #888;
      margin-bottom: 30px;
    }
    .chart-container {
      background: #0e0e0e;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>MTF Levels Strategy - Análisis por Hora</h1>
    <div class="subtitle">Asset: ${asset} | Días analizados: ${days}</div>
    
    <div class="chart-container">
      <div id="trades-chart"></div>
    </div>
    
    <div class="chart-container">
      <div id="winrate-chart"></div>
    </div>
    
    <div class="chart-container">
      <div id="pnl-chart"></div>
    </div>
  </div>

  <script>
    const hours = ${JSON.stringify(hours)};
    const trades = ${JSON.stringify(trades)};
    const winRates = ${JSON.stringify(winRates)};
    const netPnls = ${JSON.stringify(netPnls)};
    const colors = ${JSON.stringify(colors)};

    // Trades per hour
    Plotly.newPlot('trades-chart', [{
      x: hours.map(h => h + ':00'),
      y: trades,
      type: 'bar',
      marker: { color: '#3b82f6' },
      name: 'Trades'
    }], {
      title: 'Trades por Hora (UTC)',
      xaxis: { title: 'Hora' },
      yaxis: { title: 'Número de Trades' },
      paper_bgcolor: '#0e0e0e',
      plot_bgcolor: '#0e0e0e',
      font: { color: '#e0e0e0' }
    });

    // Win Rate per hour
    Plotly.newPlot('winrate-chart', [{
      x: hours.map(h => h + ':00'),
      y: winRates,
      type: 'bar',
      marker: { 
        color: winRates.map(wr => wr >= 50 ? '#22c55e' : '#ef4444')
      },
      name: 'Win Rate (%)',
      text: winRates.map(wr => wr.toFixed(1) + '%'),
      textposition: 'outside'
    }], {
      title: 'Win Rate por Hora (UTC)',
      xaxis: { title: 'Hora' },
      yaxis: { title: 'Win Rate (%)', range: [0, 100] },
      paper_bgcolor: '#0e0e0e',
      plot_bgcolor: '#0e0e0e',
      font: { color: '#e0e0e0' }
    });

    // PnL per hour
    Plotly.newPlot('pnl-chart', [{
      x: hours.map(h => h + ':00'),
      y: netPnls,
      type: 'bar',
      marker: { color: colors },
      name: 'Net PnL ($)',
      text: netPnls.map(pnl => '$' + pnl.toFixed(2)),
      textposition: 'outside'
    }], {
      title: 'Net PnL por Hora (UTC)',
      xaxis: { title: 'Hora' },
      yaxis: { title: 'Net PnL ($)' },
      paper_bgcolor: '#0e0e0e',
      plot_bgcolor: '#0e0e0e',
      font: { color: '#e0e0e0' },
      shapes: [{
        type: 'line',
        x0: 0,
        y0: 0,
        x1: 1,
        y1: 0,
        xref: 'paper',
        yref: 'y',
        line: { color: '#666', width: 1, dash: 'dash' }
      }]
    });
  </script>
</body>
</html>`;
}

main().catch(console.error);

