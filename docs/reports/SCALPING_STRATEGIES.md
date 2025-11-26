# Estrategias de Scalping para Timeframes de 1-15 Minutos

## Resumen Ejecutivo
Este documento recopila las mejores estrategias de scalping para implementar en el bot de trading, enfocadas en timeframes de 1, 5 y 15 minutos.

---

## 1. Estrategia RSI + Bollinger Bands (1-5 Minutos)

### Configuración de Indicadores:
- **RSI**: Período 7 para scalping agresivo, 14 para scalping conservador
  - Sobrecompra: 80
  - Sobreventa: 20
- **Bollinger Bands**:
  - Período: 20
  - Desviación estándar: 2
- **EMA auxiliar**: 9 períodos (filtro de tendencia)

### Señales de COMPRA:
1. RSI cae por debajo de 20 y luego cruza de vuelta por encima de 20
2. El precio toca o atraviesa ligeramente la banda inferior de Bollinger
3. El precio está por encima de la EMA 9 (confirma tendencia alcista)

### Señales de VENTA:
1. RSI sube por encima de 80 y luego cruza de vuelta por debajo de 80
2. El precio toca la banda superior de Bollinger
3. El precio está por debajo de la EMA 9 (confirma tendencia bajista)

### Gestión de Riesgo:
- **Take Profit**: 3-5 pips para 1 minuto, 5-10 pips para 5 minutos
- **Stop Loss**: Justo más allá del último swing high/low
- **Evitar**: Mercados planos donde las bandas de Bollinger están estrechas

---

## 2. Estrategia EMA Crossover (1-5 Minutos)

### Configuración de Indicadores:
- **EMA Rápida**: 5 o 9 períodos
- **EMA Lenta**: 21 períodos
- **EMA de Tendencia (opcional)**: 50 períodos para confirmar tendencia mayor

### Variante Multi-EMA (5-8-13-21):
Para mayor confirmación, usar cuatro EMAs donde el alineamiento completo indica momentum fuerte:
- Tendencia alcista fuerte: 5 > 8 > 13 > 21
- Tendencia bajista fuerte: 5 < 8 < 13 < 21

### Señales de Trading:
- **Señal de COMPRA**: EMA rápida cruza por encima de EMA lenta (Golden Cross)
- **Señal de VENTA**: EMA rápida cruza por debajo de EMA lenta (Death Cross)

### Gestión de Riesgo:
- **Take Profit**: Basado en el precio de entrada y preferencia de riesgo (1.5-2x el riesgo)
- **Stop Loss**: Se cierra cuando el precio alcanza el nivel de take-profit o stop-loss
- **Confirmación**: Revisar timeframes superiores (5m, 15m) para confirmar dirección de tendencia mayor

---

## 3. Estrategia Stochastic Oscillator + MA (1-5 Minutos)

### Configuración de Indicadores:
- **Stochastic Oscillator**:
  - Para 1 minuto: %K=9, %D=3, Smoothing=1 (o más agresivo: 5,3,3 o 8,3,3)
  - Para 5 minutos: %K=14, %D=3, Smoothing=3
  - Zona sobrecompra: 80
  - Zona sobreventa: 20
- **Moving Average**: SMA 50 o EMA 21 (filtro de tendencia)

### Señales de COMPRA:
1. Stochastic está en zona de sobreventa (<20)
2. Ambas líneas %K y %D cruzan hacia arriba saliendo de la zona de sobreventa
3. El precio está por encima de la MA (tendencia alcista)

### Señales de VENTA:
1. Stochastic está en zona de sobrecompra (>80)
2. Ambas líneas %K y %D cruzan hacia abajo saliendo de la zona de sobrecompra
3. El precio está por debajo de la MA (tendencia bajista)

### Gestión de Riesgo:
- Usar en conjunto con otros indicadores (RSI, MACD) para confirmación
- Evitar operar contra la tendencia del timeframe superior
- **Take Profit**: Cuando el stochastic alcanza el extremo opuesto
- **Stop Loss**: 1-2% del capital por operación

---

## 4. Estrategia MACD + EMA (15 Minutos)

### Configuración de Indicadores:
- **MACD**:
  - Fast EMA: 12
  - Slow EMA: 26
  - Signal Line: 9
- **EMA**: 50 períodos (tendencia)
- **Volume Indicator**: Para confirmar fuerza

### Señales de Trading:
- **Señal de COMPRA**:
  1. MACD cruza por encima de la línea de señal
  2. MACD está por encima de 0 (momentum alcista)
  3. Precio por encima de EMA 50
  4. Volumen en aumento

- **Señal de VENTA**:
  1. MACD cruza por debajo de la línea de señal
  2. MACD está por debajo de 0 (momentum bajista)
  3. Precio por debajo de EMA 50
  4. Volumen en aumento

