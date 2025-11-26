# Binary Options Backtester - Mean Reversion Strategy

Sistema optimizado de trading para Binary Options en R_75 (Volatility 75 Index) usando estrategia de Mean Reversion con Progressive Anti-Martingale.

## 📊 Performance Actual (Test #5 - Óptimo)

**Backtest 90 días:**
- **Win Rate:** 63.87%
- **ROI:** 54.09%
- **Ganancia Total:** $540.92
- **Trades:** 119 (1.3/día)
- **Avg Profit/Trade:** $4.55

**Parámetros Óptimos:**
- RSI: 17/83 (14 períodos)
- Bollinger Bands: 20 períodos, 2.0 std dev
- ATR Filter: 1.0x multiplier
- Expiry: 3 minutos
- Cooldown: 2 minutos
- Progressive Anti-Martingale: Reset after 2 wins / 3 losses

---

## 🏗️ Estructura del Proyecto

```
binary_backtester/
├── docs/                          # Documentación principal
│   ├── OPTIMIZATION_COMPLETE_ANALYSIS.md  # Análisis completo de todos los tests
│   ├── BASELINE_V2.md            # Baseline actual (RSI 18/82)
│   ├── BASELINE_ORIGINAL.md      # Baseline original (RSI 20/80)
│   ├── TEST_1_RESULTS.md         # Signal Strength Filter
│   ├── TEST_2_RESULTS.md         # RSI 18/82 (adoptado como V2)
│   └── TEST_3_RESULTS.md         # ATR 1.2x (rechazado)
│
├── strategies/                    # Estrategias de trading
│   └── mean_reversion_strategy.py  # Estrategia principal (Test #5: RSI 17/83)
│
├── core/                          # Motor de backtesting
│   ├── enhanced_backtrader_engine.py
│   └── config.py
│
├── data/                          # Data de mercado
│   └── deriv_candles_R_75_20251016_162542.json  # 90 días R_75 (actual)
│
├── archive/                       # Archivos históricos
│   ├── docs/                      # Documentos obsoletos
│   ├── results/                   # Resultados antiguos
│   └── old_data/                  # Data files antiguos
│
├── run_mean_reversion_test_v2.py  # Script principal de backtesting
└── README.md                      # Este archivo
```

---

## 🚀 Cómo Usar

### 1. Setup Inicial

```bash
# Activar virtual environment
source venv/bin/activate

# Instalar dependencias (si no están instaladas)
pip install -r requirements.txt
```

### 2. Correr Backtest

```bash
# Backtest con parámetros actuales (Test #5: RSI 17/83)
python run_mean_reversion_test_v2.py
```

### 3. Ver Resultados

Los resultados se mostrarán en consola:
- Win Rate
- ROI
- Total Trades
- Ganancia Total
- Avg Profit per Trade

---

## 📈 Historial de Optimización

| Versión | RSI | Trades | Win Rate | ROI | Status |
|---------|-----|--------|----------|-----|--------|
| V1 (Original) | 20/80 | 324 | 54.63% | 30.43% | Superseded |
| V2 (Optimizado) | 18/82 | 262 | 58.02% | 30.99% | Superseded |
| **Test #5 (Actual)** | **17/83** | **119** | **63.87%** | **54.09%** | ✅ **ACTIVO** |

**Mejora Total:** +9.24% Win Rate, +23.66% ROI vs V1

---

## 🎯 Próximos Pasos

### Fase 1: Adoptar Test #5 (RSI 17/83) ✅ HECHO
- [x] Backtest completo
- [x] Análisis de resultados
- [x] Documentación

### Fase 2: Forward Testing en Demo ⏳ PENDIENTE
- [ ] Deploy a Deriv demo account
- [ ] Correr 2-3 días (target: 15-30 trades)
- [ ] Validar win rate ≥ 60%

### Fase 3: Live Testing con Micro Stakes ⏳ PENDIENTE
- [ ] Deploy a live con $10-50 capital
- [ ] Correr 1 semana (target: 50-100 trades)
- [ ] Monitorear performance

### Fase 4: Scale Up ⏳ PENDIENTE
- [ ] Aumentar capital gradualmente
- [ ] Monitorear drawdowns
- [ ] Ajustar si necesario

---

## ⚙️ Configuración de Estrategia

### Parámetros Actuales (Test #5):

```python
# RSI - Optimizado para extremos confiables
rsi_period = 14
rsi_oversold = 17       # Muy oversold = reversión confiable
rsi_overbought = 83     # Muy overbought = reversión confiable

# Bollinger Bands
bb_period = 20
bb_std_dev = 2.0

# ATR Filter (volatilidad)
atr_period = 14
atr_multiplier = 1.0    # No sobre-filtrar

# Trade Management
expiry_minutes = 3      # Binary option expiry
cooldown_minutes = 2    # Tiempo entre trades
max_concurrent_trades = 3

# Progressive Anti-Martingale
max_win_streak = 2      # Reset después de 2 wins
max_loss_streak = 3     # Reset después de 3 losses
base_stake_pct = 0.01   # 1% del capital por trade
```

