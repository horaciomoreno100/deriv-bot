/**
 * PM2 Ecosystem Config - Pullback Window Strategy
 *
 * AGGRESSIVE MODE: B+C
 * - Multiplier 100x (Gold + Silver)
 * - Both assets (frxXAUUSD + frxXAGUSD)
 * - Risk 2% per trade
 *
 * Expected Performance:
 * - Gold DD: ~4.6% (2.3% x 2)
 * - Silver DD: ~27% (13.5% x 2)
 * - Combined: Higher returns, manageable risk
 */

module.exports = {
  apps: [
    {
      name: 'trader-pullback-window',
      script: 'src/scripts/run-pullback-window.ts',
      cwd: '/opt/apps/deriv-bot/packages/trader',
      interpreter: 'npx',
      interpreter_args: 'tsx',

      env: {
        NODE_ENV: 'production',

        // Strategy Config
        TRADE_MODE: 'cfd',
        SYMBOL: 'frxXAUUSD,frxXAGUSD',  // Gold + Silver
        PRESET: 'paper_m5',              // Academic paper baseline

        // Risk Management - AGGRESSIVE
        STRATEGY_ALLOCATION: '1000',
        INITIAL_CAPITAL: '10000',
        RISK_PERCENTAGE: '0.02',         // 2% per trade
        // Multiplier 100x set in code

        // Deriv API (set these in .env or here)
        // DERIV_APP_ID: 'your_app_id',
        // DERIV_API_TOKEN: 'your_token',
        // ACCOUNT_LOGINID: 'your_cfd_account',

        // Gateway
        GATEWAY_WS_URL: 'ws://localhost:3000',

        // Telegram (optional)
        // TELEGRAM_BOT_TOKEN: 'your_bot_token',
        // TELEGRAM_CHAT_ID: 'your_chat_id',
      },

      // PM2 Options
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',

      // Logging
      error_file: '/opt/apps/deriv-bot/logs/pullback-window-error.log',
      out_file: '/opt/apps/deriv-bot/logs/pullback-window-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Restart on crash
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],
};
