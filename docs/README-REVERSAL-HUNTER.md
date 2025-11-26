# 🎯 Reversal Hunter Strategy

**"Hunter de reversals" conservadora** - Busca setups de alta convicción en zonas clave para binarias cortas (3-5 min exp).

## 🧠 Filosofía

- **Reactiva**: Analiza cada nueva vela, pero solo actúa si hay alineación total
- **Anti-overtrading**: Skip total si no hay alineación perfecta
- **Conservadora**: No chasea tendencias largas, solo reversals de alta convicción
- **Ideal para binarias cortas**: 3-5 min exp, perfecto para el sistema

## 🔧 Características

### **Patrones PA Detectados**
- **Pin Bar Alcista**: Cola inferior > 2x cuerpo, cierre upper third
- **Pin Bar Bajista**: Cola superior > 2x cuerpo, cierre lower third  
- **Engulfing Bullish**: Vela actual engulle total a la previa (bearish → bullish)
- **Engulfing Bearish**: Vela actual engulle total a la previa (bullish → bearish)

### **Sistema de Strength (1-2)**
- **Strength 1**: Patrón simple (pin bar básico)
- **Strength 2**: Patrón + confirmación (engulfing, inside bar)
- **Strength Calculation**:
  - Base: 1 (pin bar simple)
  - +1 si engulfing
  - +1 si inside bar follow-up
  - +1 si RSI alinea

### **Filtros en Cascada**
1. **Trend Filter**: EMA 20 (close > EMA para CALL, < EMA para PUT)
2. **Vol Filter**: ATR 14 (ATR actual > 1.0x ATR promedio)
3. **Session Filter**: 24/7 (configurable para 8-17 GMT)
4. **RSI Filter**: Bonus (no bloquea, solo añade strength)

## 📊 Configuración

### **Configuración Básica**
```typescript
const config: ReversalHunterConfig = {
  // Core
  name: 'ReversalHunter_Vol75',
  assets: ['R_75'],
  maxConcurrentTrades: 1,
  amount: 10,
  cooldownSeconds: 300, // 5 min
  
  // PA Patterns
  wick_multiplier: 2.0,    // Pin bar: wick > 2x body
  engulfing_ratio: 1.5,    // Engulfing: body > 1.5x prev
  
  // Strength
  min_strength_trade: 1,   // Mínimo strength para trade
  strength_2_boost: 1.2,  // Multiplicador para strength 2
  
  // Indicators
  ema_period: 20,
  atr_period: 14,
  rsi_period: 14,
  rsi_oversold: 30,
  rsi_overbought: 70,
  
  // Session (24/7 por defecto)
  sessionFilter: {
    enabled: false,
    activeHours: { start: 8, end: 17 },
    timezone: 'GMT'
  }
};
```

### **Modos de Configuración**

#### **Conservador**
```typescript
min_strength_trade: 2,     // Solo strength 2
cooldownSeconds: 600,      // 10 minutos
minConfidence: 0.8,        // 80% confianza
```

#### **Agresivo**
```typescript
min_strength_trade: 1,     // Acepta strength 1
cooldownSeconds: 180,      // 3 minutos
minConfidence: 0.6,        // 60% confianza
```

#### **Con Sesiones**
```typescript
sessionFilter: {
  enabled: true,
  activeHours: { start: 8, end: 17 },
  timezone: 'GMT'
}
```

## 🚀 Uso

### **Integración Básica**
```typescript
import { ReversalHunterStrategy } from './strategies/reversal-hunter-strategy.js';

const strategy = new ReversalHunterStrategy(config);
const executor = new AgnosticStrategyExecutor(executorConfig);

executor.addStrategy(strategy);
```

### **Monitoreo de Señales**
```typescript
strategy.on('signal', (signal) => {
  console.log(`🚨 Signal: ${signal.direction}`);
  console.log(`   Pattern: ${signal.metadata?.pattern}`);
  console.log(`   Strength: ${signal.metadata?.strength}`);
  console.log(`   Confidence: ${signal.confidence}`);
});
```

### **Tracking de Resultados**
```typescript
strategy.trackTradeResult(true);  // Win
strategy.trackTradeResult(false); // Loss

const state = strategy.getState();
console.log('Win Streak:', state.winStreak);
console.log('Loss Streak:', state.lossStreak);
```

## 📈 Métricas

### **Signal Generation**
- **Proximity Building**: 0-100% (para REPL display)
- **Strength Distribution**: Tracking de strength 1 vs 2
- **Pattern Success**: Win rate por tipo de patrón
- **Filter Performance**: % de signals que pasan cada filtro

### **Performance Tracking**
- **Win Rate por Strength**: Separado para strength 1 y 2
- **Daily Stats**: Integrado con PositionManager
- **Drawdown Tracking**: Para self-throttle
- **Racha Tracking**: Wins/losses consecutivos

## 🧪 Testing

### **Tests Unitarios**
```bash
npm test reversal-hunter-strategy.test.ts
```

### **Backtesting**
```typescript
import { simulateReversalHunter } from './examples/reversal-hunter-example.js';

const signals = simulateReversalHunter(historicalCandles);
console.log(`Generated ${signals.length} signals`);
```

### **Forward Testing**
```typescript
// 3-5 días en demo con stakes bajos
const bot = await startReversalHunterBot();
```

## ⚙️ Parámetros Optimizables

### **PA Patterns**
- `wick_multiplier`: 2.0 (ajustar si < 60% win rate)
- `engulfing_ratio`: 1.5 (ratio mínimo para engulfing)

### **Filters**
- `atr_multiplier`: 1.0 (threshold de volatilidad)
- `proximity_threshold`: 0.5% (proximidad a S/R)

### **Risk Management**
- `min_strength_trade`: 1-2 (filtro de strength)
- `cooldownSeconds`: 180-600 (cooldown entre trades)
- `minConfidence`: 0.6-0.8 (confianza mínima)

## 🔍 Monitoreo en Vivo

### **REPL Integration**
```typescript
// Proximity building display
console.log('Proximity: 60% (patrón OK pero filtro vol fail)');

// Auto-trade solo a 100%
if (proximity === 100) {
  // Execute trade
}
```

### **Health Checks**
- **API Limits**: Rate limit monitoring
- **Connection Stability**: Gateway health
- **Performance Metrics**: Real-time tracking

## 📚 Ejemplos

Ver archivos en `src/examples/`:
- `reversal-hunter-example.ts`: Configuraciones y simulación
- `integrate-reversal-hunter.ts`: Integración completa
- `reversal-hunter-strategy.test.ts`: Tests unitarios

## 🎯 Próximos Pasos

1. **Backtesting**: Validar con datos históricos Vol75
2. **Optimización**: Ajustar parámetros basado en resultados
3. **Forward Testing**: 3-5 días en demo
4. **Production**: Deploy con monitoreo completo

---

**¡La estrategia está lista para usar!** 🚀

Reutiliza al máximo el sistema existente y sigue las mejores prácticas del proyecto deriv-bot.
