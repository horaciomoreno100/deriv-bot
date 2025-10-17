/**
 * Bootstrap Tester
 * 
 * Implementa Bootstrap testing para validar la estabilidad estadística
 * de los resultados de backtesting
 */

import type { TradeResult } from '@deriv-bot/shared';

export interface BootstrapConfig {
    /** Número de iteraciones bootstrap */
    iterations: number;
    /** Nivel de confianza (0.95 = 95%) */
    confidenceLevel: number;
    /** Semilla para reproducibilidad */
    seed?: number;
}

export interface BootstrapResult {
    /** Win rate original */
    originalWinRate: number;
    /** Win rate promedio de bootstrap */
    bootstrapMean: number;
    /** Desviación estándar de bootstrap */
    bootstrapStdDev: number;
    /** Intervalo de confianza inferior */
    confidenceIntervalLower: number;
    /** Intervalo de confianza superior */
    confidenceIntervalUpper: number;
    /** Número de iteraciones */
    iterations: number;
    /** Distribución de win rates */
    winRateDistribution: number[];
    /** P-value para test de estabilidad */
    pValue: number;
    /** ¿Es estadísticamente estable? */
    isStable: boolean;
}

export interface TradeOutcome {
    /** Resultado del trade (WIN/LOSS) */
    outcome: 'WIN' | 'LOSS';
    /** PnL del trade */
    pnl: number;
    /** Timestamp del trade */
    timestamp: number;
}

/**
 * Bootstrap Tester Class
 * 
 * Implementa Bootstrap testing para validar la estabilidad estadística
 * de los resultados de backtesting
 */
export class BootstrapTester {
    private config: BootstrapConfig;

    constructor(config: BootstrapConfig) {
        this.config = {
            iterations: 1000,
            confidenceLevel: 0.95,
            seed: Math.random(),
            ...config
        };
    }

    /**
     * Ejecuta Bootstrap testing en una secuencia de trades
     */
    async runBootstrapTest(trades: TradeResult[]): Promise<BootstrapResult> {
        if (trades.length === 0) {
            throw new Error('No hay trades para analizar');
        }

        // Convertir trades a outcomes
        const outcomes = this.convertTradesToOutcomes(trades);

        // Calcular win rate original
        const originalWinRate = this.calculateWinRate(outcomes);

        // Ejecutar bootstrap iterations
        const bootstrapWinRates = await this.runBootstrapIterations(outcomes);

        // Calcular estadísticas
        const bootstrapMean = this.calculateMean(bootstrapWinRates);
        const bootstrapStdDev = this.calculateStdDev(bootstrapWinRates, bootstrapMean);

        // Calcular intervalo de confianza
        const sortedWinRates = [...bootstrapWinRates].sort((a, b) => a - b);
        const alpha = 1 - this.config.confidenceLevel;
        const lowerIndex = Math.floor(alpha / 2 * bootstrapWinRates.length);
        const upperIndex = Math.floor((1 - alpha / 2) * bootstrapWinRates.length);

        const confidenceIntervalLower = sortedWinRates[lowerIndex];
        const confidenceIntervalUpper = sortedWinRates[upperIndex];

        // Calcular p-value para test de estabilidad
        const pValue = this.calculatePValue(originalWinRate, bootstrapWinRates);

        // Determinar si es estadísticamente estable
        const isStable = this.isStatisticallyStable(
            originalWinRate,
            confidenceIntervalLower,
            confidenceIntervalUpper,
            pValue
        );

        return {
            originalWinRate,
            bootstrapMean,
            bootstrapStdDev,
            confidenceIntervalLower,
            confidenceIntervalUpper,
            iterations: this.config.iterations,
            winRateDistribution: bootstrapWinRates,
            pValue,
            isStable
        };
    }

    /**
     * Convierte trades a outcomes para bootstrap
     */
    private convertTradesToOutcomes(trades: TradeResult[]): TradeOutcome[] {
        return trades.map(trade => ({
            outcome: trade.win ? 'WIN' : 'LOSS',
            pnl: trade.pnl || 0,
            timestamp: trade.entryTime
        }));
    }

    /**
     * Calcula win rate de una secuencia de outcomes
     */
    private calculateWinRate(outcomes: TradeOutcome[]): number {
        const wins = outcomes.filter(o => o.outcome === 'WIN').length;
        return wins / outcomes.length;
    }

