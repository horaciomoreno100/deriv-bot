/*
  Warnings:

  - Added the required column `tradeMode` to the `trades` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_trades" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tradeMode" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "timeframe" INTEGER,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    "stake" REAL NOT NULL,
    "payout" REAL,
    "multiplier" INTEGER,
    "takeProfit" REAL,
    "stopLoss" REAL,
    "takeProfitAmount" REAL,
    "stopLossAmount" REAL,
    "result" TEXT,
    "profit" REAL,
    "profitPct" REAL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "expiryTime" DATETIME,
    "signalType" TEXT,
    "confidence" REAL,
    "rsi" REAL,
    "bbUpper" REAL,
    "bbMiddle" REAL,
    "bbLower" REAL,
    "atr" REAL,
    "bbDistancePct" REAL,
    "priceVsMiddle" REAL,
    "volumeAtEntry" INTEGER,
    "spreadAtEntry" REAL,
    "balanceBefore" REAL,
    "balanceAfter" REAL,
    "strategyName" TEXT NOT NULL,
    "metadata" TEXT
);
INSERT INTO "new_trades" ("asset", "atr", "bbLower", "bbMiddle", "bbUpper", "closedAt", "contractId", "entryPrice", "exitPrice", "expiryTime", "id", "openedAt", "payout", "profit", "result", "rsi", "signalType", "stake", "strategyName", "timeframe", "type") SELECT "asset", "atr", "bbLower", "bbMiddle", "bbUpper", "closedAt", "contractId", "entryPrice", "exitPrice", "expiryTime", "id", "openedAt", "payout", "profit", "result", "rsi", "signalType", "stake", "strategyName", "timeframe", "type" FROM "trades";
DROP TABLE "trades";
ALTER TABLE "new_trades" RENAME TO "trades";
CREATE UNIQUE INDEX "trades_contractId_key" ON "trades"("contractId");
CREATE INDEX "trades_openedAt_idx" ON "trades"("openedAt");
CREATE INDEX "trades_asset_idx" ON "trades"("asset");
CREATE INDEX "trades_strategyName_idx" ON "trades"("strategyName");
CREATE INDEX "trades_result_idx" ON "trades"("result");
CREATE INDEX "trades_tradeMode_idx" ON "trades"("tradeMode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
