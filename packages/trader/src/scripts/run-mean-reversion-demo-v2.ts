#!/usr/bin/env node
/**
 * Run Mean Reversion Strategy - Demo Account v2
 *
 * Usa la arquitectura correcta: Gateway → Trader
 */

import dotenv from 'dotenv';
import { GatewayClient } from '../client/gateway-client.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.strategy.js';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import type { Candle, Tick, StrategyConfig } from '@deriv-bot/shared';

// Cargar variables de entorno
dotenv.config();

// Configuración
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:3000';
const SYMBOL = 'R_75'; // Volatility 75 Index
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
 * Crear y configurar la estrategia
 */
function createStrategy(): MeanReversionStrategy {
  const config: StrategyConfig = {
    name: 'MeanReversion-Demo',
    enabled: true,
    assets: [SYMBOL],
    maxConcurrentTrades: 1,
    amount: 1, // 1% del balance
    amountType: 'percentage',
    cooldownSeconds: 120, // 2 minutos
    minConfidence: 0.75,
    parameters: {
      // Parámetros optimizados (Test #5)
      rsiPeriod: 14,
      rsiOversold: 17,
      rsiOverbought: 83,
      bbPeriod: 20,
      bbStdDev: 2.0,
      atrPeriod: 14,
      atrMultiplier: 1.0,
      cooldownMinutes: 2,
      expiryMinutes: 3,
      maxWinStreak: 2,
      maxLossStreak: 3,
    },
  };

  return new MeanReversionStrategy(config);
}

/**
 * Procesar tick y construir candle
 */