### Señales de Entrada:

**CALL (Compra):**
- RSI < 17 (muy oversold)
- Price < Bollinger Band Lower
- ATR > average (suficiente volatilidad)

**PUT (Venta):**
- RSI > 83 (muy overbought)
- Price > Bollinger Band Upper
- ATR > average

---

## 📊 Progressive Anti-Martingale

Sistema de gestión de capital que aumenta stakes en rachas ganadoras y reduce en rachas perdedoras:

**Win Cycle:**
```
Win 1: $10 → Ganancia $9.50 → Next stake: $19.50
Win 2: $19.50 → Ganancia $18.52 → RESET a $10
```

**Loss Cycle:**
```
Loss 1: $10 → Pérdida $10 → Next stake: $5
Loss 2: $5 → Pérdida $5 → Next stake: $2.50
Loss 3: $2.50 → Pérdida $2.50 → RESET a $10
```

**Ventajas:**
- Capitaliza rachas ganadoras con stakes progresivos
- Limita pérdidas en rachas malas reduciendo stakes
- Reset automático previene stakes excesivos

---

## 🧪 Tests Realizados

### Test #1: Signal Strength Filter
- **Cambio:** Solo señales con RSI + BB touch
- **Resultado:** 55.36% WR, 24.31% ROI
- **Veredicto:** ❌ Rechazado - over-filtering redujo volumen

### Test #2: RSI 18/82
- **Cambio:** RSI más ajustado (20/80 → 18/82)
- **Resultado:** 58.02% WR, 30.99% ROI
- **Veredicto:** ✅ Adoptado como Baseline V2

### Test #3: ATR 1.2x
- **Cambio:** Filtro de volatilidad más estricto
- **Resultado:** 1 trade en 90 días
- **Veredicto:** ❌❌❌ Falló - sobre-filtrado catastrófico

### Test #4: Cooldown 3 minutos
- **Cambio:** Mayor separación entre trades
- **Resultado:** 58.82% WR, 27.67% ROI
- **Veredicto:** ⚠️ Marginal - win rate subió pero ROI bajó

### Test #5: RSI 17/83 ⭐
- **Cambio:** RSI aún más ajustado (18/82 → 17/83)
- **Resultado:** 63.87% WR, 54.09% ROI
- **Veredicto:** ✅✅✅ **GANADOR** - mejor de todos

---

## 💡 Lecciones Aprendidas

1. **Quality > Quantity:** 119 trades de calidad (63.87% WR) > 262 trades mediocres (58% WR)

2. **Progressive Staking Ama Win Rate Alto:** +5.85% win rate = +74% ROI debido al compounding

3. **Extremos Más Ajustados = Mayor Confiabilidad:** RSI 17/83 captura las reversiones más probables

4. **No Sobre-Filtrar:** Existe un límite - ATR 1.2x filtró TODO y falló

5. **Mean Reversion NO Requiere Alta Volatilidad:** Funciona mejor con volatilidad normal en R_75

---

## ⚠️ Riesgos y Limitaciones

1. **Overfitting:** Test #5 optimizado en 90 días de data - forward testing es crítico

2. **Menor Volumen:** 1.3 trades/día - algunos días sin trades son posibles

3. **Slippage No Modelado:** Backtest asume fills perfectos - live puede diferir

4. **Market Regime Change:** R_75 es sintético pero comportamiento puede cambiar

5. **Forward Testing Necesario:** Performance en backtest no garantiza performance en live

---

## 📚 Documentación Adicional

- **OPTIMIZATION_COMPLETE_ANALYSIS.md:** Análisis detallado de todos los tests
- **BASELINE_V2.md:** Documentación del baseline anterior (RSI 18/82)
- **TEST_X_RESULTS.md:** Resultados individuales de cada test

---

## 🛠️ Tecnologías

- **Python 3.13**
- **Backtrader:** Motor de backtesting
- **TA-Lib / Custom Indicators:** Indicadores técnicos (RSI, BB, ATR)
- **Pandas / NumPy:** Procesamiento de datos
- **Deriv API:** Data provider (R_75)

---

## 📞 Próximos Pasos de Deployment

1. **Forward Testing Demo (2-3 días)**
   - Validar win rate ≥ 60% en mercado live
   - Detectar issues de slippage/execution

2. **Live Micro Stakes (1 semana)**
   - Capital inicial: $10-50
   - Validar performance con dinero real

3. **Scale Up Gradualmente**
   - Aumentar capital si valida
   - Monitorear drawdowns continuamente

---

**Versión:** 3.0 (Test #5 Optimizado)
**Última Actualización:** 2025-10-16
**Status:** ✅ Listo para Forward Testing
