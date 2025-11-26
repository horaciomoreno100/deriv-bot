#!/usr/bin/env node
/**
 * Run Vdubus BinaryPro Strategy - Demo Account
 * 
 * Script para probar la estrategia Vdubus BinaryPro en cuenta demo
 */

import dotenv from 'dotenv';
import { GatewayClient } from '@deriv-bot/shared';
import { VdubusBinaryProStrategy } from '../strategies/vdubus-binary-pro.strategy.js';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import type { Candle, Tick, StrategyConfig } from '@deriv-bot/shared';

// Cargar variables de entorno
dotenv.config();

// Configuración
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOL = 'R_100'; // Volatility 100 Index (puedes cambiar a R_75, etc.)
const TIMEFRAME = 60; // 1 minuto
const INITIAL_BALANCE = 10000; // $10,000 demo

// Estado del bot
let balance = INITIAL_BALANCE;
let totalTrades = 0;
let wonTrades = 0;
let lostTrades = 0;
const tradeHistory: any[] = [];

// Buffer de candles
const candleBuffer: Candle[] = [];
let currentCandle: Partial<Candle> | null = null;
let lastCandleTime = 0;

/**
 * Crear y configurar la estrategia Vdubus
 */
function createStrategy(): VdubusBinaryProStrategy {
  const config: StrategyConfig = {
    name: 'Vdubus-BinaryPro-Demo',
    enabled: true,
    assets: [SYMBOL],
    maxConcurrentTrades: 1,
    amount: 1, // 1% del balance
    amountType: 'percentage',
    cooldownSeconds: 180, // 3 minutos
    minConfidence: 0.3, // 30 puntos de score mínimo
    parameters: {
      // Parámetros de Canal
      upperChannelLength: 20,
      lowerChannelLength: 20,
      
      // MA50
      ma50Period: 50,
      
      // Bollinger Bands
      bbLength: 20,
      bbMultiplier: 1.5,
      
      // RSI
      rsiLength: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      
      // Divergencia
      divergenceLookback: 5,
      useDivergence: true,
      
      // Tendencia
      useTrendFilter: false,
      trendSensitivity: 0.02,
      
      // Señales
      tolerance: 0.008, // 0.8%
      enableDynamicTolerance: false,
      minBarsBetweenSignals: 3,
      minScore: 30,
      minScoreCall: 40, // Más estricto para CALL
      enableDynamicMinScoreCall: false,
      onlyStrong: false, // Permitir todas las señales
      enableMid: true,
      requireCandleConfirmation: true,
      requireMomentumForCall: true,
      
      // Simulación
      expiryBars: 2,
      payoutPct: 80,
      
      // Configuración técnica
      candlePeriod: 60, // 1 minuto
      minCandles: 100,
      disableWarmup: false,
      
      // Filtro de horarios
      enableTimeFilter: false,
      optimalHours: {
        start: 8,
        end: 18,
        avoidAsiaForJPY: true,
      },
    },
  };

  return new VdubusBinaryProStrategy(config);
}

/**
 * Procesar tick y construir candle
 */
function processTick(tick: Tick): Candle | null {
  const tickTime = tick.timestamp;
  const candleTime = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);

  // Nueva vela
  if (candleTime !== lastCandleTime) {
    const completedCandle = currentCandle;
    lastCandleTime = candleTime;

    // Iniciar nueva vela
    currentCandle = {
      asset: SYMBOL,
      timeframe: TIMEFRAME,
      timestamp: candleTime / 1000, // Convertir a segundos
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
    };

    // Retornar vela completada si existe
    if (completedCandle && completedCandle.timestamp) {
      return completedCandle as Candle;
    }
  } else if (currentCandle) {
    // Actualizar vela actual
    currentCandle.high = Math.max(currentCandle.high || 0, tick.price);
    currentCandle.low = Math.min(currentCandle.low || Infinity, tick.price);
    currentCandle.close = tick.price;
  }

  return null;
}

