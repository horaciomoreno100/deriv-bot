# 📊 BB Squeeze Backtest Guide

Guía completa para ejecutar backtesting de la estrategia BB Squeeze usando **BacktestJS**.

---

## 🚀 Quick Start

### 1. Preparar Datos

Descarga datos históricos de Deriv y conviértelos al formato CSV de BacktestJS:

```bash
# Descargar 7 días de datos para R_75 y R_100
pnpm backtest:squeeze

# Personalizar símbolos y días
SYMBOL="R_75,R_100,R_25" BACKTEST_DAYS=14 pnpm backtest:squeeze
```

**Salida:**
- CSV files en `./backtest-data/`
- Config file: `./backtest-data/backtest-config.js`
- Estrategia: `src/backtest/bb-squeeze-backtest.ts`

---

### 2. Ejecutar Backtest (Método Recomendado)

#### Opción A: BacktestJS UI (Visual & Fácil)

```bash
# Iniciar la UI de BacktestJS
npx @backtest/framework
```

**En el navegador:**

1. **Import Data:**
   - Click en "Import CSV"
   - Selecciona los archivos CSV de `./backtest-data/`
   - Importa para cada símbolo

2. **Load Strategy:**
   - Click en "Load Strategy"
   - Navega a: `packages/trader/src/backtest/bb-squeeze-backtest.ts`

3. **Configure Parameters:**
   ```javascript
   {
     bbPeriod: 20,
     bbStdDev: 2,
     kcPeriod: 20,
     kcMultiplier: 1.5,
     takeProfitPct: 0.004,  // 0.4%
     stopLossPct: 0.002     // 0.2%
   }
   ```

4. **Run Backtest:**
   - Click en "Run Backtest"
   - Espera los resultados (se abrirá en Chrome)

5. **View Results:**
   - 📈 Equity curve interactiva
   - 📊 Win rate, ROI, profit factor
   - 📝 Trade-by-trade breakdown
   - 💰 Drawdown analysis

---

#### Opción B: Multi-Parameter Optimization

BacktestJS puede probar **múltiples combinaciones** de parámetros automáticamente:

```javascript
// En la UI de BacktestJS
{
  bbPeriod: [15, 20, 25],              // 3 valores
  bbStdDev: [2, 2.5],                  // 2 valores
  kcPeriod: [15, 20, 25],              // 3 valores
  kcMultiplier: [1.0, 1.5, 2.0],       // 3 valores
  takeProfitPct: [0.003, 0.004, 0.005], // 3 valores
  stopLossPct: [0.0015, 0.002, 0.0025]  // 3 valores
}
```

**Total combinaciones:** 3 × 2 × 3 × 3 × 3 × 3 = **486 backtests automáticos!**

BacktestJS ejecutará todos y mostrará los mejores resultados. 🎯

---

## 📖 Estructura de Archivos

```
packages/trader/
├── src/
│   ├── backtest/
│   │   ├── bb-squeeze-backtest.ts     # Estrategia para BacktestJS
│   │   └── fetch-deriv-data.ts        # Fetcher independiente (opcional)
│   ├── scripts/
│   │   └── run-backtest-squeeze.ts    # Script principal
│   └── strategies/
│       └── bb-squeeze.strategy.ts     # Estrategia original
└── backtest-data/                     # Datos CSV (generado)
    ├── R_75_60s_7d.csv
    ├── R_100_60s_7d.csv
    └── backtest-config.js
```

---

## 🔧 Variables de Entorno

```bash
# Símbolos a backtest
SYMBOL="R_75,R_100,R_25"

# Días de datos históricos
BACKTEST_DAYS=7

# Gateway URL
GATEWAY_WS_URL="ws://localhost:3000"

# Directorio de salida
OUTPUT_DIR="./backtest-data"
```

---

## 📊 Parámetros de la Estrategia

### Default Parameters

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `bbPeriod` | 20 | Período de Bollinger Bands |
| `bbStdDev` | 2 | Desviación estándar de BB |
| `kcPeriod` | 20 | Período de Keltner Channels |
| `kcMultiplier` | 1.5 | Multiplicador de ATR para KC |
| `takeProfitPct` | 0.004 | Take Profit: 0.4% |
| `stopLossPct` | 0.002 | Stop Loss: 0.2% |
| `minCandles` | 50 | Velas mínimas requeridas |

### Optimization Ranges (Sugeridos)

| Parámetro | Rango | Paso |
|-----------|-------|------|
| `bbPeriod` | 15-30 | 5 |
| `bbStdDev` | 1.5-3.0 | 0.5 |
| `kcPeriod` | 15-30 | 5 |
| `kcMultiplier` | 1.0-2.5 | 0.5 |
| `takeProfitPct` | 0.003-0.006 | 0.001 |
| `stopLossPct` | 0.0015-0.003 | 0.0005 |

---

## 📈 Métricas Esperadas

| Métrica | Rango Objetivo |
|---------|----------------|
| **Win Rate** | 35-45% |
| **Profit Factor** | 1.1-1.5 |
| **ROI (7 días)** | 5-15% |
| **Max Drawdown** | <15% |
| **Sharpe Ratio** | >0.5 |
| **Trades/Día** | 10-30 |

> **Nota:** Estos son valores estimados. Los resultados reales dependerán de la volatilidad del mercado.

---

## 🎯 Interpretando Resultados

### 1. Win Rate vs Profit Factor

- **Win Rate bajo (35-40%)** + **Profit Factor alto (>1.3)** = ✅ Bueno
  - TP/SL ratio (2:1) está funcionando bien
  - Las ganancias compensan las pérdidas

- **Win Rate alto (>50%)** + **Profit Factor bajo (<1.1)** = ⚠️ Revisar
  - Posible sobreoptimización
  - TP muy conservador o SL muy agresivo

