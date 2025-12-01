# Changelog

## [0.15.0](///compare/v0.14.0...v0.15.0) (2025-12-01)

### Features

* add Telegram trade alerts to TradeExecutionService 7d7a660
* add Trade and DailyStats models to Prisma schema d39e2f6

### Bug Fixes

* add tick logging to debug candle reception 44391a6
* add tradeManager.start() to all trading scripts for position recovery 84410a7
* always recreate backtester in proximity calculation to ensure updated indicators f73e612
* correct TP/SL percentage conversion in CryptoScalp v2 b0c2bb0
* dynamically import Prisma to fix ESM compatibility f12d1ed
* handle forex market closed gracefully in FVG-LS trader a50eb1d
* improve proximity logging in CryptoScalp v2 1cc065f
* improve purchaseTime parsing with validation fallback 373f3a0
* recreate entryFn on every candle to prevent index mismatch in CryptoScalp v2 a765729
* resolve critical trading bugs in CryptoScalp and Hybrid-MTF strategies 8f9f211
* support signal.price in TradeExecutionService for CFD trades 4fc4587
* sync root Prisma schema Trade model with gateway schema 8ac1bc3
* use CommonJS import for Prisma client in all ESM files 82c7d87
* use CommonJS import for Prisma client in ESM context edeb8d2
* use correct SlackAlerter methods (info/warning instead of sendAlert) e4c84da
* use createRequire for Prisma in ESM context ea6d491
* use direct TelegramAlerter instance instead of singleton b95eca2
* use executeTrade instead of executeSignal in CryptoScalp v2 e270fd0
* use loadEnvFromRoot for proper env loading in trading scripts b22f223
* use require for Prisma client to fix ESM compatibility c71fd2f

## [0.14.0](///compare/v0.13.1...v0.14.0) (2025-11-30)

### Features

* add signal proximity publishing for CryptoScalp v2 c7517b8
* deploy CryptoScalp v2 optimized strategy cb43be5
* load historical candles for instant warm-up in CryptoScalp v2 d2ca3e4

### Bug Fixes

* add signal proximity publishing for CryptoScalp v2 9959209
* correct indentation and remove extra closing brace 1857867
* handle missing PM2 processes gracefully in deploy script 7e2eb32
* improve WebSocket error handling in GatewayClient 512405a
* reduce crypto warm-up requirement to 30 candles f7d4e2d
* replace continue with return in callback function 5245e62
* update test expectations to match current parameter values aa7656b

## [0.13.1](///compare/v0.13.0...v0.13.1) (2025-11-29)

### Bug Fixes

* add canOpenTrade check before executing trades 5f55a22

## [0.13.0](///compare/v0.12.0...v0.13.0) (2025-11-29)

### Features

* add run-fvg-ls.ts script for live trading e0bd18c

## [0.12.0](///compare/v0.11.2...v0.12.0) (2025-11-29)

### Features

* add FVG Liquidity Sweep strategy with hour filter optimization 1133e8d

## [0.11.2](///compare/v0.11.0...v0.11.2) (2025-11-29)

### Bug Fixes

* remove non-existent fvg-liquidity-sweep exports 554c6ae

## [0.11.1](///compare/v0.11.0...v0.11.1) (2025-11-29)

### Bug Fixes

* remove non-existent fvg-liquidity-sweep exports 554c6ae

## [0.11.0](///compare/v0.10.0...v0.11.0) (2025-11-29)

### Features

* show strategy name in trade notifications 5542bbf

### Bug Fixes

* remove unreleased fvg-liquidity-sweep exports 361cd47

## [0.10.0](///compare/v0.7.1...v0.10.0) (2025-11-29)

### Features

* add stats by strategy to /stats command f118243

## [0.9.0](///compare/v0.7.1...v0.9.0) (2025-11-29)

### Features

* add stats by strategy to /stats command f118243

## [0.8.1](///compare/v0.8.0...v0.8.1) (2025-11-29)

### Bug Fixes

* handle "already subscribed" error gracefully d1d9f46

## [0.8.0](///compare/v0.7.0...v0.8.0) (2025-11-29)

### Features

* add multi-strategy signal proximity tracking 187ab2a

