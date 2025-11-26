# BB Squeeze Strategy - Deep Loss Analysis Findings

**Date**: 2025-11-25
**Symbol**: R_75
**Period**: 30 days (45,000 candles)
**Total Trades**: 1,497
**Win Rate**: 33.0% (494 wins / 1,003 losses)

---

## Executive Summary

Este análisis profundo examina **1,003 trades perdedores** para entender POR QUÉ perdemos, sin hacer overfitting. Los hallazgos son para **aprender**, no para optimizar ciegamente.

---

## 1. False Breakouts Analysis

### Key Findings:

| Métrica | Valor | Insight |
|---------|-------|---------|
| Immediate Reversals (≤3 bars) | **33.3%** | 1 de cada 3 pérdidas ocurre inmediatamente |
| Slow Reversals (>3 bars) | 66.7% | Mayoría tarda más en fallar |
| Avg bars to SL | 7.4 candles | ~7 minutos promedio |

### Best Price Reached (% del TP):

| Rango | Trades | % | Insight |
|-------|--------|---|---------|
| Never moved (0-10%) | 259 | 25.8% | Breakouts sin momentum |
| Moved some (10-50%) | 493 | 49.2% | Mayoría se mueve algo |
| Almost made it (>50%) | 251 | 25.0% | **NEAR MISSES** - oportunidad |

### Conclusión:
- **33% immediate reversals** = señales que fallan inmediatamente
- **25% near misses** = llegaron >50% del TP pero fallaron
- **50% movimiento parcial** = comportamiento normal de mercado

---

## 2. Squeeze Duration Analysis

### Key Findings:

| Duración | Losses | % |
|----------|--------|---|
| Short (1-3 bars) | 308 | 30.7% |
| Medium (4-8 bars) | 366 | 36.5% |
| Long (>8 bars) | 329 | 32.8% |

### Win vs Loss Comparison:

| Métrica | Wins | Losses |
|---------|------|--------|
| Avg Squeeze Duration | 7.7 bars | 7.5 bars |

### Conclusión:
- **Squeeze duration NO es un factor diferenciador significativo**
- Wins y Losses tienen duración similar (~7.5 bars)
- No hay correlación clara entre duración del squeeze y resultado

---

## 3. Temporal Analysis

### Peores Horas (UTC):

| Hora | Losses | Total | Loss Rate |
|------|--------|-------|-----------|
| 02:00 | 47 | 63 | **74.6%** |
| 08:00 | 46 | 63 | **73.0%** |
| 17:00 | 48 | 66 | **72.7%** |
| 03:00 | 46 | 64 | **71.9%** |
| 22:00 | 43 | 60 | **71.7%** |

### Días de la Semana:

| Día | Losses | Total | Loss Rate |
|-----|--------|-------|-----------|
| Sat | 177 | 253 | **70.0%** |
| Wed | 130 | 188 | **69.1%** |
| Fri | 142 | 210 | **67.6%** |
| Sun | 159 | 237 | 67.1% |
| Thu | 125 | 190 | 65.8% |
| Tue | 122 | 186 | 65.6% |
| Mon | 148 | 233 | **63.5%** (best) |

### Conclusión:
- **Madrugada UTC (02:00-03:00)** tiene peor performance
- **Sábados** tienen el peor loss rate (70%)
- **Lunes** tiene el mejor loss rate (63.5%)
- Diferencia de ~7% entre mejor y peor día

---

## 4. ATR (Volatilidad) Analysis

### Key Findings:

| Métrica | Valor |
|---------|-------|
| Avg ATR | $64.50 (0.145%) |
| Wins Avg ATR | $64.34 |
| Losses Avg ATR | $64.50 |

### ATR Terciles:

| Tercil | Losses | Avg Best% |
|--------|--------|-----------|
| Low ATR | 335 | 32.2% |
| Mid ATR | 334 | 31.7% |
| High ATR | 334 | 31.9% |

### Conclusión:
- **ATR NO es un factor diferenciador**
- Wins y Losses tienen ATR prácticamente idéntico
- Ningún tercil de ATR muestra ventaja significativa

---

## 5. RSI Analysis

### LONG Losses (492 trades):

| Métrica | Valor |
|---------|-------|
| Avg RSI | 64.1 |
| Weak RSI (<60) | 128 (26.0%) |

### SHORT Losses (511 trades):

| Métrica | Valor |
|---------|-------|
| Avg RSI | 35.9 |
| Weak RSI (>40) | 116 (22.7%) |

### Conclusión:
- ~25% de pérdidas tienen RSI "débil" (cerca del umbral)
- ~75% de pérdidas tienen RSI "fuerte" (lejos del umbral)
- **RSI fuerte NO garantiza éxito** - la mayoría de pérdidas tienen buen RSI

---

## 6. Top 10 Worst Losses Pattern

| # | Direction | Price | RSI | Squeeze | Best% | Day/Hour | Type |
|---|-----------|-------|-----|---------|-------|----------|------|
| 1 | LONG | $54,685 | 61.2 | 4 bars | 7.0% | Fri 22:00 | IMMED |
| 2 | LONG | $54,533 | 62.0 | 3 bars | 30.9% | Sat 0:00 | SLOW |
| 3 | LONG | $54,446 | 76.8 | 5 bars | 41.7% | Fri 21:00 | SLOW |
| 4 | SHORT | $54,368 | 37.8 | 9 bars | 33.6% | Fri 22:00 | IMMED |
| 5 | SHORT | $54,280 | 39.9 | 5 bars | 42.8% | Sat 6:00 | SLOW |

### Observaciones:
- **8 de 10** peores pérdidas ocurrieron **Viernes-Sábado**
- Mix de IMMED y SLOW reversals
- RSI y Squeeze duration variados (no hay patrón claro)

---

## Key Takeaways (SIN Overfitting)

### Lo que SÍ importa:

1. **Timing Semanal**: Lunes tiene 7% mejor loss rate que Sábado
2. **Immediate Reversals**: 33% de pérdidas ocurren en ≤3 candles
3. **Near Misses**: 25% de pérdidas llegaron a >50% del TP

### Lo que NO importa (sorpresa!):

1. **Squeeze Duration**: NO correlaciona con resultado
2. **ATR**: NO correlaciona con resultado
3. **RSI Strength**: Mayoría de pérdidas tienen RSI "bueno"

### Posibles Mejoras (para considerar):

1. **Trailing Stop**: Rescataría ~25% de near misses
2. **Evitar Sábados**: Reducir exposición en día con peor performance
3. **Confirmación Post-Breakout**: Esperar 1-2 candles para evitar 33% immediate reversals

---

## Data Files Generated

- `R_75_loss_analysis.csv` - 1,003 trades perdedores con todos los campos
- `R_75_wins_analysis.csv` - 494 trades ganadores para comparación

---

## Nota Importante

Este análisis es para **APRENDER**, no para **OPTIMIZAR**. Los insights deben usarse con cautela para no hacer overfitting a datos históricos.

La estrategia BB Squeeze ya es rentable en backtests anteriores (47% return con 114 trades). Este análisis profundo usa más trades (1,497) con cooldown más corto, lo que explica el win rate más bajo (33% vs 48%).