### 2. Drawdown

- **<10%**: Excelente - Estrategia muy estable
- **10-20%**: Bueno - Drawdown manejable
- **>20%**: ⚠️ Alto riesgo - Considerar reducir risk%

### 3. Sharpe Ratio

- **>1.0**: Excelente - Muy buen riesgo/retorno
- **0.5-1.0**: Bueno - Retorno justifica el riesgo
- **<0.5**: ⚠️ Revisar - Mucho riesgo para poco retorno

### 4. Exit Reasons

Revisa el breakdown de exits:
- **TP Exits**: Idealmente 40-60%
- **SL Exits**: Idealmente 30-50%
- **BB_Middle Exits**: 10-20% (smart exit funcionando)

---

## 🔍 Walk-Forward Testing

Para validación más robusta, usa walk-forward testing:

1. **In-Sample (Training):** Primeros 70% de datos
2. **Out-of-Sample (Testing):** Últimos 30% de datos

```bash
# Descargar 30 días de datos
BACKTEST_DAYS=30 pnpm backtest:squeeze

# En BacktestJS:
# 1. Optimiza con días 1-21 (in-sample)
# 2. Valida con días 22-30 (out-of-sample)
```

**Si el performance es similar en ambos:** ✅ Estrategia robusta

**Si performance cae mucho en out-of-sample:** ⚠️ Sobreoptimización

---

## 🚨 Troubleshooting

### Problema: "No data received for symbol"

**Solución:**
```bash
# Verifica que el Gateway esté corriendo
lsof -ti:3000

# Si no está corriendo:
cd packages/gateway
pnpm dev
```

---

### Problema: "Cannot find module @backtest/framework"

**Solución:**
```bash
cd packages/trader
pnpm install
```

---

### Problema: "Strategy file not found"

**Solución:**
Asegúrate de que la ruta sea correcta:
```
/Users/tu-usuario/path/to/deriv-bot/packages/trader/src/backtest/bb-squeeze-backtest.ts
```

---

### Problema: "Insufficient candles"

**Solución:**
La estrategia necesita mínimo 50 velas. Descarga más días:
```bash
BACKTEST_DAYS=7 pnpm backtest:squeeze
```

---

## 💡 Tips de Optimización

### 1. Empieza Simple

No optimices todos los parámetros a la vez. Prueba en orden:

1. **Squeeze Detection** (BB/KC periods)
2. **Entry Timing** (breakout thresholds)
3. **Exit Management** (TP/SL ratios)

### 2. Usa Grid Search

BacktestJS permite grid search automático:

```javascript
// Parámetros coarse (rápido, amplio rango)
{
  bbPeriod: [15, 20, 25, 30],
  kcMultiplier: [1.0, 1.5, 2.0, 2.5]
}

// Después, refina el mejor resultado:
{
  bbPeriod: [18, 19, 20, 21, 22],  // Refinado
  kcMultiplier: [1.3, 1.4, 1.5, 1.6, 1.7]
}
```

### 3. Valida con Múltiples Símbolos

Prueba la estrategia en R_75, R_100, R_25:

- Si funciona en todos: ✅ Robusto
- Si solo funciona en uno: ⚠️ Específico del símbolo

### 4. Considera Transaction Costs

BacktestJS no incluye spreads/comisiones por defecto. Ajusta manualmente:

```javascript
// En tu análisis final:
netProfit = grossProfit - (totalTrades * spreadCost)
```

Para Deriv CFDs, spread típico: ~0.1-0.2% por trade

---

## 📚 Recursos

- **BacktestJS Docs**: https://backtestjs.github.io/framework/
- **BacktestJS GitHub**: https://github.com/backtestjs/framework
- **BB Squeeze README**: `./BB_SQUEEZE_README.md`
- **Strategy Source**: `./src/strategies/bb-squeeze.strategy.ts`

---

## 🎬 Workflow Completo

```bash
# 1. Asegúrate que Gateway esté corriendo
cd packages/gateway && pnpm dev

# 2. En otra terminal, descarga datos
cd packages/trader
pnpm backtest:squeeze

# 3. Inicia BacktestJS UI
npx @backtest/framework

# 4. En el navegador:
#    - Import CSVs
#    - Load strategy
#    - Configure params
#    - Run backtest
#    - Analyze results

# 5. Si resultados son buenos, prueba en demo:
pnpm demo:squeeze
```

---

## ✅ Checklist Pre-Backtest

- [ ] Gateway corriendo (`lsof -ti:3000`)
- [ ] Datos descargados (`ls backtest-data/*.csv`)
- [ ] Strategy file existe (`src/backtest/bb-squeeze-backtest.ts`)
- [ ] BacktestJS instalado (`@backtest/framework` en package.json)
- [ ] Parámetros configurados
- [ ] Chrome/navegador abierto

---

## 🎯 Próximos Pasos Después del Backtest

### Si Win Rate > 40% y Profit Factor > 1.2:

1. **Forward Testing (Demo):**
   ```bash
   TRADE_MODE=cfd pnpm demo:squeeze
   ```
   Deja correr 24-48 horas, compara con backtest.

2. **Paper Trading (Virtual):**
   Usa cuenta demo de Deriv, monitorea 1 semana.

3. **Live con Capital Pequeño:**
   Empieza con $100-500, risk 1% por trade.

### Si Resultados No Son Buenos:

1. Revisa los exit reasons (¿muchos SL?)
2. Ajusta parámetros (más conservador)
3. Prueba diferentes timeframes (3min, 5min)
4. Considera filtros adicionales (volatilidad, hora del día)

---

**¡Happy Backtesting! 📊🚀**
