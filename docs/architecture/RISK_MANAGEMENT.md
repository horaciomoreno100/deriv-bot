# Risk Management - Trading Bot

## Cambios Implementados

### ⚠️ Problema 1: Capital por Trade Muy Alto

**Antes:**
```typescript
const stake = balance * 0.15; // 15% del balance por trade en CFD!
// Con $6,185 balance = $927 por trade 😱
```

**Ahora:**
```typescript
const stake = balance * 0.02; // 2% del balance por trade en CFD
// Con $6,185 balance = $123 por trade ✅
```

**Impacto:**
- **Reducción de riesgo**: De 15% a 2% por trade (7.5x más conservador)
- **Mejor gestión de capital**: Permite más trades antes de pérdida significativa
- **Kelly Criterion compatible**: 2% está dentro del rango óptimo (1-3%)

### ⚠️ Problema 2: Trades Sin Condiciones de Cierre

**Antes:**
```typescript
// TP/SL estaban comentados
// takeProfit: undefined
// stopLoss: undefined
// Resultado: Trades abiertos indefinidamente, llegando a +$300 sin cerrar!
```

**Ahora:**
```typescript
// TP/SL activos con valores conservadores
takeProfit: entryPrice * (1 + 0.004)  // +0.4% TP
stopLoss: entryPrice * (1 - 0.002)    // -0.2% SL
// Risk/Reward Ratio: 2:1 (conservador)
```

**Impacto:**
- **Protección de ganancias**: Trades se cierran automáticamente al alcanzar +0.4%
- **Control de pérdidas**: Stop loss en -0.2% limita drawdown
- **Risk/Reward 2:1**: Por cada $100 arriesgados, potencial de ganar $200

## Configuración de Risk Management

### 1. Position Sizing (Tamaño de Posición)

```typescript
// Binary Options
const binaryStake = balance * 0.01; // 1% del balance

// CFD/Multipliers
const cfdStake = balance * 0.02; // 2% del balance
```

**Reglas:**
- **Máximo 2% por trade** (CFD)
- **Máximo 1% por trade** (Binary)
- **Mínimo $1.00** para cumplir requisitos del API

### 2. Take Profit (TP)

```typescript
const tpPercentage = 0.004; // 0.4% desde el entry
```

**Ejemplos:**
- **R_75** @ 40,000: TP = 40,160 (+160 pips)
- **R_100** @ 800: TP = 803.20 (+3.20 pips)

**Justificación:**
- **Scalping strategy**: Toma ganancias rápidas
- **Alta frecuencia**: Múltiples trades pequeños > un trade grande
- **Volatilidad considerada**: 0.4% es alcanzable en mercados volátiles

### 3. Stop Loss (SL)

```typescript
const slPercentage = 0.002; // 0.2% desde el entry
```

**Ejemplos:**
- **R_75** @ 40,000: SL = 39,920 (-80 pips)
- **R_100** @ 800: SL = 798.40 (-1.60 pips)

**Justificación:**
- **Tight stop**: Limita pérdidas en trades perdedores
- **Risk/Reward 2:1**: TP es 2x el SL
- **Preserva capital**: Permite recuperarse de pérdidas rápidamente

### 4. Risk/Reward Ratio

```
Risk/Reward = TP / SL = 0.4% / 0.2% = 2:1
```

**Significado:**
- Por cada **$100 arriesgados**, potencial de ganar **$200**
- Necesitas **win rate > 33%** para ser profitable
- Con 50% win rate, ganas **2x** lo que pierdes

## Cálculo de Riesgo Máximo

### Por Trade

```typescript
// CFD con multiplier 50
Stake: $123.70 (2% de $6,185)
Multiplier: 50x
Max Loss: $123.70 (stake completo si SL se ejecuta)
Max Gain: $247.40 (2x el stake con 0.4% TP)
```

### Por Sesión

```typescript
// Máximo 5 trades simultáneos (configuración actual)
Max Concurrent: 5 trades
Max Risk Per Session: $123.70 × 5 = $618.50 (10% del balance)
```

**Regla de Oro:**
- **Nunca arriesgar más de 10% del balance en trades simultáneos**
- Si 5 trades están abiertos, esperar a que cierren antes de abrir más

## Mejores Prácticas

### ✅ DO (Hacer)