### Gestión de Riesgo:
- Timeframe de 15 minutos permite menor ruido y mayor precisión
- **Take Profit**: 15-25 pips
- **Stop Loss**: Basado en niveles de soporte/resistencia

---

## 5. Estrategia Momentum Breakout (1-5 Minutos)

### Configuración de Indicadores:
- **RSI**: 14 períodos
- **MACD**: Configuración estándar (12, 26, 9)
- **Volume Indicator**
- **Bollinger Bands**: 20, 2 (identificar breakouts)

### Señales de Trading:
1. Identificar activos con momentum significativo
2. RSI > 60 para compra o RSI < 40 para venta
3. MACD confirma la dirección del momentum
4. Precio rompe por encima/debajo de Bollinger Band
5. Volumen significativamente elevado

### Características:
- Capitaliza movimientos fuertes de precio en timeframes muy cortos
- Requiere reacción rápida
- Alto riesgo, alto potencial de ganancia
- **Take Profit**: 5-10 pips dependiendo de la volatilidad
- **Stop Loss**: Muy ajustado, 2-3 pips

---

## 6. Estrategia Multi-Timeframe (Combinada)

### Marco de Análisis:
- **15 minutos**: Identificar tendencia general
- **5 minutos**: Buscar puntos de entrada
- **1 minuto**: Timing preciso de entrada

### Configuración:
- **Timeframe superior (15m)**:
  - EMA 50 y 200 para tendencia
  - RSI para momentum general

- **Timeframe medio (5m)**:
  - Bollinger Bands
  - Stochastic para zonas de entrada

- **Timeframe de entrada (1m)**:
  - EMA 9 y 21 para crossover
  - Confirmación final de entrada

### Reglas:
1. Solo operar en la dirección de la tendencia del timeframe de 15m
2. Buscar señales de entrada en 5m
3. Ejecutar la entrada con precisión en 1m
4. Exit cuando señales en 5m o 15m indican reversión

---

## Recomendaciones Generales para Scalping

### Mejores Pares de Trading:
- **Forex**: EUR/USD, GBP/USD, USD/JPY (spreads bajos)
- **Crypto**: BTC/USDT, ETH/USDT (alta liquidez)
- **Opciones Binarias**: Los mismos pares, enfoque en señales de 1-5 minutos

### Horarios Óptimos:
- Sesión de Londres (08:00-12:00 GMT)
- Sesión de Nueva York (13:00-17:00 GMT)
- Overlap Londres-Nueva York (13:00-16:00 GMT) - Mayor liquidez

### Gestión de Riesgo General:
1. **Nunca arriesgar más del 1-2% del capital por operación**
2. **Ratio Risk/Reward mínimo**: 1:1.5 o 1:2
3. **Stop Loss siempre activo**: No operar sin protección
4. **Limitar número de operaciones diarias**: Evitar overtrading (5-10 trades máximo)
5. **Registrar todas las operaciones**: Llevar journal de trading

### Consideraciones Psicológicas:
- Scalping requiere disciplina extrema
- Decisiones rápidas pero no impulsivas
- No perseguir pérdidas
- Tomar descansos regulares
- No operar con emociones alteradas

### Factores de Éxito:
1. **Velocidad de ejecución**: Latencia baja crítica
2. **Spreads bajos**: Fundamental para rentabilidad
3. **Liquidez alta**: Evitar slippage
4. **Broker confiable**: Sin requotes ni manipulación
5. **Backtesting exhaustivo**: Validar estrategia antes de operar en real

---

## Priorización para Implementación en el Bot

### Nivel 1 (Más Simples y Efectivas):
1. **EMA Crossover (9/21)** - Fácil de implementar, señales claras
2. **RSI + Bollinger Bands** - Combinación probada, buenos resultados

### Nivel 2 (Complejidad Media):
3. **Stochastic + MA** - Requiere más validación
4. **MACD + EMA (15m)** - Menor frecuencia, más confiable

### Nivel 3 (Más Complejas):
5. **Momentum Breakout** - Requiere análisis de volumen en tiempo real
6. **Multi-Timeframe** - Más compleja, pero potencialmente más precisa

---

## Próximos Pasos

1. **Implementar indicadores técnicos** en el sistema:
   - RSI
   - Bollinger Bands
   - EMA (múltiples períodos)
   - Stochastic Oscillator
   - MACD

2. **Crear sistema de señales** basado en las estrategias anteriores

3. **Backtesting exhaustivo** con datos históricos de 1m, 5m, 15m

4. **Paper trading** antes de trading real

5. **Optimización de parámetros** basada en resultados

6. **Implementar gestión de riesgo** estricta

7. **Monitoreo y logging** completo de todas las operaciones
