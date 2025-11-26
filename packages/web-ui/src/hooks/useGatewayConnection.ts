/**
 * Hook para conectarse al Gateway via WebSocket
 * Reutiliza toda la lógica que ya tenés en GatewayClient
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Tick, Candle } from '@deriv-bot/shared';

export interface GatewayMessage {
  type: string;
  data?: any;
  command?: string;
  params?: any;
  requestId?: string;
  timestamp?: number;
  success?: boolean;
  error?: any;
}

export interface UseGatewayConnectionOptions {
  url: string;
  onTick?: (tick: Tick) => void;
  onCandleUpdate?: (data: { asset: string; timeframe: number; candle: Candle }) => void;
  onCandleClosed?: (data: { asset: string; timeframe: number; candle: Candle }) => void;
  onIndicators?: (indicators: any) => void;
  onTradeExecuted?: (data: any) => void;
  onTradeResult?: (data: any) => void;
}

export function useGatewayConnection(options: UseGatewayConnectionOptions) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestsRef = useRef<Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
  }>>(new Map());

  // Conectar al Gateway
  useEffect(() => {
    console.log('[Gateway] Initiating connection...');
    const ws = new WebSocket(options.url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[Gateway] Connected successfully');
      setConnected(true);
      setError(null);
    };

    ws.onerror = (event) => {
      console.error('[Gateway] Error:', event);
      setError(new Error('WebSocket error'));
    };

    ws.onclose = () => {
      console.log('[Gateway] Disconnected');
      setConnected(false);
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      try {
        const message: GatewayMessage = JSON.parse(event.data);

        // Handle response to command
        if (message.type === 'response' && message.requestId) {
          const pending = pendingRequestsRef.current.get(message.requestId);
          if (pending) {
            pendingRequestsRef.current.delete(message.requestId);
            if (message.success) {
              pending.resolve(message.data);
            } else {
              pending.reject(new Error(message.error?.message || 'Command failed'));
            }
          }
          return;
        }

        // Handle events
        switch (message.type) {
          case 'tick':
            console.log('[Gateway] Tick received:', message.data);
            options.onTick?.(message.data);
            break;
          case 'candle_update':
            console.log('[Gateway] Candle update:', message.data);
            options.onCandleUpdate?.(message.data);
            break;
          case 'candle_closed':
            console.log('[Gateway] Candle closed:', message.data);
            options.onCandleClosed?.(message.data);
            break;
          case 'indicators':
            options.onIndicators?.(message.data);
            break;
          case 'trade:executed':
            options.onTradeExecuted?.(message.data);
            break;
          case 'trade:result':
            options.onTradeResult?.(message.data);
            break;
        }
      } catch (err) {
        console.error('[Gateway] Failed to parse message:', err);
      }
    };

    return () => {
      console.log('[Gateway] Cleanup - closing WebSocket');
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [options.url]);

  // Send command helper
  const sendCommand = useCallback(async (command: string, params?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      // Wait for connection to be ready (with timeout)
      const maxAttempts = 50; // 5 seconds max
      let attempts = 0;

      const checkConnection = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const requestId = (++requestIdRef.current).toString();

          pendingRequestsRef.current.set(requestId, { resolve, reject });

          wsRef.current.send(JSON.stringify({
            type: 'command',
            command,
            params,
            requestId,
            timestamp: Date.now(),
          }));

          // Timeout after 30 seconds
          setTimeout(() => {
            if (pendingRequestsRef.current.has(requestId)) {
              pendingRequestsRef.current.delete(requestId);
              reject(new Error(`Command timeout: ${command}`));
            }
          }, 30000);
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(checkConnection, 100);
        } else {
          reject(new Error('Connection timeout'));
        }
      };

      checkConnection();
    });
  }, []);

  // Follow assets
  const follow = useCallback(async (assets: string[]) => {
    await sendCommand('follow', { assets });
  }, [sendCommand]);

  // Get candles
  const getCandles = useCallback(async (asset: string, timeframe: number, count?: number, end?: number): Promise<Candle[]> => {
    const result = await sendCommand('get_candles', { asset, timeframe, count, end });
    return result.candles || [];
  }, [sendCommand]);

  // Get balance
  const getBalance = useCallback(async () => {
    return await sendCommand('balance');
  }, [sendCommand]);

  // Get stats
  const getStats = useCallback(async () => {
    return await sendCommand('get_stats');
  }, [sendCommand]);

  // Get trades
  const getTrades = useCallback(async (filters?: any) => {
    const result = await sendCommand('get_trades', filters);
    return result.trades || [];
  }, [sendCommand]);

  return {
    connected,
    error,
    follow,
    getCandles,
    getBalance,
    getStats,
    getTrades,
  };
}
