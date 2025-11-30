# 📋 Listado de Estrategias - Deriv Bot

## 🏠 Estrategias Disponibles Localmente

### Estrategias con Scripts de Ejecución

#### 1. **HYBRID_MTF** (Hybrid Multi-Timeframe)
- **Script**: `run-hybrid-mtf.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:hybrid-mtf`
- **Descripción**: Estrategia híbrida multi-timeframe que combina momentum y mean reversion
- **Assets**: R_100 (por defecto)
- **Versión**: v2.1.0
- **Características**:
  - Análisis multi-timeframe (15m/5m/1m)
  - Detección de régimen de mercado
  - Cooldown dinámico después de pérdidas consecutivas
  - TP/SL: 0.4%/0.3% (ratio 1.33:1)

#### 2. **FVG** (Fair Value Gap)
- **Script**: `run-fvg.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:fvg`
- **Descripción**: Estrategia basada en Fair Value Gaps
- **Assets**: R_75, R_100 (por defecto)
- **Características**:
  - Detección de gaps de valor justo
  - Entrada cuando precio retorna al gap

#### 3. **FVG-LS** (FVG Liquidity Sweep)
- **Script**: `run-fvg-ls.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:fvg-ls` (si existe)
- **Descripción**: Combina detección de liquidity sweeps con FVG
- **Assets**: frxAUDUSD, frxEURUSD, frxGBPUSD, frxUSDCHF (por defecto)
- **Versión**: v1.0.0
- **Características**:
  - Detección de stop hunts (liquidity sweeps)
  - Filtros por hora para evitar períodos de baja win rate
  - Optimizado para pares forex

#### 4. **BB-SQUEEZE-MR** (Bollinger Bands Squeeze Mean Reversion)
- **Script**: `run-bb-squeeze-mr.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:squeeze-mr`
- **Descripción**: Estrategia de mean reversion usando Bollinger Bands Squeeze
- **Assets**: R_75, R_100 (por defecto)
- **Características**:
  - Detección de compresión de volatilidad
  - Entrada en expansión después de squeeze
  - Mean reversion puro

#### 5. **KELTNER_MR** (Keltner Channels Mean Reversion)
- **Script**: `run-keltner-mr.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:keltner-mr`
- **Descripción**: Mean reversion usando Keltner Channels
- **Assets**: frxEURUSD (por defecto)
- **Características**:
  - Optimizado para forex
  - Filtro de sesiones (LONDON, NY, ASIAN)
  - Keltner Channels para detección de extremos

#### 6. **BB-Squeeze** (Bollinger Bands Squeeze)
- **Script**: `run-bb-squeeze.ts` (mencionado en package.json)
- **Comando**: `pnpm --filter @deriv-bot/trader demo:squeeze`
- **Descripción**: Estrategia de squeeze de Bollinger Bands
- **Assets**: R_75, R_100
- **Características**:
  - Detección de compresión de volatilidad
  - Entrada en breakout después de squeeze

#### 7. **RSI-BB Scalping**
- **Script**: `run-rsi-bb-scalping-demo.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:rsi-bb`
- **Descripción**: Estrategia de scalping combinando RSI y Bollinger Bands
- **Tipo**: Demo

#### 8. **Vdubus Binary Pro**
- **Script**: `run-vdubus-demo.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:vdubus`
- **Descripción**: Estrategia para opciones binarias
- **Tipo**: Demo

#### 9. **Pivot Reversal**
- **Script**: `run-pivot-reversal-demo.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:pivot`
- **Descripción**: Estrategia basada en reversiones en pivotes
- **Tipo**: Demo

#### 10. **Support Resistance**
- **Script**: `run-support-resistance-demo.ts`
- **Comando**: `pnpm --filter @deriv-bot/trader demo:sr`
- **Descripción**: Estrategia basada en soporte y resistencia
- **Tipo**: Demo

---

### Estrategias Solo en Código (Sin Script de Ejecución Directo)

#### 11. **CryptoScalp v2**
- **Archivo**: `crypto-scalp/crypto-scalp.strategy.ts`
- **Descripción**: Estrategia avanzada de scalping para criptomonedas
- **Versión**: v2.0.0
- **Características**:
  - VWAP para sesgo institucional
  - ADX para filtrado de fuerza de tendencia
  - ATR para TP/SL dinámicos
  - Bollinger Bands para extremos de volatilidad
  - Sistema de scoring para entradas
  - Mean reversion