    /**
     * Ejecuta iteraciones de bootstrap
     */
    private async runBootstrapIterations(outcomes: TradeOutcome[]): Promise<number[]> {
        const bootstrapWinRates: number[] = [];

        // Configurar semilla para reproducibilidad
        if (this.config.seed) {
            this.setSeed(this.config.seed);
        }

        for (let i = 0; i < this.config.iterations; i++) {
            // Reordenamiento aleatorio con reemplazo
            const bootstrapSample = this.createBootstrapSample(outcomes);
            const winRate = this.calculateWinRate(bootstrapSample);
            bootstrapWinRates.push(winRate);

            // Mostrar progreso cada 100 iteraciones
            if (i % 100 === 0) {
                console.log(`Bootstrap progress: ${i}/${this.config.iterations} (${(i / this.config.iterations * 100).toFixed(1)}%)`);
            }
        }

        return bootstrapWinRates;
    }

    /**
     * Crea una muestra bootstrap con reemplazo
     */
    private createBootstrapSample(outcomes: TradeOutcome[]): TradeOutcome[] {
        const sample: TradeOutcome[] = [];

        for (let i = 0; i < outcomes.length; i++) {
            const randomIndex = Math.floor(Math.random() * outcomes.length);
            sample.push(outcomes[randomIndex]);
        }

        return sample;
    }

    /**
     * Calcula la media de un array de números
     */
    private calculateMean(values: number[]): number {
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    /**
     * Calcula la desviación estándar de un array de números
     */
    private calculateStdDev(values: number[], mean: number): number {
        const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    /**
     * Calcula p-value para test de estabilidad
     */
    private calculatePValue(originalWinRate: number, bootstrapWinRates: number[]): number {
        // Contar cuántas veces el win rate bootstrap es más extremo que el original
        const extremeCount = bootstrapWinRates.filter(wr =>
            Math.abs(wr - 0.5) >= Math.abs(originalWinRate - 0.5)
        ).length;

        return extremeCount / bootstrapWinRates.length;
    }

    /**
     * Determina si los resultados son estadísticamente estables
     */
    private isStatisticallyStable(
        originalWinRate: number,
        confidenceIntervalLower: number,
        confidenceIntervalUpper: number,
        pValue: number
    ): boolean {
        // Criterios para estabilidad:
        // 1. El win rate original está dentro del intervalo de confianza
        // 2. El intervalo de confianza no es demasiado amplio (< 0.2)
        // 3. El p-value es > 0.05 (no es significativamente diferente de 0.5)

        const isWithinConfidenceInterval =
            originalWinRate >= confidenceIntervalLower &&
            originalWinRate <= confidenceIntervalUpper;

        const isNarrowConfidenceInterval =
            (confidenceIntervalUpper - confidenceIntervalLower) < 0.2;

        const isNotSignificantlyDifferent = pValue > 0.05;

        return isWithinConfidenceInterval && isNarrowConfidenceInterval && isNotSignificantlyDifferent;
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
     * Genera reporte de Bootstrap testing
     */
    generateReport(result: BootstrapResult): string {
        const lines: string[] = [];

        lines.push('🔍 BOOTSTRAP TESTING REPORT');
        lines.push('═'.repeat(50));
        lines.push('');

        lines.push('📊 ESTADÍSTICAS:');
        lines.push(`   Win Rate Original: ${(result.originalWinRate * 100).toFixed(2)}%`);
        lines.push(`   Win Rate Bootstrap (promedio): ${(result.bootstrapMean * 100).toFixed(2)}%`);
        lines.push(`   Desviación Estándar: ${(result.bootstrapStdDev * 100).toFixed(2)}%`);
        lines.push('');

        lines.push('📈 INTERVALO DE CONFIANZA:');
        lines.push(`   Nivel de confianza: ${(this.config.confidenceLevel * 100)}%`);
        lines.push(`   Intervalo: [${(result.confidenceIntervalLower * 100).toFixed(2)}%, ${(result.confidenceIntervalUpper * 100).toFixed(2)}%]`);
        lines.push(`   Amplitud: ${((result.confidenceIntervalUpper - result.confidenceIntervalLower) * 100).toFixed(2)}%`);
        lines.push('');

        lines.push('🧪 TEST DE ESTABILIDAD:');
        lines.push(`   P-value: ${result.pValue.toFixed(4)}`);
        lines.push(`   ¿Es estable?: ${result.isStable ? '✅ SÍ' : '❌ NO'}`);
        lines.push('');

        if (result.isStable) {
            lines.push('✅ CONCLUSIÓN:');
            lines.push('   Los resultados son estadísticamente estables');
            lines.push('   El win rate es confiable para trading');
            lines.push('   Recomendado para implementación');
        } else {
            lines.push('⚠️ CONCLUSIÓN:');
            lines.push('   Los resultados NO son estadísticamente estables');
            lines.push('   El win rate puede no ser confiable');
            lines.push('   Se recomienda más validación antes de implementar');
        }

        lines.push('');
        lines.push(`📊 Iteraciones ejecutadas: ${result.iterations}`);

        return lines.join('\n');
    }
}
