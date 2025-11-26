# Alternativas de ML para Node.js - Binary Options Trading

## Investigación: Mejores Librerías ML para Node.js (2025)

### Top 3 Alternativas a TensorFlow.js

#### 1. 🧠 Brain.js (★ RECOMENDADA)
**Ventajas**:
- ✅ **Cero problemas de compilación** - Pure JavaScript
- ✅ **Soporte para Time Series** - `LSTMTimeStep` específico para predicción temporal
- ✅ **GPU Acceleration** opcional (pero funciona bien en CPU)
- ✅ **API simple y directa** - Mucho más fácil que TensorFlow.js
- ✅ **Activamente mantenida** (2025)
- ✅ **Diseñada específicamente para trading/stocks/weather predictions**

**Desventajas**:
- ⚠️ Menos features avanzados que TensorFlow
- ⚠️ Documentación más limitada

**Instalación**:
```bash
npm install brain.js
```

**Ejemplo básico**:
```javascript
import brain from 'brain.js';

const net = new brain.recurrent.LSTMTimeStep({
  inputSize: 17,  // Número de features
  hiddenLayers: [64, 32],
  outputSize: 1   // Predicción binaria
});

// Training data: array de arrays
net.train(trainingData, {
  iterations: 2000,
  errorThresh: 0.005
});

// Predict
const prediction = net.run(inputSequence);
```

**Tipos de redes disponibles**:
- `brain.NeuralNetwork` - Feedforward básica
- `brain.recurrent.LSTM` - Para secuencias
- `brain.recurrent.LSTMTimeStep` - ⭐ Ideal para time series trading
- `brain.recurrent.GRU` - Alternativa más rápida a LSTM

---

#### 2. 🔬 ML.js (Modular)
**Ventajas**:
- ✅ **Muy modular** - Instalas solo lo que necesitas
- ✅ **Algoritmos científicos probados** - Random Forest, SVM, Naive Bayes
- ✅ **Excelente para feature engineering**
- ✅ **No requiere compilación**

**Desventajas**:
- ⚠️ No tiene LSTM out-of-the-box
- ⚠️ Mejor para algoritmos clásicos que deep learning

**Instalación** (modular):
```bash
npm install ml-random-forest
npm install ml-naivebayes
npm install ml-matrix
```

**Ejemplo - Random Forest**:
```javascript
import { RandomForestClassifier } from 'ml-random-forest';

const classifier = new RandomForestClassifier({
  nEstimators: 100,
  maxDepth: 10
});

classifier.train(X_train, y_train);
const predictions = classifier.predict(X_test);
```

**Mejor para**:
- Ensemble methods (Random Forest, Gradient Boosting)
- Feature selection
- Classical ML algorithms

---

#### 3. 🎨 Synaptic
**Ventajas**:
- ✅ **Architecture-free** - Puedes crear cualquier topología
- ✅ **Pre-built networks** (LSTM, Hopfield, etc.)
- ✅ **Desarrollado por MIT**

**Desventajas**:
- ⚠️ **Menos activo** - Última actualización hace tiempo
- ⚠️ API más compleja que Brain.js

**No recomendada** por falta de mantenimiento activo.

---

## Comparación Directa

| Feature | TensorFlow.js | Brain.js | ML.js |
|---------|--------------|----------|-------|
| **Instalación** | ❌ Problemas | ✅ Fácil | ✅ Fácil |
| **LSTM/RNN** | ✅ Completo | ✅ LSTMTimeStep | ❌ No |
| **Random Forest** | ❌ No | ❌ No | ✅ Sí |
| **Velocidad Training** | ❌ Lento (CPU) | ✅ Rápido | ✅ Muy rápido |
| **Time Series** | ✅ Sí | ✅✅ Especializado | ⚠️ Manual |
| **Documentación** | ✅✅ Extensa | ✅ Buena | ✅ Modular |
| **Tamaño Bundle** | ❌ Grande | ✅ Pequeño | ✅ Tiny |
| **Producción** | ✅ Enterprise | ✅ Startups | ✅ Prototipos |

---

## Recomendación para Binary Options Trading

### 🏆 Opción 1: Brain.js LSTM (Mejor para Time Series)

**Por qué elegirla**:
1. Diseñada específicamente para predicción de mercados
2. `LSTMTimeStep` es perfecto para secuencias de velas
3. API extremadamente simple
4. Cero problemas de setup

**Implementación**:
```javascript
import brain from 'brain.js';

// Preparar datos: secuencias de 30 velas
const trainingData = [];
for (let i = 30; i < candles.length; i++) {
  const input = candles.slice(i-30, i).map(c => ({
    close: normalize(c.close),
    rsi: c.rsi / 100,
    // ... más features
  }));

  const output = candles[i].close > candles[i-1].close ? [1] : [0];

  trainingData.push({ input, output });
}

// Entrenar
const net = new brain.recurrent.LSTMTimeStep();
net.train(trainingData);

// Predecir
const prediction = net.run(lastSequence);
```

