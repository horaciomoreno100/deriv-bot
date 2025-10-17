import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import {
  parseMessage,
  serializeMessage,
  createResponseMessage,
  createErrorMessage,
  type GatewayMessage,
  type CommandMessage,
} from './protocol.js';

/**
 * Configuration for GatewayServer
 */
export interface GatewayServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host?: string;
  /** Enable debug logging */
  enableLogging?: boolean;
}

/**
 * GatewayServer - WebSocket server for Gateway <-> Trader communication
 *
 * Exposes API for Trader to:
 * - Subscribe to market data
 * - Execute trades
 * - Query balance and instruments
 *
 * @example
 * ```typescript
 * const server = new GatewayServer({ port: 3000 });
 *
 * server.on('command', ({ ws, command }) => {
 *   if (command.command === 'ping') {
 *     server.respondToCommand(ws, command.requestId, true, { pong: true });
 *   }
 * });
 *
 * await server.start();
 * ```
 *
 * @fires client:connected - When a client connects
 * @fires client:disconnected - When a client disconnects
 * @fires command - When a command is received
 */
export class GatewayServer extends EventEmitter {
  private config: Required<GatewayServerConfig>;
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, { id: string; connectedAt: number }>();
  private running = false;
  private clientIdCounter = 0;

  constructor(config: GatewayServerConfig) {
    super();

    this.config = {
      port: config.port,
      host: config.host || '0.0.0.0',
      enableLogging: config.enableLogging ?? true,
    };
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.running) {
      this.log('Server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.config.port,
        host: this.config.host,
      });

      this.wss.on('listening', () => {
        this.running = true;
        this.log(`Server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });

      this.wss.on('error', (error) => {
        this.log('Server error:', error);
        reject(error);
      });

      this.wss.on('connection', (ws) => {
        this.handleConnection(ws);
      });
    });
  }

  /**
   * Stop the WebSocket server
   */
  async close(): Promise<void> {
    if (!this.running || !this.wss) {
      return;
    }

    return new Promise((resolve) => {
      // Close all client connections
      this.clients.forEach((_, ws) => {
        ws.close();
      });

      this.wss!.close(() => {
        this.running = false;
        this.clients.clear();
        this.log('Server closed');
        resolve();
      });
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: GatewayMessage): void {
    const data = serializeMessage(message);

    this.clients.forEach((_, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  /**
   * Send message to specific client
   */
  sendToClient(ws: WebSocket, message: GatewayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeMessage(message));
    }
  }

  /**
   * Send response for a command
   */
  respondToCommand(
    ws: WebSocket,
    requestId: string | undefined,
    success: boolean,
    data?: any,
    error?: { code: string; message: string }
  ): void {
    const response = createResponseMessage(requestId, success, data, error);
    this.sendToClient(ws, response);
  }

  /**
   * Send error to client
   */
  sendError(ws: WebSocket, code: string, message: string): void {
    const error = createErrorMessage(code, message);
    this.sendToClient(ws, error);
  }

  /**
   * Handle new client connection
   */
  private handleConnection(ws: WebSocket): void {
    const clientId = `client-${++this.clientIdCounter}`;

    this.clients.set(ws, {
      id: clientId,
      connectedAt: Date.now(),
    });

    this.log(`Client connected: ${clientId}`);
    this.emit('client:connected', ws);

    ws.on('message', (data) => {
      this.handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      this.log(`Client disconnected: ${clientId}`);
      this.clients.delete(ws);
      this.emit('client:disconnected', ws);
    });

    ws.on('error', (error) => {
      this.log(`Client error (${clientId}):`, error);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(ws: WebSocket, data: string): void {
    try {
      const message = parseMessage(data);

      if (message.type === 'command') {
        this.handleCommand(ws, message as CommandMessage);
      } else {
        this.sendError(ws, 'INVALID_MESSAGE_TYPE', `Invalid message type: ${message.type}`);
      }
    } catch (error) {
      this.log('Failed to parse message:', error);
      this.sendError(ws, 'PARSE_ERROR', `Failed to parse message: ${error}`);
    }
  }

  /**
   * Handle command message
   */
  private handleCommand(ws: WebSocket, message: CommandMessage): void {
    this.log(`Command received: ${message.command}`);

    this.emit('command', {
      ws,
      command: message,
    });
  }

  /**
   * Log message (if logging enabled)
   */
  private log(...args: any[]): void {
    if (this.config.enableLogging) {
      console.log('[GatewayServer]', ...args);
    }
  }
}
