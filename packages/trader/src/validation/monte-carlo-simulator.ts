/**
 * Monte Carlo Simulator
 * 
 * Implementa Monte Carlo simulation para estimar riesgo de ruina
 * y análisis de drawdown máximo
 */

import type { TradeResult } from '@deriv-bot/shared';

export interface MonteCarloConfig {
    /** Número de simulaciones */
    simulations: number;
    /** Capital inicial */
    initialCapital: number;
    /** Stake por trade (fijo o porcentaje) */
    stake: number;
    /** Tipo de stake ('fixed' o 'percentage') */
    stakeType: 'fixed' | 'percentage';
    /** Payout de opciones binarias */
    payout: number;
    /** Semilla para reproducibilidad */
    seed?: number;
}

export interface MonteCarloResult {
    /** Número de simulaciones */
    simulations: number;
    /** Capital inicial */
    initialCapital: number;
    /** Capital final promedio */
    averageFinalCapital: number;
    /** Capital final mediano */
    medianFinalCapital: number;
    /** Desviación estándar del capital final */
    finalCapitalStdDev: number;
    /** Probabilidad de ruina */
    ruinProbability: number;
    /** Drawdown máximo promedio */
    averageMaxDrawdown: number;
    /** Drawdown máximo del 95% peor caso */
    maxDrawdown95th: number;
    /** Distribución de capital final */
    finalCapitalDistribution: number[];
    /** Distribución de drawdown máximo */
    maxDrawdownDistribution: number[];
    /** Número de trades promedio por simulación */
    averageTradesPerSimulation: number;
    /** Win rate promedio por simulación */
    averageWinRatePerSimulation: number;
}

export interface SimulationOutcome {
    /** Resultado del trade (WIN/LOSS) */
    outcome: 'WIN' | 'LOSS';
    /** PnL del trade */
    pnl: number;
}

/**
 * Monte Carlo Simulator Class
 * 
 * Implementa Monte Carlo simulation para estimar riesgo de ruina
 * y análisis de drawdown máximo
 */
export class MonteCarloSimulator {
    private config: MonteCarloConfig;
    private winRate: number;
    private trades: SimulationOutcome[];

    constructor(config: MonteCarloConfig, trades: TradeResult[]) {
        this.config = {
            simulations: 1000,
            initialCapital: 1000,
            stake: 10,
            stakeType: 'fixed',
            payout: 0.8,
            seed: Math.random(),
            ...config
        };

        // Convertir trades a outcomes y calcular win rate
        this.trades = this.convertTradesToOutcomes(trades);
        this.winRate = this.calculateWinRate(this.trades);
    }

    /**
     * Ejecuta Monte Carlo simulation
     */
    async runSimulation(): Promise<MonteCarloResult> {
        if (this.trades.length === 0) {
            throw new Error('No hay trades para simular');
        }

        // Configurar semilla para reproducibilidad
        if (this.config.seed) {
            this.setSeed(this.config.seed);
        }

        const results = await this.runSimulations();

        return this.calculateResults(results);
    }

    /**
     * Ejecuta todas las simulaciones
     */
    private async runSimulations(): Promise<SimulationResult[]> {
        const results: SimulationResult[] = [];

        for (let i = 0; i < this.config.simulations; i++) {
            const result = this.runSingleSimulation();
            results.push(result);

            // Mostrar progreso cada 100 simulaciones
            if (i % 100 === 0) {
                console.log(`Monte Carlo progress: ${i}/${this.config.simulations} (${(i / this.config.simulations * 100).toFixed(1)}%)`);
            }
        }

        return results;
    }

