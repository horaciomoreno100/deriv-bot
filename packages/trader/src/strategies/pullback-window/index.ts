/**
 * Pullback Window Strategy Module
 *
 * State machine-based scalping strategy for Gold and Silver:
 * - 4-phase state machine (SCANNING → ARMED → WINDOW_OPEN → ENTRY)
 * - EMA crossover detection for trend confirmation
 * - Pullback counting for high-probability entries
 * - ATR-based dynamic TP/SL
 * - ADX filter for trend strength
 *
 * Optimized presets for:
 * - Gold (XAUUSD): Deeper pullbacks, wider TP, tighter SL
 * - Silver (XAGUSD): Even deeper pullbacks, very wide TP, very tight SL
 *
 * @module pullback-window
 */

export * from './pullback-window.types.js';
export * from './pullback-window.params.js';
export * from './pullback-window.strategy.js';