## [0.7.0](///compare/v0.6.0...v0.7.0) (2025-11-29)

### Features

* add FVG strategy and consolidate Hybrid-MTF deployment b14310d

## [0.6.0](///compare/v0.5.3...v0.6.0) (2025-11-29)

### Features

* add market closed detection with auto-retry 4de162a
* replace BB-Squeeze-MR with Hybrid-MTF for R_75 and R_100 bffb79f

## [0.5.3](///compare/v0.5.0...v0.5.3) (2025-11-29)

### Bug Fixes

* improve system resilience for common trading errors 4d193dd
* increase minimum stop_loss to 5.00 USD and fix balance undefined error 377e1bd
* resolve TypeScript errors in FVG strategy 28d1bc8

### Performance Improvements

* optimize BB-Squeeze-MR backtest and update production config e08f6c1

## [](///compare/v0.5.0...vnull) (2025-11-29)

### Bug Fixes

* improve system resilience for common trading errors 4d193dd
* increase minimum stop_loss to 5.00 USD and fix balance undefined error 377e1bd
* resolve TypeScript errors in FVG strategy 28d1bc8

### Performance Improvements

* optimize BB-Squeeze-MR backtest and update production config e08f6c1

## [0.5.1](///compare/v0.5.0...v0.5.1) (2025-11-29)

### Bug Fixes

* improve system resilience for common trading errors 4d193dd
* increase minimum stop_loss to 5.00 USD and fix balance undefined error 377e1bd
* resolve TypeScript errors in FVG strategy 28d1bc8

### Performance Improvements

* optimize BB-Squeeze-MR backtest and update production config e08f6c1

## [0.5.0](///compare/v0.4.0...v0.5.0) (2025-11-28)

### Features

* add dynamic cooldown and optimized config v2.1.0 71c9816
* add KELTNER_MR strategy for EUR/USD trading with session filter d74664d
* add script to clean PM2 error logs 97aa1d0
* add server monitoring system with 15-minute reports cc10013
* add signal proximity support for Keltner-MR and Hybrid-MTF strategies 55210ec
* Hybrid-MTF v2.0.0 - fixed logic and improved params feaecb4
* load 5m and 15m candles directly from API instead of resampling 9f0b109
* show live P/L for Multiplier positions in /status 4672f90
* show specific trader/strategy name in Telegram logs 6e406eb

### Bug Fixes

* add debug logging to HybridMTF getSignalReadiness to diagnose null returns e4358a6
* add entry price to signal metadata for CFD trades 38f53f3
* add historical candles loading for Hybrid-MTF to enable signal proximity 32120fa
* add logging for signal proximity in Hybrid-MTF to debug missing R_100 f53fb6c
* add logging to debug why R_100 signal proximity is not being published 51106df
* add re-registration logic on reconnect for Keltner-MR and Hybrid-MTF 26e71c6
* add strategy config name to HybridMTFStrategy 9b97d58
* apply same connection error handling to all traders c9709f2
* check Gateway connection before signal proximity check 9bcd627
* clean old log files without -mr suffix 7744011
* completely silence connection errors in signal proximity 2de98ee
* correct EUR/USD multiplier and improve connection error detection 0d6173f
* correct gatewayClient.follow and balance references bf47fd9
* correct method name and remove unused variables in KeltnerMRStrategy f3e17fa
* correct serviceMap type to support multiple trader processes 9fb8012
* correct slack-alerts import in run-hybrid-mtf 3b83f16
* correct timestamp conversion in resampleCandles (seconds to milliseconds) e70c406
* filter ANSI color codes and PM2 service prefixes from logs 2c2814f
* filter PM2 headers from logs in Telegram bot d088213
* **gateway:** improve portfolio cache resilience for Deriv API timeouts 70403cb
* get live P/L for Multiplier positions using proposal_open_contract 73a765d
* handle proposal_open_contract response without subscription field b004b73
* improve clean-logs script to truncate log files directly f00aea5
* improve connection error detection using actual connection state 74012ea
* improve connection error detection with explicit checks 837b4f8
* improve connection error filtering and fix TypeScript errors 2c0faf4
* improve connection error filtering for signal proximity 9a8426f
* improve error handling and log filtering 083eb40
* increase active trader threshold to 5 minutes for better reliability 04b56e6
* increase historical candles to 800 for Hybrid-MTF to enable 15m regime detection 760cdc9
* make connected traders count match the displayed unique traders count 92c5a17
* make multiple API calls to load enough historical candles for Hybrid-MTF 15m regime detection 8b75ad4
* move historical candles loading before signal proximity interval setup 99bb59a
* only show errors in monitoring report if they actually exist eae195d
* prevent clearing candle buffers after loading historical candles in Hybrid-MTF cdc5b6f
* prevent duplicate traders in /info command and cleanup inactive traders 26c6d47
* prioritize direct error message check for connection errors 0285f93
* reduce log spam for missing SLACK_WEBHOOK_URL 764e91e
* remove duplicate properties in exitSnapshot 2b366e5
* remove duplicate variable declarations in run-bb-squeeze-mr a5ebf96
* remove last balance reference in summary 5710144
* remove undefined balance variable and use SYMBOLS instead of hardcoded MONITORED_SYMBOLS 64c8ea5
* remove unused kcMiddle variable f214c83
* return partial signal readiness for Hybrid-MTF when regime cannot be detected yet 249b4f4
* support both 'price' and 'entryPrice' in signal metadata 954ce90
* **telegram:** truncate logs to fit Telegram 4096 char limit 5b97a37
* **trader:** re-register with gateway on reconnect 5184a2f
* update run-hybrid-mtf.ts with v2.0.0 params and banner fd453e0
* use exitBbMiddle and exitBbLower variables d8fd5f1
* use numeric timeframe (60) instead of string ('1m') in getCandles call de6a32d