    /**
     * Ejecuta una simulación individual
     */
    private runSingleSimulation(): SimulationResult {
        let capital = this.config.initialCapital;
        let maxCapital = capital;
        let maxDrawdown = 0;
        let tradesCount = 0;
        let winsCount = 0;
        const capitalHistory: number[] = [capital];

        // Simular secuencia de trades aleatoria
        const randomTrades = this.generateRandomTradeSequence();

        for (const trade of randomTrades) {
            // Calcular stake
            const stake = this.calculateStake(capital);

            // Verificar si hay suficiente capital
            if (capital < stake) {
                break; // Ruina
            }

            // Ejecutar trade
            const pnl = this.calculateTradePnL(trade, stake);
            capital += pnl;
            tradesCount++;

            if (trade.outcome === 'WIN') {
                winsCount++;
            }

            // Actualizar métricas
            if (capital > maxCapital) {
                maxCapital = capital;
            }

            const currentDrawdown = (maxCapital - capital) / maxCapital;
            if (currentDrawdown > maxDrawdown) {
                maxDrawdown = currentDrawdown;
            }

            capitalHistory.push(capital);
        }

        return {
            finalCapital: capital,
            maxDrawdown,
            tradesCount,
            winRate: tradesCount > 0 ? winsCount / tradesCount : 0,
            capitalHistory
        };
    }

    /**
     * Genera secuencia aleatoria de trades
     */
    private generateRandomTradeSequence(): SimulationOutcome[] {
        const sequence: SimulationOutcome[] = [];
        const maxTrades = this.trades.length * 2; // Simular hasta 2x los trades originales

        for (let i = 0; i < maxTrades; i++) {
            const randomIndex = Math.floor(Math.random() * this.trades.length);
            sequence.push(this.trades[randomIndex]);
        }

        return sequence;
    }

    /**
     * Calcula stake para un trade
     */
    private calculateStake(capital: number): number {
        if (this.config.stakeType === 'percentage') {
            return capital * (this.config.stake / 100);
        } else {
            return this.config.stake;
        }
    }

    /**
     * Calcula PnL de un trade
     */
    private calculateTradePnL(trade: SimulationOutcome, stake: number): number {
        if (trade.outcome === 'WIN') {
            return stake * this.config.payout;
        } else {
            return -stake;
        }
    }

    /**
     * Calcula resultados agregados
     */
    private calculateResults(results: SimulationResult[]): MonteCarloResult {
        const finalCapitals = results.map(r => r.finalCapital);
        const maxDrawdowns = results.map(r => r.maxDrawdown);
        const tradesCounts = results.map(r => r.tradesCount);
        const winRates = results.map(r => r.winRate);

        // Calcular estadísticas
        const averageFinalCapital = this.calculateMean(finalCapitals);
        const medianFinalCapital = this.calculateMedian(finalCapitals);
        const finalCapitalStdDev = this.calculateStdDev(finalCapitals, averageFinalCapital);

        // Calcular probabilidad de ruina
        const ruinCount = results.filter(r => r.finalCapital <= 0).length;
        const ruinProbability = ruinCount / results.length;

        // Calcular drawdown máximo
        const averageMaxDrawdown = this.calculateMean(maxDrawdowns);
        const sortedDrawdowns = [...maxDrawdowns].sort((a, b) => a - b);
        const maxDrawdown95th = sortedDrawdowns[Math.floor(0.95 * sortedDrawdowns.length)];

        // Calcular trades y win rate promedio
        const averageTradesPerSimulation = this.calculateMean(tradesCounts);
        const averageWinRatePerSimulation = this.calculateMean(winRates);

        return {
            simulations: this.config.simulations,
            initialCapital: this.config.initialCapital,
            averageFinalCapital,
            medianFinalCapital,
            finalCapitalStdDev,
            ruinProbability,
            averageMaxDrawdown,
            maxDrawdown95th,
            finalCapitalDistribution: finalCapitals,
            maxDrawdownDistribution: maxDrawdowns,
            averageTradesPerSimulation,
            averageWinRatePerSimulation
        };
    }

    /**
     * Convierte trades a outcomes
     */
    private convertTradesToOutcomes(trades: TradeResult[]): SimulationOutcome[] {
        return trades.map(trade => ({
            outcome: trade.win ? 'WIN' : 'LOSS',
            pnl: trade.pnl || 0
        }));
    }

