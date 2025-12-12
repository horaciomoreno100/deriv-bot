/**
 * cTrader Open API Client
 *
 * Connects to cTrader Open API via WebSocket and Protobuf
 * Provides access to:
 * - Real-time spot prices
 * - Depth of Market (DOM) / Level 2 data
 * - Historical tick data
 */

import WebSocket from 'ws';
import * as protobuf from 'protobufjs';
import * as path from 'path';

// Use process.cwd() + relative path since __dirname is not available in ESM
const PROTO_DIR = path.join(process.cwd(), 'packages', 'ctrader-client', 'src', 'proto');

// Message type IDs from the proto files
const PayloadType = {
  // Common
  PROTO_OA_ERROR_RES: 2142,
  HEARTBEAT_EVENT: 51,

  // Application auth
  PROTO_OA_APPLICATION_AUTH_REQ: 2100,
  PROTO_OA_APPLICATION_AUTH_RES: 2101,

  // Account auth
  PROTO_OA_ACCOUNT_AUTH_REQ: 2102,
  PROTO_OA_ACCOUNT_AUTH_RES: 2103,

  // Account list
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,

  // Symbols
  PROTO_OA_SYMBOLS_LIST_REQ: 2114,
  PROTO_OA_SYMBOLS_LIST_RES: 2115,
  PROTO_OA_SYMBOL_BY_ID_REQ: 2116,
  PROTO_OA_SYMBOL_BY_ID_RES: 2117,

  // Spot subscription
  PROTO_OA_SUBSCRIBE_SPOTS_REQ: 2124,
  PROTO_OA_SUBSCRIBE_SPOTS_RES: 2125,
  PROTO_OA_SPOT_EVENT: 2126,
  PROTO_OA_UNSUBSCRIBE_SPOTS_REQ: 2127,
  PROTO_OA_UNSUBSCRIBE_SPOTS_RES: 2128,

  // Depth of Market (DOM)
  PROTO_OA_SUBSCRIBE_DEPTH_QUOTES_REQ: 2153,
  PROTO_OA_SUBSCRIBE_DEPTH_QUOTES_RES: 2154,
  PROTO_OA_UNSUBSCRIBE_DEPTH_QUOTES_REQ: 2155,
  PROTO_OA_UNSUBSCRIBE_DEPTH_QUOTES_RES: 2156,
  PROTO_OA_DEPTH_EVENT: 2157,

  // Tick data
  PROTO_OA_GET_TICKDATA_REQ: 2145,
  PROTO_OA_GET_TICKDATA_RES: 2146,

  // Trendbars (candles)
  PROTO_OA_GET_TRENDBARS_REQ: 2137,
  PROTO_OA_GET_TRENDBARS_RES: 2138,
};

export interface CTraderConfig {
  /** Client ID from cTrader Open API */
  clientId: string;
  /** Client Secret from cTrader Open API */
  clientSecret: string;
  /** Access token obtained via OAuth */
  accessToken: string;
  /** Use demo or live environment */
  environment: 'demo' | 'live';
}

export interface DepthQuote {
  id: number;
  size: number; // Volume in units (divided by 100)
  price: number; // Actual price (divided by 100000)
}

export interface DepthEvent {
  symbolId: number;
  newQuotes: DepthQuote[];
  deletedQuoteIds: number[];
}

export interface SpotEvent {
  symbolId: number;
  bid: number;
  ask: number;
  timestamp?: number;
}

export interface TickData {
  timestamp: number;
  price: number;
}

export interface Symbol {
  symbolId: number;
  symbolName: string;
  description: string;
  digits: number;
  pipPosition: number;
}

/**
 * cTrader Open API Client
 */
export class CTraderClient {
  private config: CTraderConfig;
  private ws: WebSocket | null = null;
  private root: protobuf.Root | null = null;
  private connected = false;
  private authenticated = false;
  private accountId: number | null = null;

  private pendingRequests = new Map<
    string,
    { resolve: (data: any) => void; reject: (error: Error) => void }
  >();
  private clientMsgId = 0;

  // Event handlers
  private spotHandlers: ((event: SpotEvent) => void)[] = [];
  private depthHandlers: ((event: DepthEvent) => void)[] = [];

  constructor(config: CTraderConfig) {
    this.config = config;
  }

