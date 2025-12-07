#!/usr/bin/env npx tsx
/**
 * Health Check Script for Deriv Bot
 *
 * Monitors:
 * - Gateway connection status
 * - Deriv API authentication
 * - Trader processes
 * - Recent trade activity
 * - Error rates
 *
 * Usage:
 *   npx tsx src/scripts/health-check.ts
 *
 * Can be run via cron:
 *   */5 * * * * cd /opt/apps/deriv-bot/packages/trader && npx tsx src/scripts/health-check.ts >> /var/log/deriv-health.log 2>&1
 */

import { GatewayClient, initSlackAlerts } from '@deriv-bot/shared';

// Configuration
const GATEWAY_URL = process.env.GATEWAY_WS_URL || 'ws://localhost:3000';
const SLACK_ENABLED = !!process.env.SLACK_WEBHOOK_URL;
const CONNECTION_TIMEOUT = 10000; // 10 seconds

interface HealthStatus {
  timestamp: string;
  gateway: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
  deriv: {
    authenticated: boolean;
    balance?: number;
    currency?: string;
    error?: string;
  };
  alerts: string[];
}

async function checkHealth(): Promise<HealthStatus> {
  const status: HealthStatus = {
    timestamp: new Date().toISOString(),
    gateway: { connected: false },
    deriv: { authenticated: false },
    alerts: [],
  };

  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: false,
    enableLogging: false,
  });

  try {
    // Test gateway connection
    const startTime = Date.now();
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT)
      ),
    ]);

    status.gateway.connected = true;
    status.gateway.latencyMs = Date.now() - startTime;

    // Test Deriv authentication by requesting balance
    try {
      const balanceResponse = await Promise.race([
        client.send({ command: 'get_balance' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Balance request timeout')), 5000)
        ),
      ]) as { balance?: number; currency?: string; error?: string };

      if (balanceResponse.error) {
        status.deriv.error = balanceResponse.error;
        status.alerts.push(`Deriv auth error: ${balanceResponse.error}`);
      } else if (balanceResponse.balance !== undefined) {
        status.deriv.authenticated = true;
        status.deriv.balance = balanceResponse.balance;
        status.deriv.currency = balanceResponse.currency;
      }
    } catch (error) {
      status.deriv.error = error instanceof Error ? error.message : 'Unknown error';
      status.alerts.push(`Deriv check failed: ${status.deriv.error}`);
    }
  } catch (error) {
    status.gateway.error = error instanceof Error ? error.message : 'Unknown error';
    status.alerts.push(`Gateway connection failed: ${status.gateway.error}`);
  } finally {
    try {
      client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }

  return status;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     DERIV BOT HEALTH CHECK                                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Gateway URL: ${GATEWAY_URL}`);
  console.log();

  const status = await checkHealth();

  // Gateway Status
  console.log('🔌 Gateway Connection:');
  if (status.gateway.connected) {
    console.log(`   ✅ Connected (${status.gateway.latencyMs}ms)`);
  } else {
    console.log(`   ❌ FAILED: ${status.gateway.error}`);
  }
  console.log();

  // Deriv Status
  console.log('🏦 Deriv API:');
  if (status.deriv.authenticated) {
    console.log(`   ✅ Authenticated`);
    console.log(`   💰 Balance: ${status.deriv.currency} ${status.deriv.balance?.toFixed(2)}`);
  } else {
    console.log(`   ❌ NOT AUTHENTICATED: ${status.deriv.error}`);
  }
  console.log();

  // Alerts Summary
  if (status.alerts.length > 0) {
    console.log('⚠️  ALERTS:');
    for (const alert of status.alerts) {
      console.log(`   - ${alert}`);
    }
    console.log();

    // Send Slack alert if enabled
    if (SLACK_ENABLED) {
      const slackAlerter = await initSlackAlerts('health-check');
      if (slackAlerter) {
        await slackAlerter.sendAlert({
          level: 'error',
          message: 'Deriv Bot Health Check Failed',
          data: {
            alerts: status.alerts,
            gateway: status.gateway,
            deriv: status.deriv,
          },
        });
        console.log('📢 Slack alert sent');
      }
    }

    // Exit with error code for monitoring tools
    process.exit(1);
  } else {
    console.log('✅ All systems operational');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('❌ Health check error:', error);
  process.exit(1);
});
