/**
 * Trade Adapter - Switches between Binary Options and CFDs/Multipliers
 * 
 * This adapter allows strategies to work with both contract types:
 * - Binary Options: CALL/PUT with fixed expiry
 * - CFDs/Multipliers: BUY/SELL with TP/SL
 */

import type { GatewayClient } from '@deriv-bot/shared';

/**
 * Trade mode type
 */
export type TradeMode = 'binary' | 'cfd';

/**
 * Trade direction (unified interface)
 */
export type TradeDirection = 'CALL' | 'PUT' | 'BUY' | 'SELL';

/**
 * Binary Options Trade Parameters
 */
export interface BinaryTradeParams {
    asset: string;
    direction: 'CALL' | 'PUT';
    amount: number;
    duration: number;
    durationUnit: 's' | 'm' | 'h' | 'd';
    strategyName?: string;
}

/**
 * CFD/Multiplier Trade Parameters
 */
export interface CFDTradeParams {
    asset: string;
    direction: 'BUY' | 'SELL';
    amount: number;
    multiplier: number;
    duration?: number;      // Optional: duration for auto-close
    durationUnit?: 's' | 'm' | 'h' | 'd'; // Optional: duration unit
    takeProfit?: number;    // Price level for TP
    stopLoss?: number;      // Price level for SL
    strategyName?: string;
    account?: string;       // Optional: specific loginid or 'current' (default)
}

/**
 * Unified Trade Parameters
 */
export type TradeParams = BinaryTradeParams | CFDTradeParams;

/**
 * Trade Result
 */
export interface TradeResult {
    contractId: string;
    mode: TradeMode;
    asset: string;
    direction: TradeDirection;
    amount: number;
    entryPrice: number;
    timestamp: number;
    // Binary Options specific
    expiryTime?: number;
    payout?: number;
    // CFD specific
    multiplier?: number;
    takeProfit?: number;
    stopLoss?: number;
}

/**
 * Trade Adapter Interface
 */
export interface ITradeAdapter {
    /**
     * Execute a trade
     */
    executeTrade(params: TradeParams): Promise<TradeResult>;

    /**
     * Close a trade (for CFDs)
     */
    closeTrade?(contractId: string): Promise<void>;

    /**
     * Get current mode
     */
    getMode(): TradeMode;
}

/**
 * Binary Options Trade Adapter
 */
export class BinaryOptionsAdapter implements ITradeAdapter {
    constructor(private gatewayClient: GatewayClient) { }

    getMode(): TradeMode {
        return 'binary';
    }

    async executeTrade(params: TradeParams): Promise<TradeResult> {
        if (!this.isBinaryParams(params)) {
            throw new Error('Invalid parameters for Binary Options adapter');
        }

        // Format amount to 2 decimal places (Deriv API requirement)
        const formattedAmount = Math.round(params.amount * 100) / 100;

        const result = await this.gatewayClient.trade({
            asset: params.asset,
            direction: params.direction,
            amount: formattedAmount,
            duration: params.duration,
            durationUnit: params.durationUnit,
            strategyName: params.strategyName,
        });

        // Calculate expiry time
        let durationSeconds = params.duration;
        if (params.durationUnit === 'm') durationSeconds *= 60;
        else if (params.durationUnit === 'h') durationSeconds *= 3600;
        else if (params.durationUnit === 'd') durationSeconds *= 86400;

        const expiryTime = (result.purchaseTime || Date.now() / 1000) + durationSeconds;

        return {
            contractId: result.contract_id || result.contractId || '',
            mode: 'binary',
            asset: params.asset,
            direction: params.direction,
            amount: params.amount,
            entryPrice: result.openPrice || result.buyPrice || 0,
            timestamp: result.purchaseTime || result.timestamp || Date.now() / 1000,
            expiryTime,
            payout: result.payout,
        };
    }

    private isBinaryParams(params: TradeParams): params is BinaryTradeParams {
        return 'duration' in params && 'durationUnit' in params;
    }
}

/**
 * CFD/Multiplier Trade Adapter
 */
export class CFDAdapter implements ITradeAdapter {
    constructor(private gatewayClient: GatewayClient) { }

    getMode(): TradeMode {
        return 'cfd';
    }

