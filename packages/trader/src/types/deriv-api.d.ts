/**
 * Type declarations for @deriv/deriv-api
 *
 * Minimal types for the Deriv API client
 */

declare module '@deriv/deriv-api' {
  export interface DerivAPIOptions {
    endpoint?: string;
    app_id?: number;
    lang?: string;
    brand?: string;
  }

  export interface SubscriptionHandler {
    subscribe(callback: (response: any) => void): void;
    unsubscribe(): void;
  }

  export default class DerivAPI {
    constructor(options?: DerivAPIOptions);

    basic: {
      ping(): Promise<any>;
      authorize(token: string): Promise<any>;
      balance(): Promise<any>;
      buy(options: any): Promise<any>;
      proposal(options: any): Promise<any>;
      proposalOpenContract(options: any): Promise<any>;
      time(): Promise<any>;
      ticks(symbol: string): Promise<any>;
      ticksHistory(options: any): Promise<any>;
      [key: string]: (...args: any[]) => Promise<any>;
    };

    send(request: any): Promise<any>;
    subscribe(request: any): SubscriptionHandler;
    disconnect(): void;

    onOpen(callback: () => void): void;
    onClose(callback: () => void): void;
    onError(callback: (error: any) => void): void;
  }
}