**Estimado de performance**:
- Training: 2-5 minutos para 40k candles
- Prediction: <10ms por secuencia
- Memory: ~200MB

---

### 🥈 Opción 2: ML.js Random Forest (Mejor para Classical ML)

**Por qué elegirla**:
1. Random Forest es robusto y menos propenso a overfitting
2. Más rápido de entrenar que LSTM
3. Interpretable (puedes ver feature importance)

**Implementación**:
```javascript
import { RandomForestClassifier } from 'ml-random-forest';

// Features: vector plano por cada candle
const X_train = candles.map(c => [
  c.rsi,
  c.stochastic,
  c.bbPosition,
  c.macd,
  // ... 17 features total
]);

const y_train = labels; // [1, 0, 1, 0, ...]

const rf = new RandomForestClassifier({
  nEstimators: 100,
  maxDepth: 10,
  minSamplesLeaf: 5
});

rf.train(X_train, y_train);

// Feature importance
console.log('Feature importance:', rf.featureImportance());
```

**Estimado de performance**:
- Training: 30 segundos - 1 minuto
- Prediction: <1ms
- Memory: ~50MB

---

### 🥉 Opción 3: Hybrid Approach

Combinar ambas:
1. **Random Forest** para feature selection (saber qué indicadores importan)
2. **Brain.js LSTM** para la predicción final con features seleccionados

---

## Plan de Implementación

### Fase 1: Brain.js LSTM (2-3 horas)
1. ✅ Instalar brain.js
2. ✅ Adaptar feature engineering para formato Brain.js
3. ✅ Crear script de training
4. ✅ Implementar BrainJSStrategy
5. ✅ Backtest y comparar con estrategias tradicionales

### Fase 2: ML.js Random Forest (1-2 horas)
1. ✅ Instalar ml-random-forest
2. ✅ Convertir features a formato tabular
3. ✅ Entrenar y evaluar
4. ✅ Comparar con LSTM

### Fase 3: Ensemble (opcional, 1 hora)
1. ✅ Combinar predicciones de ambos modelos
2. ✅ Sistema de voting o promedio ponderado

---

## Código de Ejemplo Completo

### Brain.js - Time Series Prediction

```javascript
import brain from 'brain.js';
import { FeatureEngineer } from './ml/feature-engineering.js';

// 1. Preparar datos
const engineer = new FeatureEngineer();
const features = engineer.extractFeatures(candles, true);

// 2. Convertir a formato Brain.js
const trainingData = [];
const SEQUENCE_LENGTH = 30;

for (let i = SEQUENCE_LENGTH; i < features.length; i++) {
  const sequence = features.slice(i - SEQUENCE_LENGTH, i);

  // Input: secuencia de features normalizados
  const input = sequence.map(f => [
    f.closeNorm,
    f.rsi / 100,
    f.stochastic / 100,
    f.bbPosition,
    f.macd
    // ... más features
  ]);

  // Output: dirección (0 o 1)
  const output = [features[i].label]; // ya es 0 o 1

  trainingData.push({ input, output });
}

// 3. Crear y entrenar red
const net = new brain.recurrent.LSTMTimeStep({
  inputSize: 5, // número de features
  hiddenLayers: [20, 20], // más pequeño que TensorFlow
  outputSize: 1
});

console.log('🏋️ Training...');
const stats = net.train(trainingData, {
  iterations: 2000,
  errorThresh: 0.005,
  log: (stats) => console.log(`Iteration ${stats.iterations}, Error: ${stats.error}`),
  logPeriod: 100
});

console.log('✅ Training complete:', stats);

// 4. Predecir
const testSequence = [...]; // últimos 30 candles
const prediction = net.run(testSequence);

console.log('Prediction:', prediction > 0.5 ? 'CALL' : 'PUT');
console.log('Confidence:', Math.abs(prediction - 0.5) * 2);
```

---

## Conclusiones

### ✅ Brain.js es la mejor opción porque:

1. **Soluciona el problema principal**: No requiere compilación de addons nativos
2. **Especializada en time series**: `LSTMTimeStep` es exactamente lo que necesitamos
3. **Rápida**: Training en minutos, no horas
4. **Simple**: API mucho más fácil que TensorFlow.js
5. **Probada**: Usada en producción para stock prediction

### 📊 Expected Results:

Si logramos 55-58% de accuracy con Brain.js LSTM:
- ✅ **Profitable** (breakeven es 55.6%)
- 🎯 Target realista para modelos ML
- 📈 Mejor que estrategias tradicionales (50%)

### 🚀 Next Steps:

1. Implementar Brain.js LSTM
2. Entrenar en datos de R_100
3. Walk-forward validation
4. Si funciona → deploy a producción
5. Si no funciona → probar Random Forest o diferentes markets

---

**¿Procedemos con la implementación de Brain.js?**