1. **Respetar el 2% rule**: Nunca más de 2% por trade
2. **Siempre usar TP/SL**: Nunca entrar sin protección
3. **Monitor drawdown**: Si pérdida acumulada > 20%, pausar trading
4. **Diversificar**: Operar múltiples assets (R_75, R_100, etc.)
5. **Ajustar por volatilidad**: En alta volatilidad, reducir stake a 1%

### ❌ DON'T (No Hacer)

1. **Revenge trading**: No doblar stake después de pérdida
2. **Overtrading**: Respetar cooldown entre trades
3. **Ignorar TP/SL**: Nunca remover protecciones
4. **FOMO**: No entrar sin señal clara
5. **Over-leverage**: Multiplier > 100x es gambling, no trading

## Monitoring & Alerts

### Key Metrics

```typescript
// Trackear en tiempo real
1. Win Rate: wonTrades / totalTrades
2. Average Win: totalProfits / wonTrades
3. Average Loss: totalLosses / lostTrades
4. Profit Factor: totalProfits / Math.abs(totalLosses)
5. Max Drawdown: maxLoss desde peak
```

### Alert Thresholds

```typescript
// Alertas automáticas
if (drawdown > 0.15) {
  alert("⚠️ Drawdown > 15% - Reduce stake!");
}

if (winRate < 0.40 && totalTrades > 20) {
  alert("⚠️ Win rate < 40% - Review strategy!");
}

if (openPositions >= 5) {
  alert("⚠️ Max concurrent trades reached!");
}
```

## Backtesting Results (Estimados)

### Con Risk Management (Nuevo)

```
Balance Inicial: $10,000
Stake por trade: $200 (2%)
TP: +0.4% | SL: -0.2%
Win Rate: 50%

Después de 100 trades:
- Wins: 50 × $400 = $20,000
- Losses: 50 × $200 = $10,000
- Net Profit: $10,000
- ROI: 100%
- Max Drawdown: ~$2,000 (20%)
```

### Sin Risk Management (Anterior)

```
Balance Inicial: $10,000
Stake por trade: $1,500 (15%)
Sin TP/SL
Win Rate: 50%

Después de 5 trades perdidos consecutivos:
- Balance: $2,500 (pérdida de $7,500)
- Max Drawdown: 75% 😱
- Recovery needed: +300% para volver a $10,000
```

## Ajustes Dinámicos

### Por Volatilidad

```typescript
// Alta volatilidad (ATR > threshold)
if (atr > volatilityThreshold) {
  stake = balance * 0.01; // Reduce a 1%
  tpPercentage = 0.006;   // Aumenta TP a 0.6%
  slPercentage = 0.003;   // Aumenta SL a 0.3%
}

// Baja volatilidad
else {
  stake = balance * 0.02; // Normal 2%
  tpPercentage = 0.004;   // TP 0.4%
  slPercentage = 0.002;   // SL 0.2%
}
```

### Por Performance

```typescript
// Winning streak
if (consecutiveWins >= 3) {
  stake = balance * 0.025; // Aumenta ligeramente a 2.5%
}

// Losing streak
if (consecutiveLosses >= 2) {
  stake = balance * 0.01; // Reduce a 1%
  // Consider pausing trading
}
```

## Ejemplo de Trade Log

```
📊 TRADE EJECUTADO
   Asset: R_75
   Direction: BUY
   Entry Price: 40,000.00
   Stake: $123.70 (2% of $6,185)
   Multiplier: 50x
   Take Profit: 40,160.00 (+0.4%)
   Stop Loss: 39,920.00 (-0.2%)
   Risk/Reward: 2:1
   Max Loss: $123.70
   Max Gain: $247.40

✅ TRADE CERRADO (Take Profit)
   Exit Price: 40,160.00
   P&L: +$247.40
   Balance: $6,432.40
   ROI: +4.0%
```

## Referencias

- [Kelly Criterion](https://en.wikipedia.org/wiki/Kelly_criterion)
- [Risk of Ruin Calculator](https://www.myfxbook.com/forex-calculators/risk-of-ruin)
- [Position Sizing Strategies](https://www.investopedia.com/articles/trading/09/position-sizing.asp)

## Próximas Mejoras

1. **Dynamic Position Sizing**: Ajustar stake basado en volatilidad
2. **Trailing Stop Loss**: Mover SL a BE después de +X%
3. **Partial Profit Taking**: Cerrar 50% en +0.2%, dejar 50% para +0.4%
4. **Portfolio Heat**: Limitar riesgo total a 10% del balance
5. **Time-based Exits**: Cerrar trades después de X minutos si no TP/SL