- **Estado**: Solo disponible para backtesting

#### 12. **RSI Scalp**
- **Archivo**: `rsi-scalp.strategy.ts`
- **Descripción**: Estrategia de scalping usando RSI con DCA
- **Características**:
  - RSI oversold/overbought
  - Dollar Cost Averaging (DCA)
  - Filtro de tendencia EMA
  - Sistema de salida dual

#### 13. **Mean Reversion**
- **Archivo**: `mean-reversion.strategy.ts`
- **Descripción**: Estrategia base de mean reversion

#### 14. **BB Bounce**
- **Archivo**: `mr/bb-bounce.strategy.ts`
- **Descripción**: Mean reversion usando rebotes en Bollinger Bands

#### 15. **RSI MR**
- **Archivo**: `mr/rsi-mr.strategy.ts`
- **Descripción**: Mean reversion usando RSI

#### 16. **Hybrid MTF FVG**
- **Archivo**: `hybrid-mtf-fvg.strategy.ts`
- **Descripción**: Combinación de Hybrid MTF con FVG

#### 17. **Validation Test**
- **Archivo**: `validation-test.strategy.ts`
- **Descripción**: Estrategia de prueba/validación

---

## 🚀 Estrategias en Producción

Según los scripts de deployment y configuración PM2, las siguientes estrategias están activas en producción:

### 1. **BB-SQUEEZE-MR** (trader-squeeze-mr)
- **Proceso PM2**: `trader-squeeze-mr`
- **Assets**: R_75, R_100
- **Estado**: ✅ Activa
- **Script**: `run-bb-squeeze-mr.ts`

### 2. **HYBRID_MTF** (trader-hybrid-mtf)
- **Proceso PM2**: `trader-hybrid-mtf`
- **Assets**: R_100
- **Estado**: ✅ Activa
- **Script**: `run-hybrid-mtf.ts`

### 3. **FVG-LS** (trader-fvg-ls-forex)
- **Proceso PM2**: `trader-fvg-ls-forex`
- **Assets**: Pares forex (frxAUDUSD, frxEURUSD, frxGBPUSD, frxUSDCHF)
- **Estado**: ✅ Activa
- **Script**: `run-fvg-ls.ts`

---

## 📊 Resumen

### Total de Estrategias
- **Con scripts de ejecución**: 10
- **Solo en código**: 7
- **En producción**: 3
- **Total**: 17 estrategias

### Por Tipo de Asset
- **Volatility Indices (R_75, R_100)**: HYBRID_MTF, FVG, BB-SQUEEZE-MR, BB-Squeeze
- **Forex**: FVG-LS, KELTNER_MR
- **Crypto**: CryptoScalp v2, RSI Scalp

### Por Estado
- **Producción**: 3 estrategias
- **Desarrollo/Testing**: 14 estrategias

---

## 🔧 Comandos Útiles

### Ver estado en producción
```bash
ssh $DEPLOY_SERVER "pm2 status"
```

### Ver logs de una estrategia específica
```bash
ssh $DEPLOY_SERVER "pm2 logs trader-squeeze-mr"
ssh $DEPLOY_SERVER "pm2 logs trader-hybrid-mtf"
ssh $DEPLOY_SERVER "pm2 logs trader-fvg-ls-forex"
```

### Ejecutar estrategia localmente
```bash
# Ejemplo: HYBRID_MTF
SYMBOL="R_100" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:hybrid-mtf

# Ejemplo: BB-SQUEEZE-MR
SYMBOL="R_75,R_100" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:squeeze-mr

# Ejemplo: KELTNER_MR
SYMBOL="frxEURUSD" STRATEGY_ALLOCATION="1000" pnpm --filter @deriv-bot/trader demo:keltner-mr
```

---

## 📝 Notas

- Las estrategias en producción están configuradas con PM2 para reinicio automático
- Cada estrategia en producción tiene su propio proceso independiente
- Las estrategias usan `StrategyAccountant` para gestión de capital separada
- Los logs están separados por estrategia en producción
- Las estrategias demo están disponibles para testing local

---

*Última actualización: Generado automáticamente desde el código*