    /**
     * Calcula win rate de una secuencia de outcomes
     */
    private calculateWinRate(outcomes: SimulationOutcome[]): number {
        const wins = outcomes.filter(o => o.outcome === 'WIN').length;
        return wins / outcomes.length;
    }

    /**
     * Calcula la media de un array de números
     */
    private calculateMean(values: number[]): number {
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    /**
     * Calcula la mediana de un array de números
     */
    private calculateMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    /**
     * Calcula la desviación estándar de un array de números
     */
    private calculateStdDev(values: number[], mean: number): number {
        const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    /**
     * Configura semilla para reproducibilidad
     */
    private setSeed(seed: number): void {
        // Implementación simple de semilla para Math.random()
        // En producción, usar una librería como seedrandom
        Math.random = (() => {
            let currentSeed = seed;
            return () => {
                currentSeed = (currentSeed * 9301 + 49297) % 233280;
                return currentSeed / 233280;
            };
        })();
    }

    /**
     * Genera reporte de Monte Carlo simulation
     */
    generateReport(result: MonteCarloResult): string {
        const lines: string[] = [];

        lines.push('🎲 MONTE CARLO SIMULATION REPORT');
        lines.push('═'.repeat(50));
        lines.push('');

        lines.push('📊 CONFIGURACIÓN:');
        lines.push(`   Simulaciones: ${result.simulations}`);
        lines.push(`   Capital inicial: $${result.initialCapital}`);
        lines.push(`   Stake: ${this.config.stake}${this.config.stakeType === 'percentage' ? '%' : '$'}`);
        lines.push(`   Payout: ${(this.config.payout * 100)}%`);
        lines.push('');

        lines.push('💰 RESULTADOS DE CAPITAL:');
        lines.push(`   Capital final promedio: $${result.averageFinalCapital.toFixed(2)}`);
        lines.push(`   Capital final mediano: $${result.medianFinalCapital.toFixed(2)}`);
        lines.push(`   Desviación estándar: $${result.finalCapitalStdDev.toFixed(2)}`);
        lines.push('');

        lines.push('⚠️ ANÁLISIS DE RIESGO:');
        lines.push(`   Probabilidad de ruina: ${(result.ruinProbability * 100).toFixed(2)}%`);
        lines.push(`   Drawdown máximo promedio: ${(result.averageMaxDrawdown * 100).toFixed(2)}%`);
        lines.push(`   Drawdown máximo (95% peor caso): ${(result.maxDrawdown95th * 100).toFixed(2)}%`);
        lines.push('');

        lines.push('📈 ESTADÍSTICAS DE TRADING:');
        lines.push(`   Trades promedio por simulación: ${result.averageTradesPerSimulation.toFixed(1)}`);
        lines.push(`   Win rate promedio: ${(result.averageWinRatePerSimulation * 100).toFixed(2)}%`);
        lines.push('');

        // Interpretación de resultados
        if (result.ruinProbability < 0.05) {
            lines.push('✅ RIESGO BAJO:');
            lines.push('   Probabilidad de ruina < 5%');
            lines.push('   Estrategia relativamente segura');
        } else if (result.ruinProbability < 0.20) {
            lines.push('⚠️ RIESGO MODERADO:');
            lines.push('   Probabilidad de ruina 5-20%');
            lines.push('   Estrategia aceptable con gestión de riesgo');
        } else {
            lines.push('❌ RIESGO ALTO:');
            lines.push('   Probabilidad de ruina > 20%');
            lines.push('   Estrategia muy riesgosa, no recomendada');
        }

        lines.push('');
        lines.push(`📊 Simulaciones ejecutadas: ${result.simulations}`);

        return lines.join('\n');
    }
}

/**
 * Resultado de una simulación individual
 */
interface SimulationResult {
    /** Capital final */
    finalCapital: number;
    /** Drawdown máximo */
    maxDrawdown: number;
    /** Número de trades */
    tradesCount: number;
    /** Win rate de la simulación */
    winRate: number;
    /** Historial de capital */
    capitalHistory: number[];
}