## [0.4.0](///compare/v0.3.0...v0.4.0) (2025-11-27)

### Features

* add OpenObserve logging to all trader services 516b56d
* add Slack alerts for crash detection and trade notifications e1e974f
* add Telegram alerts for connection events aef28af
* improve OpenObserve observability with per-service stream support f8d090a
* integrate OpenObserve logging in Gateway, Trader, and Telegram c7a5416
* **telegram:** add /signals command to view signal proximities c3ed8db
* **telegram:** add server monitoring commands ad8ed72
* **trader:** Add HybridMTFStrategy with multi-timeframe analysis e646ab9

### Bug Fixes

* add diagnostic logging for OpenObserve logger f500189
* add dotenv dependency to shared package and fix unused variable 8a1eacf
* auto-resubscribe to assets on gateway reconnection c7bcc3f
* ensure all services load .env from project root 5adbd5f
* ensure telegram logger initializes after env vars are loaded b0ed298
* **gateway:** add force re-subscription for stale tick streams 8450ca9
* **telegram:** fix proximity bar calculation (was 0-100, not 0-1) a4ff32e
* **telegram:** fix trade notification showing stake as entry price 9616e38
* update run-bb-squeeze-mr to use loadEnvFromRoot 3fc695d

## [0.3.0](///compare/v0.2.1...v0.3.0) (2025-11-26)

### Features

* add PM2.io monitoring documentation e6ae1f2
* improve OpenObserve observability with per-service stream support
  * Add support for separate streams per service (gateway, telegram, trader)
  * Add `OPENOBSERVE_STREAM_PER_SERVICE` environment variable
  * Ensure all logs include `service` field for filtering
  * Add `closeAllLoggers()` function for graceful shutdown
  * Update all services to pass service name to logger initialization

## [0.2.1](///compare/v0.2.0...v0.2.1) (2025-11-26)

## 0.2.0 (2025-11-26)

### Features

* add /info command with bot status, strategies and uptime c4b9299
* add base binary sizer 7bb1459
* add fixed sizer 7a90d0a
* add martingale/anti-martingale sizers cfba555
* add sizers module init 2cae56e
* add Telegram bot service for trade notifications e2c367f
* Add Winston logger with Telegram alerts + REPL + State Manager 61c9a26
* Clean architecture with Gateway + Trader + Mean Reversion strategy 6c2fb76
* major update with BB-Squeeze strategy, backtest filters, and cloud deployment prep 662a350

### Bug Fixes

* add explicit types to state-manager reduce callbacks 9a5539e
* exclude development scripts from production build 6451ead
* update build script to only build core packages 28938a9
