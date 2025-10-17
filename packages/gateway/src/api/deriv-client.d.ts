import type { Tick, Symbol, Balance, Candle } from '@deriv-bot/shared';
/**
 * Configuration for DerivClient
 */
export interface DerivClientConfig {
    /** App ID from Deriv */
    appId: number;
    /** WebSocket endpoint */
    endpoint?: string;
    /** API token for authenticated requests */
    apiToken?: string;
    /** Keep-alive interval in ms */
    keepAliveInterval?: number;
}
/**
 * Subscription object
 */
export interface Subscription {
    /** Unique subscription ID */
    id: string;
    /** Callback function */
    callback: (data: any) => void;
}
/**
 * DerivClient - WebSocket client for Deriv API
 *
 * Handles connection, subscriptions, and message routing.
 *
 * @example
 * ```typescript
 * const client = new DerivClient({
 *   appId: 1089,
 *   endpoint: 'wss://ws.derivws.com/websockets/v3'
 * });
 *
 * await client.connect();
 *
 * const symbols = await client.getActiveSymbols();
 * console.log(symbols);
 * ```
 */
export declare class DerivClient {
    private config;
    private ws;
    private connected;
    private keepAliveTimer;
    private subscriptions;
    private pendingRequests;
    private requestId;
    constructor(config: DerivClientConfig);
    /**
     * Check if client is connected
     */
    isConnected(): boolean;
    /**
     * Connect to Deriv WebSocket API
     *
     * @throws {Error} If connection fails
     */
    connect(): Promise<void>;
    /**
     * Disconnect from Deriv API
     */
    disconnect(): void;
    /**
     * Send ping to keep connection alive
     */
    ping(): Promise<void>;
    /**
     * Get list of active trading symbols
     *
     * @returns Array of active symbols
     */
    getActiveSymbols(): Promise<Symbol[]>;
    /**
     * Subscribe to tick stream for an asset
     *
     * @param symbol - Asset symbol (e.g., "R_100")
     * @param callback - Callback function for tick updates
     * @returns Subscription object
     */
    subscribeTicks(symbol: string, callback: (tick: Tick) => void): Promise<Subscription>;
    /**
     * Unsubscribe from a subscription
     *
     * @param subscriptionId - Subscription ID to cancel
     */
    unsubscribe(subscriptionId: string): Promise<void>;
    /**
     * Get account balance
     *
     * @returns Balance information
     * @throws {Error} If not authorized or request fails
     */
    getBalance(): Promise<Balance>;
    /**
     * Get historical candles
     *
     * @param symbol - Asset symbol
     * @param options - Candle options
     * @returns Array of candles
     * @throws {Error} If request fails
     */
    getCandles(symbol: string, options: {
        granularity: number;
        count: number;
        end?: number;
        start?: number;
    }): Promise<Candle[]>;
    /**
     * Buy a contract (place trade)
     *
     * @param options - Trade options
     * @returns Contract purchase response
     * @throws {Error} If purchase fails
     */
    buyContract(options: {
        symbol: string;
        contractType: 'CALL' | 'PUT';
        amount: number;
        duration: number;
        durationUnit: 's' | 'm' | 'h' | 'd';
        basis?: 'stake' | 'payout';
    }): Promise<{
        contractId: string;
        buyPrice: number;
        payout: number;
        startTime: number;
        purchaseTime: number;
        longcode: string;
    }>;
    /**
     * Get price proposal for a contract (without buying)
     *
     * @param options - Proposal options
     * @returns Price proposal
     * @throws {Error} If request fails
     */
    getProposal(options: {
        symbol: string;
        contractType: 'CALL' | 'PUT';
        amount: number;
        duration: number;
        durationUnit: 's' | 'm' | 'h' | 'd';
        basis?: 'stake' | 'payout';
    }): Promise<{
        askPrice: number;
        payout: number;
        spotPrice: number;
    }>;
    /**
     * Subscribe to contract updates
     *
     * @param contractId - Contract ID to track
     * @param callback - Callback for contract updates
     * @returns Subscription object
     */
    subscribeToContract(contractId: string, callback: (update: any) => void): Promise<Subscription>;
    /**
     * Send a request and wait for response
     *
     * @param payload - Request payload
     * @returns Response data
     */
    private request;
    /**
     * Send data to WebSocket
     */
    private send;
    /**
     * Handle incoming WebSocket message
     */
    private handleMessage;
    /**
     * Handle error message
     */
    private handleError;
    /**
     * Handle subscription update
     */
    private handleSubscription;
    /**
     * Handle regular response
     */
    private handleResponse;
    /**
     * Start keep-alive timer
     */
    private startKeepAlive;
    /**
     * Stop keep-alive timer
     */
    private stopKeepAlive;
}
//# sourceMappingURL=deriv-client.d.ts.map