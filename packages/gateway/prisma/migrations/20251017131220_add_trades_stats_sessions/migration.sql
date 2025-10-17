-- CreateTable
CREATE TABLE "candles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset" TEXT NOT NULL,
    "timeframe" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ticks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "direction" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "symbols" (
    "symbol" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "submarket" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL,
    "pipSize" REAL NOT NULL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "timeframe" INTEGER NOT NULL,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    "stake" REAL NOT NULL,
    "payout" REAL,
    "result" TEXT,
    "profit" REAL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "expiryTime" DATETIME,
    "signalType" TEXT,
    "rsi" REAL,
    "bbUpper" REAL,
    "bbMiddle" REAL,
    "bbLower" REAL,
    "atr" REAL,
    "strategyName" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "winRate" REAL NOT NULL DEFAULT 0,
    "totalStake" REAL NOT NULL DEFAULT 0,
    "totalPayout" REAL NOT NULL DEFAULT 0,
    "netPnL" REAL NOT NULL DEFAULT 0,
    "startBalance" REAL,
    "endBalance" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "strategyName" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "pnl" REAL NOT NULL DEFAULT 0,
    "startBalance" REAL NOT NULL,
    "endBalance" REAL
);

-- CreateIndex
CREATE INDEX "candles_asset_timeframe_idx" ON "candles"("asset", "timeframe");

-- CreateIndex
CREATE INDEX "candles_timestamp_idx" ON "candles"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "candles_asset_timeframe_timestamp_key" ON "candles"("asset", "timeframe", "timestamp");

-- CreateIndex
CREATE INDEX "ticks_asset_timestamp_idx" ON "ticks"("asset", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "trades_contractId_key" ON "trades"("contractId");

-- CreateIndex
CREATE INDEX "trades_openedAt_idx" ON "trades"("openedAt");

-- CreateIndex
CREATE INDEX "trades_asset_idx" ON "trades"("asset");

-- CreateIndex
CREATE INDEX "trades_strategyName_idx" ON "trades"("strategyName");

-- CreateIndex
CREATE INDEX "trades_result_idx" ON "trades"("result");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_date_key" ON "daily_stats"("date");

-- CreateIndex
CREATE INDEX "daily_stats_date_idx" ON "daily_stats"("date");

-- CreateIndex
CREATE INDEX "sessions_startedAt_idx" ON "sessions"("startedAt");

-- CreateIndex
CREATE INDEX "sessions_strategyName_idx" ON "sessions"("strategyName");