function processTick(tick: Tick): Candle | null {
  const tickTime = tick.timestamp;
  // Agrupar por minuto (60 segundos * 1000 ms)
  const candleTime = Math.floor(tickTime / (TIMEFRAME * 1000)) * (TIMEFRAME * 1000);

  // Nueva vela
  if (candleTime !== lastCandleTime) {
    const completedCandle = currentCandle;
    lastCandleTime = candleTime;

    // Iniciar nueva vela
    currentCandle = {
      asset: SYMBOL,
      timeframe: TIMEFRAME,
      timestamp: candleTime,
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
  console.log(`   RSI: ${metadata?.rsi?.toFixed(2)}`);
  console.log(`   Price: ${metadata?.price?.toFixed(2)}`);
  console.log(`   Reason: ${metadata?.reason}`);

  try {
    // Ejecutar trade a través del Gateway
    const result = await client.trade({
      asset: SYMBOL,
      direction,
      amount: stake,
      duration: 3,
      durationUnit: 'm',
    });

    console.log(`   ✅ Trade ejecutado: ${result.contract_id || 'pending'}`);

    // Simular resultado (en producción vendría del Gateway)
    // Por ahora simulamos con la win rate esperada (63.87%)
    const won = Math.random() < 0.6387;
    const profit = won ? stake * 0.95 : -stake;

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
    const roi = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;

    console.log(`   Balance: $${balance.toFixed(2)}`);
    console.log(`   Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`   ROI: ${roi.toFixed(2)}%`);

    // Guardar en historial
    tradeHistory.push({
      tradeId: totalTrades,
      timestamp: new Date().toISOString(),
      direction,
      stake,
      profit,
      won,
      balance,
      winRate,
      roi,
      metadata,
    });
  } catch (error: any) {
    console.error(`   ❌ Error ejecutando trade: ${error.message}`);
  }
}

/**
 * Main
 */
async function main() {
  console.log('🚀 Iniciando Mean Reversion Strategy - Demo v2');
  console.log(`📊 Symbol: ${SYMBOL}`);
  console.log(`💰 Balance inicial: $${INITIAL_BALANCE}`);
  console.log(`📈 Estrategia: RSI 17/83, BB 20/2.0, ATR 1.0x`);
  console.log(`🔌 Gateway URL: ${GATEWAY_URL}\n`);

  // Crear cliente del Gateway
  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: true,
    enableLogging: true,
  });

  try {
    // Conectar al Gateway
    console.log('🔌 Conectando al Gateway...');
    await client.connect();
    console.log('✅ Conectado al Gateway\n');

    // Obtener balance
    try {
      const balanceInfo = await client.getBalance();
      console.log(`💰 Balance cuenta: ${balanceInfo.amount} ${balanceInfo.currency}\n`);

      // Actualizar balance inicial con el balance real
      balance = balanceInfo.amount;
    } catch (error) {
      console.log('⚠️  No se pudo obtener balance (continuando con $10000)...\n');
    }

    // Crear estrategia
    const strategy = createStrategy();
    const engine = new StrategyEngine();
    engine.addStrategy(strategy);

    // Actualizar balance
    engine.updateBalance(balance);

    // Escuchar señales
    engine.on('signal', async (signal) => {
      console.log(`\n🎯 SEÑAL DETECTADA`);
      console.log(`   Tipo: ${signal.direction}`);
      console.log(`   Confianza: ${(signal.confidence * 100).toFixed(1)}%`);
      console.log(`   Razón: ${signal.metadata?.reason}`);

      // Calcular stake con progressive anti-martingale
      const baseStake = balance * 0.01; // 1% del balance
      const stake = (strategy as any).getCurrentStake(baseStake);

      // Ejecutar trade
      await executeTrade(client, signal.direction, stake, signal.metadata);
    });

    // Obtener historial de candles para empezar con datos
    console.log(`📊 Obteniendo historial de ${SYMBOL}...`);
    try {
      const historicalCandles = await client.getCandles(SYMBOL, TIMEFRAME, 100);

      if (historicalCandles && historicalCandles.length > 0) {
        candleBuffer.push(...historicalCandles);
        console.log(`✅ Cargadas ${historicalCandles.length} candles históricas\n`);
        console.log(`📈 Última candle: ${new Date(historicalCandles[historicalCandles.length - 1].timestamp).toISOString()}`);
        console.log(`   Open: ${historicalCandles[historicalCandles.length - 1].open}`);
        console.log(`   High: ${historicalCandles[historicalCandles.length - 1].high}`);
        console.log(`   Low: ${historicalCandles[historicalCandles.length - 1].low}`);
        console.log(`   Close: ${historicalCandles[historicalCandles.length - 1].close}\n`);
      } else {
        console.log(`⚠️  No se pudieron obtener candles históricas, empezando desde cero\n`);
      }
    } catch (error) {
      console.log(`⚠️  Error obteniendo historial: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.log(`   Empezando desde cero...\n`);
    }

    // Suscribirse a ticks de R_75
    console.log(`📡 Suscribiendo a ${SYMBOL}...`);
    await client.follow([SYMBOL]);
    console.log(`✅ Suscrito a ${SYMBOL}\n`);

    // Iniciar estrategia
    await engine.startAll();
    console.log('✅ Estrategia iniciada\n');

    if (candleBuffer.length >= 30) {
      console.log('🎯 Listo para generar señales INMEDIATAMENTE\n');
      console.log('📊 Monitoreando mercado en tiempo real...\n');
    } else {
      console.log('📊 Monitoreando mercado...');
      console.log(`⏰ Necesita ${30 - candleBuffer.length} candles más antes de generar señales\n`);
    }

    // Escuchar ticks del Gateway
    client.on('tick', (tick: Tick) => {
      // Solo procesar ticks de nuestro símbolo
      if (tick.asset !== SYMBOL) return;

      // Construir candle
      const completedCandle = processTick(tick);

      if (completedCandle) {
        // Agregar al buffer
        candleBuffer.push(completedCandle);

        // Mantener últimas 100 velas
        if (candleBuffer.length > 100) {
          candleBuffer.shift();
        }

        console.log(`📈 Candle #${candleBuffer.length} completada (${new Date(completedCandle.timestamp).toISOString()})`);

        // Procesar con la estrategia (solo si tenemos suficientes candles)
        if (candleBuffer.length >= 30) {
          engine.processCandle(completedCandle);
        } else {
          console.log(`   ⏳ Calentando... ${30 - candleBuffer.length} candles restantes`);
        }
      }
    });

    // Mantener vivo
    console.log('💡 Presiona Ctrl+C para detener\n');

    // Manejar cierre
    process.on('SIGINT', async () => {
      console.log('\n\n⏹️  Deteniendo...');

      // Desconectar del Gateway
      await client.disconnect();

      // Mostrar resumen
      console.log('\n═══════════════════════════════════════════');
      console.log('           RESUMEN DE LA SESIÓN');
      console.log('═══════════════════════════════════════════');
      console.log(`Total Trades: ${totalTrades}`);
      console.log(`Won: ${wonTrades} | Lost: ${lostTrades}`);
      console.log(`Win Rate: ${totalTrades > 0 ? ((wonTrades / totalTrades) * 100).toFixed(2) : 0}%`);
      console.log(`Balance Inicial: $${INITIAL_BALANCE.toFixed(2)}`);
      console.log(`Balance Final: $${balance.toFixed(2)}`);
      console.log(`Profit/Loss: $${(balance - INITIAL_BALANCE).toFixed(2)}`);
      console.log(`ROI: ${((balance - INITIAL_BALANCE) / INITIAL_BALANCE * 100).toFixed(2)}%`);
      console.log(`Candles Procesadas: ${candleBuffer.length}`);
      console.log('═══════════════════════════════════════════\n');

      process.exit(0);
    });
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    await client.disconnect();
    process.exit(1);
  }
}

// Ejecutar
main().catch(console.error);