    async executeTrade(params: TradeParams): Promise<TradeResult> {
        if (!this.isCFDParams(params)) {
            throw new Error('Invalid parameters for CFD adapter');
        }

        // Convert BUY/SELL to MULTUP/MULTDOWN
        const contractType = params.direction === 'BUY' ? 'MULTUP' : 'MULTDOWN';

        // Format amount to 2 decimal places (Deriv API requirement)
        const formattedAmount = Math.round(params.amount * 100) / 100;

        // CFDs with multipliers don't require duration (can be closed manually)
        // Only include duration if explicitly provided
        const tradeParams: any = {
            asset: params.asset,
            direction: contractType,
            amount: formattedAmount,
            multiplier: params.multiplier,
            takeProfit: params.takeProfit,
            stopLoss: params.stopLoss,
            strategyName: params.strategyName,
            account: params.account, // Pass account (loginid) if specified
        };

        // Call Gateway's tradeCFD method
        const result = await this.gatewayClient.tradeCFD(tradeParams);

        if (!result) {
            throw new Error('CFD trade failed: No response from Gateway');
        }

        // Calculate expiry time if duration is provided
        let expiryTime: number | undefined = undefined;
        if (result.startTime && params.duration && params.durationUnit) {
            const durationSeconds = params.duration * (
                params.durationUnit === 'm' ? 60 :
                params.durationUnit === 'h' ? 3600 :
                params.durationUnit === 'd' ? 86400 : 1
            );
            expiryTime = result.startTime + durationSeconds;
        }

        return {
            contractId: result.contractId || result.contract_id || '',
            mode: 'cfd',
            asset: params.asset,
            direction: params.direction,
            amount: params.amount,
            entryPrice: result.buyPrice || result.openPrice || result.entryPrice || 0,
            timestamp: result.purchaseTime || result.timestamp || Date.now() / 1000,
            expiryTime,
            multiplier: params.multiplier,
            takeProfit: params.takeProfit,
            stopLoss: params.stopLoss,
        };
    }

    async closeTrade(contractId: string): Promise<void> {
        // Call Gateway's sellContract method
        await (this.gatewayClient as any).sellContract?.(contractId, 0);
    }

    private isCFDParams(params: TradeParams): params is CFDTradeParams {
        return 'multiplier' in params;
    }
}

/**
 * Unified Trade Adapter
 * 
 * Switches between Binary Options and CFDs based on mode
 */
export class UnifiedTradeAdapter implements ITradeAdapter {
    private binaryAdapter: BinaryOptionsAdapter;
    private cfdAdapter: CFDAdapter;
    private currentMode: TradeMode;

    constructor(
        gatewayClient: GatewayClient,
        mode: TradeMode = 'binary'
    ) {
        this.binaryAdapter = new BinaryOptionsAdapter(gatewayClient);
        this.cfdAdapter = new CFDAdapter(gatewayClient);
        this.currentMode = mode;
    }

    /**
     * Set the trading mode
     */
    setMode(mode: TradeMode): void {
        this.currentMode = mode;
    }

    getMode(): TradeMode {
        return this.currentMode;
    }

    /**
     * Execute a trade (automatically routes to correct adapter)
     */
    async executeTrade(params: TradeParams): Promise<TradeResult> {
        if (this.currentMode === 'binary') {
            return this.binaryAdapter.executeTrade(params);
        } else {
            return this.cfdAdapter.executeTrade(params);
        }
    }

    /**
     * Close a trade (for CFDs only)
     */
    async closeTrade(contractId: string): Promise<void> {
        if (this.currentMode === 'cfd') {
            return this.cfdAdapter.closeTrade!(contractId);
        } else {
            throw new Error('closeTrade is only available for CFD mode');
        }
    }

    /**
     * Convert BUY/SELL to CALL/PUT for binary options
     */
    convertDirection(direction: 'BUY' | 'SELL'): 'CALL' | 'PUT' {
        return direction === 'BUY' ? 'CALL' : 'PUT';
    }

    /**
     * Convert CALL/PUT to BUY/SELL for CFDs
     */
    convertDirectionReverse(direction: 'CALL' | 'PUT'): 'BUY' | 'SELL' {
        return direction === 'CALL' ? 'BUY' : 'SELL';
    }
}

