#!/usr/bin/env npx tsx
/**
 * Watchdog Service for Deriv Bot
 *
 * Continuously monitors the bot health and takes corrective actions:
 * - Monitors gateway connection
 * - Checks Deriv API authentication
 * - Monitors error rates in logs
 * - Auto-restarts services if needed
 * - Sends alerts via Slack/Telegram
 *
 * Usage:
 *   npx tsx src/scripts/watchdog.ts
 *
 * Environment:
 *   WATCHDOG_INTERVAL=60000       # Check every 60 seconds (default)
 *   WATCHDOG_MAX_ERRORS=5         # Max errors before restart (default)
 *   WATCHDOG_AUTO_RESTART=true    # Auto restart on failure (default: false)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { GatewayClient, initSlackAlerts, type SlackAlerter } from '@deriv-bot/shared';

const execAsync = promisify(exec);

// Configuration
const CHECK_INTERVAL = parseInt(process.env.WATCHDOG_INTERVAL || '60000', 10);
const MAX_ERRORS_BEFORE_RESTART = parseInt(process.env.WATCHDOG_MAX_ERRORS || '5', 10);
const AUTO_RESTART = process.env.WATCHDOG_AUTO_RESTART === 'true';
const GATEWAY_URL = process.env.GATEWAY_WS_URL || 'ws://localhost:3000';

// State
let consecutiveErrors = 0;
let lastSuccessfulCheck = Date.now();
let slackAlerter: SlackAlerter | null = null;

interface ServiceStatus {
  name: string;
  status: 'online' | 'stopped' | 'erroring' | 'unknown';
  uptime?: string;
  restarts?: number;
  memory?: string;
}

async function getPM2Status(): Promise<ServiceStatus[]> {
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);

    return processes.map((proc: {
      name: string;
      pm2_env: {
        status: string;
        pm_uptime: number;
        restart_time: number;
      };
      monit: { memory: number };
    }) => ({
      name: proc.name,
      status: proc.pm2_env.status as 'online' | 'stopped',
      uptime: formatUptime(Date.now() - proc.pm2_env.pm_uptime),
      restarts: proc.pm2_env.restart_time,
      memory: `${Math.round(proc.monit.memory / 1024 / 1024)}MB`,
    }));
  } catch {
    return [];
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

async function checkGatewayConnection(): Promise<{ connected: boolean; error?: string }> {
  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: false,
    enableLogging: false,
  });

  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000)),
    ]);
    client.disconnect();
    return { connected: true };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : 'Unknown' };
  }
}

async function checkDerivAuth(): Promise<{ authenticated: boolean; balance?: number; error?: string }> {
  const client = new GatewayClient({
    url: GATEWAY_URL,
    autoReconnect: false,
    enableLogging: false,
  });

  try {
    await client.connect();
    const response = await Promise.race([
      client.getBalance(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
    ]) as { amount?: number; currency?: string; error?: string };

    client.disconnect();

    if (response.error) {
      return { authenticated: false, error: response.error };
    }

    return { authenticated: true, balance: response.amount };
  } catch (error) {
    return { authenticated: false, error: error instanceof Error ? error.message : 'Unknown' };
  }
}

async function restartService(serviceName: string): Promise<boolean> {
  try {
    await execAsync(`pm2 restart ${serviceName}`);
    console.log(`✅ Restarted ${serviceName}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to restart ${serviceName}:`, error);
    return false;
  }
}

async function sendAlert(level: 'info' | 'warning' | 'error', message: string, data?: Record<string, unknown>) {
  console.log(`[${level.toUpperCase()}] ${message}`);

  if (slackAlerter) {
    await slackAlerter.sendAlert({ level, message, data });
  }
}

async function runHealthCheck() {
  const timestamp = new Date().toISOString();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔍 Watchdog Check - ${timestamp}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const issues: string[] = [];

  // Check PM2 services
  const services = await getPM2Status();
  console.log('\n📦 Services:');

  for (const service of services) {
    const icon = service.status === 'online' ? '✅' : '❌';
    console.log(`   ${icon} ${service.name}: ${service.status} (${service.uptime}, ${service.memory}, ${service.restarts} restarts)`);

    if (service.status !== 'online') {
      issues.push(`Service ${service.name} is ${service.status}`);
    }
  }

  // Check gateway connection
  console.log('\n🔌 Gateway:');
  const gatewayStatus = await checkGatewayConnection();
  if (gatewayStatus.connected) {
    console.log('   ✅ Connected');
  } else {
    console.log(`   ❌ FAILED: ${gatewayStatus.error}`);
    issues.push(`Gateway connection failed: ${gatewayStatus.error}`);
  }

  // Check Deriv authentication
  console.log('\n🏦 Deriv API:');
  const derivStatus = await checkDerivAuth();
  if (derivStatus.authenticated) {
    console.log(`   ✅ Authenticated (Balance: $${derivStatus.balance?.toFixed(2)})`);
    lastSuccessfulCheck = Date.now();
  } else {
    console.log(`   ❌ NOT AUTHENTICATED: ${derivStatus.error}`);
    issues.push(`Deriv auth failed: ${derivStatus.error}`);
  }

  // Handle issues
  if (issues.length > 0) {
    consecutiveErrors++;
    console.log(`\n⚠️  Found ${issues.length} issue(s) (consecutive errors: ${consecutiveErrors}/${MAX_ERRORS_BEFORE_RESTART}):`);
    issues.forEach((issue) => console.log(`   - ${issue}`));

    // Send alert
    await sendAlert('warning', `Watchdog detected ${issues.length} issue(s)`, {
      issues,
      consecutiveErrors,
      lastSuccess: formatUptime(Date.now() - lastSuccessfulCheck) + ' ago',
    });

    // Auto restart if enabled and threshold reached
    if (AUTO_RESTART && consecutiveErrors >= MAX_ERRORS_BEFORE_RESTART) {
      console.log('\n🔄 Triggering auto-restart...');
      await sendAlert('error', 'Auto-restarting services due to persistent errors', { consecutiveErrors });

      // Restart gateway first, then all traders
      await restartService('gateway');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await execAsync('pm2 restart all');

      consecutiveErrors = 0;
    }
  } else {
    consecutiveErrors = 0;
    console.log('\n✅ All systems healthy');
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     DERIV BOT WATCHDOG SERVICE                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Configuration:`);
  console.log(`   Check Interval: ${CHECK_INTERVAL / 1000}s`);
  console.log(`   Max Errors: ${MAX_ERRORS_BEFORE_RESTART}`);
  console.log(`   Auto Restart: ${AUTO_RESTART}`);
  console.log(`   Gateway URL: ${GATEWAY_URL}`);
  console.log();

  // Initialize Slack alerts
  slackAlerter = await initSlackAlerts('watchdog');
  if (slackAlerter) {
    console.log('✅ Slack alerts enabled');
    await slackAlerter.sendAlert({
      level: 'info',
      message: 'Watchdog service started',
      data: { interval: CHECK_INTERVAL, autoRestart: AUTO_RESTART },
    });
  }

  // Run initial check
  await runHealthCheck();

  // Schedule periodic checks
  setInterval(runHealthCheck, CHECK_INTERVAL);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Watchdog shutting down...');
    if (slackAlerter) {
      await slackAlerter.sendAlert({ level: 'info', message: 'Watchdog service stopped' });
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Watchdog error:', error);
  process.exit(1);
});
