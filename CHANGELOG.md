# Changelog

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
