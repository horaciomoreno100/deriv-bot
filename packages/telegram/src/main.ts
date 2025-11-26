/**
 * Telegram Bot Main Entry Point
 *
 * Starts the Telegram bot service that connects to Gateway
 * and provides trading commands/notifications
 */

import { GatewayBridge } from './gateway-bridge.js';
import { TelegramBotService } from './telegram-bot.js';
import { getOpenObserveLogger, loadEnvFromRoot } from '@deriv-bot/shared';

// Load environment variables from project root
loadEnvFromRoot();

// Initialize OpenObserve Logger (with service name for per-service streams)
const ooLogger = getOpenObserveLogger({ service: 'telegram' });

// Load configuration from environment
const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS
      ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(Number)
      : [],
  },
  gateway: {
    url: process.env.GATEWAY_URL || 'ws://localhost:3000',
  },
};

// Validate required config
if (!config.telegram.token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!config.telegram.chatId) {
  console.error('Error: TELEGRAM_CHAT_ID is required');
  process.exit(1);
}

console.log('='.repeat(50));
console.log('Deriv Trading Bot - Telegram Service');
console.log('='.repeat(50));
console.log(`Gateway URL: ${config.gateway.url}`);
console.log(`Chat ID: ${config.telegram.chatId}`);
console.log(`Authorized Users: ${config.telegram.authorizedUsers.length || 'All'}`);
console.log('='.repeat(50));

// Create gateway bridge
const gateway = new GatewayBridge({
  url: config.gateway.url,
  reconnectInterval: 5000,
});

// Create telegram bot
const bot = new TelegramBotService(config.telegram, gateway);

// Handle shutdown gracefully
async function shutdown() {
  console.log('\nShutting down...');
  ooLogger.warn('telegram', 'Telegram bot shutting down');
  await ooLogger.close();
  await bot.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the bot
bot.start()
  .then(() => {
    ooLogger.info('telegram', 'Telegram bot started', {
      chatId: config.telegram.chatId,
      gatewayUrl: config.gateway.url
    });
  })
  .catch((error) => {
    ooLogger.error('telegram', 'Failed to start bot', { error: error.message });
    console.error('Failed to start bot:', error);
    process.exit(1);
  });