  /**
   * Load protobuf definitions
   */
  private async loadProto(): Promise<void> {
    if (this.root) return;

    const protoPath = PROTO_DIR;
    this.root = await protobuf.load([
      path.join(protoPath, 'OpenApiCommonMessages.proto'),
      path.join(protoPath, 'OpenApiMessages.proto'),
      path.join(protoPath, 'OpenApiModelMessages.proto'),
    ]);
  }

  /**
   * Get endpoint based on environment
   */
  private getEndpoint(): string {
    const host =
      this.config.environment === 'demo'
        ? 'demo.ctraderapi.com'
        : 'live.ctraderapi.com';
    return `wss://${host}:5035`;
  }

  /**
   * Connect to cTrader Open API
   */
  async connect(): Promise<void> {
    await this.loadProto();

    return new Promise((resolve, reject) => {
      const endpoint = this.getEndpoint();
      console.log(`[cTrader] Connecting to ${endpoint}...`);

      this.ws = new WebSocket(endpoint);

      this.ws.on('open', async () => {
        console.log('[cTrader] WebSocket connected');
        this.connected = true;

        try {
          // Authenticate application
          await this.authenticateApp();
          console.log('[cTrader] Application authenticated');

          // Get accounts
          const accounts = await this.getAccounts();
          console.log(`[cTrader] Found ${accounts.length} account(s)`);

          if (accounts.length > 0) {
            // Use first account
            this.accountId = accounts[0].ctidTraderAccountId;
            await this.authenticateAccount(this.accountId);
            console.log(`[cTrader] Account ${this.accountId} authenticated`);
          }

          this.authenticated = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        console.error('[cTrader] WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('[cTrader] WebSocket closed');
        this.connected = false;
        this.authenticated = false;
      });
    });
  }

  /**
   * Disconnect from cTrader
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  /**
   * Send a protobuf message
   */
  private async send(
    payloadType: number,
    payload: Record<string, any>,
    waitForResponse = true
  ): Promise<any> {
    if (!this.ws || !this.root) {
      throw new Error('Not connected');
    }

    const clientMsgId = `msg_${++this.clientMsgId}`;

    // Get message type name from payload type
    const messageTypeName = this.getMessageTypeName(payloadType);
    const MessageType = this.root.lookupType(messageTypeName);

    // Create inner message
    const innerMessage = MessageType.create({
      payloadType,
      ...payload,
    });
    const innerBuffer = MessageType.encode(innerMessage).finish();

    // Wrap in ProtoMessage
    const ProtoMessage = this.root.lookupType('ProtoMessage');
    const wrapper = ProtoMessage.create({
      payloadType,
      payload: innerBuffer,
      clientMsgId,
    });
    const buffer = ProtoMessage.encode(wrapper).finish();

    // Send with length prefix (4 bytes, big endian)
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(buffer.length, 0);
    const fullBuffer = Buffer.concat([lengthBuffer, Buffer.from(buffer)]);

    this.ws.send(fullBuffer);

    if (!waitForResponse) {
      return null;
    }

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(clientMsgId);
        reject(new Error(`Request timeout for ${messageTypeName}`));
      }, 30000);

      this.pendingRequests.set(clientMsgId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  /**
   * Get message type name from payload type
   */
  private getMessageTypeName(payloadType: number): string {
    const names: Record<number, string> = {
      [PayloadType.PROTO_OA_APPLICATION_AUTH_REQ]: 'ProtoOAApplicationAuthReq',
      [PayloadType.PROTO_OA_APPLICATION_AUTH_RES]: 'ProtoOAApplicationAuthRes',
      [PayloadType.PROTO_OA_ACCOUNT_AUTH_REQ]: 'ProtoOAAccountAuthReq',
      [PayloadType.PROTO_OA_ACCOUNT_AUTH_RES]: 'ProtoOAAccountAuthRes',
      [PayloadType.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ]:
        'ProtoOAGetAccountListByAccessTokenReq',
      [PayloadType.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES]:
        'ProtoOAGetAccountListByAccessTokenRes',
      [PayloadType.PROTO_OA_SYMBOLS_LIST_REQ]: 'ProtoOASymbolsListReq',
      [PayloadType.PROTO_OA_SYMBOLS_LIST_RES]: 'ProtoOASymbolsListRes',
      [PayloadType.PROTO_OA_SYMBOL_BY_ID_REQ]: 'ProtoOASymbolByIdReq',
      [PayloadType.PROTO_OA_SYMBOL_BY_ID_RES]: 'ProtoOASymbolByIdRes',
      [PayloadType.PROTO_OA_SUBSCRIBE_SPOTS_REQ]: 'ProtoOASubscribeSpotsReq',
      [PayloadType.PROTO_OA_SUBSCRIBE_SPOTS_RES]: 'ProtoOASubscribeSpotsRes',
      [PayloadType.PROTO_OA_SPOT_EVENT]: 'ProtoOASpotEvent',
      [PayloadType.PROTO_OA_SUBSCRIBE_DEPTH_QUOTES_REQ]:
        'ProtoOASubscribeDepthQuotesReq',
      [PayloadType.PROTO_OA_SUBSCRIBE_DEPTH_QUOTES_RES]:
        'ProtoOASubscribeDepthQuotesRes',
      [PayloadType.PROTO_OA_DEPTH_EVENT]: 'ProtoOADepthEvent',
      [PayloadType.PROTO_OA_GET_TICKDATA_REQ]: 'ProtoOAGetTickDataReq',
      [PayloadType.PROTO_OA_GET_TICKDATA_RES]: 'ProtoOAGetTickDataRes',
      [PayloadType.PROTO_OA_ERROR_RES]: 'ProtoOAErrorRes',
    };
    return names[payloadType] || 'ProtoMessage';
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: Buffer): void {
    if (!this.root) return;

    try {
      // Skip first 4 bytes (length prefix)
      const messageBuffer = data.slice(4);

      // Decode wrapper
      const ProtoMessage = this.root.lookupType('ProtoMessage');
      const wrapper = ProtoMessage.decode(messageBuffer) as any;

      const payloadType = wrapper.payloadType;
      const clientMsgId = wrapper.clientMsgId;

      // Decode inner payload
      const messageTypeName = this.getMessageTypeName(payloadType);
      let decoded: any = null;

      if (wrapper.payload && messageTypeName !== 'ProtoMessage') {
        try {
          const MessageType = this.root.lookupType(messageTypeName);
          decoded = MessageType.decode(wrapper.payload);
        } catch {
          // If specific type not found, just use wrapper
          decoded = wrapper;
        }
      } else {
        decoded = wrapper;
      }

      // Handle specific events
      if (payloadType === PayloadType.PROTO_OA_SPOT_EVENT) {
        this.handleSpotEvent(decoded);
        return;
      }

      if (payloadType === PayloadType.PROTO_OA_DEPTH_EVENT) {
        this.handleDepthEvent(decoded);
        return;
      }

      if (payloadType === PayloadType.HEARTBEAT_EVENT) {
        // Respond to heartbeat
        return;
      }

      if (payloadType === PayloadType.PROTO_OA_ERROR_RES) {
        console.error('[cTrader] Error:', decoded.errorCode, decoded.description);
        if (clientMsgId && this.pendingRequests.has(clientMsgId)) {
          const pending = this.pendingRequests.get(clientMsgId)!;
          this.pendingRequests.delete(clientMsgId);
          pending.reject(
            new Error(`cTrader error: ${decoded.errorCode} - ${decoded.description}`)
          );
        }
        return;
      }

      // Resolve pending request
      if (clientMsgId && this.pendingRequests.has(clientMsgId)) {
        const pending = this.pendingRequests.get(clientMsgId)!;
        this.pendingRequests.delete(clientMsgId);
        pending.resolve(decoded);
      }
    } catch (error) {
      console.error('[cTrader] Error handling message:', error);
    }
  }

  /**
   * Handle spot price event
   */
  private handleSpotEvent(event: any): void {
    const spotEvent: SpotEvent = {
      symbolId: Number(event.symbolId),
      bid: event.bid ? Number(event.bid) / 100000 : 0,
      ask: event.ask ? Number(event.ask) / 100000 : 0,
      timestamp: event.timestamp ? Number(event.timestamp) : undefined,
    };

    for (const handler of this.spotHandlers) {
      handler(spotEvent);
    }
  }

  /**
   * Handle depth of market event
   */
  private handleDepthEvent(event: any): void {
    const depthEvent: DepthEvent = {
      symbolId: Number(event.symbolId),
      newQuotes: (event.newQuotes || []).map((q: any) => ({
        id: Number(q.id),
        size: Number(q.size) / 100, // Convert to units
        price: Number(q.price) / 100000, // Convert to actual price
      })),
      deletedQuoteIds: (event.deletedQuotes || []).map(Number),
    };

    for (const handler of this.depthHandlers) {
      handler(depthEvent);
    }
  }

  /**
   * Authenticate application
   */
  private async authenticateApp(): Promise<void> {
    await this.send(PayloadType.PROTO_OA_APPLICATION_AUTH_REQ, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });
  }

  /**
   * Get accounts for access token
   */
  private async getAccounts(): Promise<
    Array<{ ctidTraderAccountId: number; isLive: boolean }>
  > {
    const response = await this.send(
      PayloadType.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      {
        accessToken: this.config.accessToken,
      }
    );

    return (response.ctidTraderAccount || []).map((acc: any) => ({
      ctidTraderAccountId: Number(acc.ctidTraderAccountId),
      isLive: acc.isLive === true,
    }));
  }

  /**
   * Authenticate trading account
   */
  private async authenticateAccount(accountId: number): Promise<void> {
    await this.send(PayloadType.PROTO_OA_ACCOUNT_AUTH_REQ, {
      ctidTraderAccountId: accountId,
      accessToken: this.config.accessToken,
    });
  }

  /**
   * Get available symbols
   */
  async getSymbols(): Promise<Symbol[]> {
    if (!this.accountId) throw new Error('Not authenticated');

    const response = await this.send(PayloadType.PROTO_OA_SYMBOLS_LIST_REQ, {
      ctidTraderAccountId: this.accountId,
    });

    return (response.symbol || []).map((s: any) => ({
      symbolId: Number(s.symbolId),
      symbolName: s.symbolName || '',
      description: s.description || '',
      digits: Number(s.digits) || 5,
      pipPosition: Number(s.pipPosition) || 4,
    }));
  }

  /**
   * Subscribe to spot prices
   */
  async subscribeSpots(
    symbolIds: number[],
    callback: (event: SpotEvent) => void
  ): Promise<void> {
    if (!this.accountId) throw new Error('Not authenticated');

    this.spotHandlers.push(callback);

    await this.send(PayloadType.PROTO_OA_SUBSCRIBE_SPOTS_REQ, {
      ctidTraderAccountId: this.accountId,
      symbolId: symbolIds,
      subscribeToSpotTimestamp: true,
    });
  }

  /**
   * Subscribe to Depth of Market (DOM)
   */
  async subscribeDepth(
    symbolIds: number[],
    callback: (event: DepthEvent) => void
  ): Promise<void> {
    if (!this.accountId) throw new Error('Not authenticated');

    this.depthHandlers.push(callback);

    await this.send(PayloadType.PROTO_OA_SUBSCRIBE_DEPTH_QUOTES_REQ, {
      ctidTraderAccountId: this.accountId,
      symbolId: symbolIds,
    });
  }

  /**
   * Get historical tick data
   * Note: Limited to 1 week of data
   */
  async getTickData(
    symbolId: number,
    type: 'bid' | 'ask',
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<TickData[]> {
    if (!this.accountId) throw new Error('Not authenticated');

    // Max 1 week
    const maxRange = 7 * 24 * 60 * 60 * 1000;
    if (toTimestamp - fromTimestamp > maxRange) {
      throw new Error('Tick data range cannot exceed 1 week');
    }

    const response = await this.send(PayloadType.PROTO_OA_GET_TICKDATA_REQ, {
      ctidTraderAccountId: this.accountId,
      symbolId,
      type: type === 'bid' ? 1 : 2,
      fromTimestamp,
      toTimestamp,
    });

    // Tick data comes in relative format
    const ticks: TickData[] = [];
    let lastTimestamp = fromTimestamp;
    let lastPrice = 0;

    for (const tick of response.tickData || []) {
      lastTimestamp += Number(tick.timestamp || 0);
      lastPrice += Number(tick.tick || 0);

      ticks.push({
        timestamp: lastTimestamp,
        price: lastPrice / 100000, // Convert to actual price
      });
    }

    return ticks;
  }

  /**
   * Check if connected and authenticated
   */
  isReady(): boolean {
    return this.connected && this.authenticated;
  }

  /**
   * Get current account ID
   */
  getAccountId(): number | null {
    return this.accountId;
  }
}

export default CTraderClient;