/**
 * Simular ejecución de trade
 */
async function executeTrade(
  client: GatewayClient,
  direction: 'CALL' | 'PUT',
  stake: number,
  metadata: any
): Promise<void> {
  totalTrades++;
  console.log(`\n📊 TRADE #${totalTrades}`);
  console.log(`   Direction: ${direction}`);
  console.log(`   Stake: $${stake.toFixed(2)}`);
  console.log(`   Score: ${metadata?.callScore || metadata?.putScore || 'N/A'}`);
  console.log(`   RSI: ${metadata?.rsi?.toFixed(2)}`);
  console.log(`   Price: ${metadata?.price?.toFixed(2)}`);

  try {
    // Ejecutar trade a través del Gateway
    const result = await client.trade({
      asset: SYMBOL,
      direction,
      amount: stake,
      duration: metadata?.duration ? Math.floor(metadata.duration / 60) : 2,
      durationUnit: 'm',
    });

    console.log(`   ✅ Trade ejecutado: ${result.contract_id || 'pending'}`);

    // Simular resultado (en producción vendría del Gateway)
    // Por ahora simulamos con una win rate conservadora
    const won = Math.random() < 0.55; // 55% win rate conservador
    const profit = won ? stake * (metadata?.payoutPct || 80) / 100 : -stake;

    if (won) {
      wonTrades++;
      balance += profit;
      console.log(`   ✅ WON: +$${profit.toFixed(2)}`);
    } else {
      lostTrades++;
      balance += profit;
      console.log(`   ❌ LOST: $${profit.toFixed(2)}`);
    }

    // Estadísticas
    const winRate = (wonTrades / totalTrades) * 100;
    const totalProfit = balance - INITIAL_BALANCE;
    const roi = (totalProfit / INITIAL_BALANCE) * 100;

    console.log(`\n📈 Estadísticas:`);
    console.log(`   Balance: $${balance.toFixed(2)}`);
    console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   Total P&L: $${totalProfit.toFixed(2)} (${roi.toFixed(2)}%)`);
    console.log(`   Trades: ${totalTrades} (${wonTrades}W / ${lostTrades}L)`);

    tradeHistory.push({
      direction,
      stake,
      won,
      profit,
      timestamp: Date.now(),
      metadata,
    });
  } catch (error) {
    console.error(`   ❌ Error ejecutando trade:`, error);
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🚀 Iniciando Vdubus BinaryPro Strategy Demo\n');
  console.log(`📊 Configuración:`);
  console.log(`   Symbol: ${SYMBOL}`);
  console.log(`   Timeframe: ${TIMEFRAME}s (${TIMEFRAME / 60}min)`);
  console.log(`   Gateway: ${GATEWAY_URL}`);
  console.log(`   Balance inicial: $${INITIAL_BALANCE}\n`);

  // Crear cliente Gateway
  const client = new GatewayClient({
    url: GATEWAY_URL,
  });

  // Crear estrategia
  const strategy = createStrategy();
  const engine = new StrategyEngine();

  // Agregar estrategia al engine
  engine.addStrategy(strategy);

  // Escuchar señales
  engine.on('signal', async (signal, strategyInstance) => {
    console.log(`\n🎯 Señal recibida de ${strategyInstance.getName()}:`);
    console.log(`   Asset: ${signal.symbol}`);
    console.log(`   Direction: ${signal.direction}`);
    console.log(`   Confidence: ${signal.confidence.toFixed(2)}`);

    // Calcular stake
    const stake = balance * (strategy.getConfig().amount / 100);
    const minStake = 1; // Mínimo $1
    const finalStake = Math.max(minStake, stake);

    // Ejecutar trade
    await executeTrade(client, signal.direction, finalStake, {
      ...signal.metadata,
      price: signal.metadata?.price || 0,
      payoutPct: 80,
    });
  });

  // Escuchar errores
  engine.on('strategy:error', (error, strategyInstance) => {
    console.error(`❌ Error en estrategia ${strategyInstance.getName()}:`, error);
  });

  // Conectar al Gateway
  console.log('🔌 Conectando al Gateway...');
  await client.connect();

  console.log('✅ Conectado al Gateway\n');

  // Obtener balance
  try {
    const balanceInfo = await client.getBalance();
    if (balanceInfo) {
      balance = balanceInfo.amount;
      console.log(`💰 Balance actual: $${balance.toFixed(2)}\n`);
    }
  } catch (error) {
    console.warn('⚠️  No se pudo obtener balance, usando balance inicial\n');
  }

  // Cargar candles históricos
  console.log(`📥 Cargando candles históricos para ${SYMBOL}...`);
  try {
    const historicalCandles = await client.getCandles({
      asset: SYMBOL,
      timeframe: TIMEFRAME,
      count: 100,
    });

    if (historicalCandles && historicalCandles.length > 0) {
      console.log(`✅ Cargados ${historicalCandles.length} candles históricos\n`);
      
      // Agregar candles al buffer
      candleBuffer.push(...historicalCandles);
      
      // Iniciar estrategia con datos históricos
      await engine.startAll();
      
      // Procesar candles históricos (solo el último para inicializar)
      if (candleBuffer.length > 0) {
        const lastCandle = candleBuffer[candleBuffer.length - 1];
        const context = {
          candles: candleBuffer,
          latestTick: null,
          balance,
          openPositions: 0,
        };
        await strategy.processCandle(lastCandle, context);
      }
    } else {
      console.warn('⚠️  No se pudieron cargar candles históricos\n');
      await engine.startAll();
    }
  } catch (error) {
    console.error('❌ Error cargando candles históricos:', error);
    await engine.startAll();
  }

  // Suscribirse a ticks en tiempo real
  console.log(`📡 Suscribiéndose a ticks de ${SYMBOL}...`);
  await client.subscribeTicks(SYMBOL);

  console.log('✅ Suscrito a ticks\n');
  console.log('🎯 Estrategia activa - Esperando señales...\n');

  // Procesar ticks en tiempo real
  client.on('tick', async (tick) => {
    if (tick.asset !== SYMBOL) return;

    // Construir candle desde tick
    const completedCandle = processTick(tick);

    if (completedCandle) {
      // Agregar a buffer
      candleBuffer.push(completedCandle);
      
      // Mantener solo los últimos 200 candles
      if (candleBuffer.length > 200) {
        candleBuffer.shift();
      }

      // Procesar vela con estrategia
      const context = {
        candles: [...candleBuffer],
        latestTick: tick,
        balance,
        openPositions: 0,
      };

      await strategy.processCandle(completedCandle, context);
    }
  });

  // Manejar desconexión
  client.on('disconnect', () => {
    console.log('\n⚠️  Desconectado del Gateway');
    process.exit(1);
  });

  // Manejar errores de conexión
  client.on('error', (error) => {
    console.error('\n❌ Error de conexión:', error);
  });

  // Mantener el proceso corriendo
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Deteniendo estrategia...');
    await engine.stopAll();
    await client.disconnect();
    
    console.log('\n📊 Resumen Final:');
    console.log(`   Balance final: $${balance.toFixed(2)}`);
    console.log(`   Total P&L: $${(balance - INITIAL_BALANCE).toFixed(2)}`);
    console.log(`   ROI: ${((balance - INITIAL_BALANCE) / INITIAL_BALANCE * 100).toFixed(2)}%`);
    console.log(`   Trades: ${totalTrades} (${wonTrades}W / ${lostTrades}L)`);
    if (totalTrades > 0) {
      console.log(`   Win Rate: ${(wonTrades / totalTrades * 100).toFixed(2)}%`);
    }
    
    process.exit(0);
  });
}

// Ejecutar
main().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

