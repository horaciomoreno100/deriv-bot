import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';
import { GatewayServer } from './gateway-server.js';
import { createCommandMessage, parseMessage } from './protocol.js';

describe('GatewayServer', () => {
  let server: GatewayServer;
  const TEST_PORT = 13000;

  beforeEach(async () => {
    server = new GatewayServer({
      port: TEST_PORT,
      enableLogging: false,
    });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Server Lifecycle', () => {
    it('should start server on specified port', async () => {
      await server.start();

      expect(server.isRunning()).toBe(true);
      expect(server.getPort()).toBe(TEST_PORT);
    });

    it('should stop server gracefully', async () => {
      await server.start();
      await server.close();

      expect(server.isRunning()).toBe(false);
    });

    it('should handle multiple start calls', async () => {
      await server.start();
      await server.start(); // Second call should be no-op

      expect(server.isRunning()).toBe(true);
    });
  });

  describe('Client Connections', () => {
    it('should accept client connections', async () => {
      await server.start();

      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

      await new Promise<void>((resolve) => {
        client.on('open', () => {
          expect(client.readyState).toBe(WebSocket.OPEN);
          client.close();
          resolve();
        });
      });
    });

    it('should track connected clients', async () => {
      await server.start();

      expect(server.getClientCount()).toBe(0);

      const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client1.on('open', () => resolve());
      });

      expect(server.getClientCount()).toBe(1);

      const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client2.on('open', () => resolve());
      });

      expect(server.getClientCount()).toBe(2);

      client1.close();
      client2.close();
    });

    it('should emit event when client connects', async () => {
      await server.start();

      const connectSpy = vi.fn();
      server.on('client:connected', connectSpy);

      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client.on('open', () => resolve());
      });

      // Wait a bit for event to fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(connectSpy).toHaveBeenCalled();

      client.close();
    });

    it('should emit event when client disconnects', async () => {
      await server.start();

      const disconnectSpy = vi.fn();
      server.on('client:disconnected', disconnectSpy);

      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client.on('open', () => resolve());
      });

      client.close();

      // Wait a bit for event to fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  describe('Message Handling', () => {
    it('should receive and parse command messages', async () => {
      await server.start();

      const commandSpy = vi.fn();
      server.on('command', commandSpy);

      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client.on('open', () => resolve());
      });

      const command = createCommandMessage({
        command: 'ping',
      });

      client.send(JSON.stringify(command));

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(commandSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({
            command: 'ping',
          }),
        })
      );

      client.close();
    });

    it('should handle invalid JSON messages', async () => {
      await server.start();

      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client.on('open', () => resolve());
      });

      const errorPromise = new Promise<any>((resolve) => {
        client.on('message', (data) => {
          const message = parseMessage(data.toString());
          if (message.type === 'error') {
            resolve(message);
          }
        });
      });

      client.send('invalid json {{{');

      const error = await errorPromise;
      expect(error.type).toBe('error');
      expect(error.code).toBeDefined();

      client.close();
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast message to all connected clients', async () => {
      await server.start();

      const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

      await Promise.all([
        new Promise<void>((resolve) => client1.on('open', () => resolve())),
        new Promise<void>((resolve) => client2.on('open', () => resolve())),
      ]);

      const messages1: any[] = [];
      const messages2: any[] = [];

      client1.on('message', (data) => {
        messages1.push(JSON.parse(data.toString()));
      });

      client2.on('message', (data) => {
        messages2.push(JSON.parse(data.toString()));
      });

      server.broadcast({
        type: 'tick',
        data: {
          asset: 'R_100',
          price: 1234.56,
          timestamp: Date.now(),
        },
      });

      // Wait for broadcast
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages1).toHaveLength(1);
      expect(messages2).toHaveLength(1);
      expect(messages1[0].type).toBe('tick');
      expect(messages2[0].type).toBe('tick');

      client1.close();
      client2.close();
    });

    it('should send message to specific client via command handler', async () => {
      await server.start();

      // Set up command handler that responds only to the sender
      server.on('command', ({ ws, command }) => {
        if (command.command === 'balance') {
          server.sendToClient(ws, {
            type: 'balance',
            data: {
              amount: 10000,
              currency: 'USD',
              accountType: 'demo',
              timestamp: Date.now(),
            },
          });
        }
      });

      const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

      await Promise.all([
        new Promise<void>((resolve) => client1.on('open', () => resolve())),
        new Promise<void>((resolve) => client2.on('open', () => resolve())),
      ]);

      const messages1: any[] = [];
      const messages2: any[] = [];

      client1.on('message', (data) => {
        messages1.push(JSON.parse(data.toString()));
      });

      client2.on('message', (data) => {
        messages2.push(JSON.parse(data.toString()));
      });

      // Client1 sends command
      const command = createCommandMessage({
        command: 'balance',
      });

      client1.send(JSON.stringify(command));

      // Wait for message
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Only client1 should receive response
      expect(messages1.length).toBeGreaterThan(0);
      expect(messages1[0].type).toBe('balance');
      expect(messages2).toHaveLength(0);

      client1.close();
      client2.close();
    });
  });

  describe('Command Responses', () => {
    it('should send response for command with requestId', async () => {
      await server.start();

      const commandSpy = vi.fn();
      server.on('command', ({ ws, command }) => {
        // Simulate command processing
        server.respondToCommand(ws, command.requestId, true, { result: 'ok' });
      });

      const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise<void>((resolve) => {
        client.on('open', () => resolve());
      });

      const responsePromise = new Promise<any>((resolve) => {
        client.on('message', (data) => {
          const message = parseMessage(data.toString());
          if (message.type === 'response') {
            resolve(message);
          }
        });
      });

      const command = createCommandMessage(
        {
          command: 'instruments',
        },
        'test-request-123'
      );

      client.send(JSON.stringify(command));

      const response = await responsePromise;
      expect(response.type).toBe('response');
      expect(response.requestId).toBe('test-request-123');
      expect(response.success).toBe(true);

      client.close();
    });
  });
});
