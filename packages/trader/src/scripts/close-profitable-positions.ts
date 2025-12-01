/**
 * Close all profitable positions
 *
 * Usage:
 *   npx tsx src/scripts/close-profitable-positions.ts          # Show only
 *   CLOSE=true npx tsx src/scripts/close-profitable-positions.ts  # Actually close
 */

import WebSocket from 'ws';

const APP_ID = process.env.DERIV_APP_ID || '106646';
const API_TOKEN = process.env.DERIV_API_TOKEN || process.env.DERIV_TOKEN;
const SHOULD_CLOSE = process.env.CLOSE === 'true';

if (!API_TOKEN) {
  console.error('DERIV_API_TOKEN env var required');
  process.exit(1);
}

interface Position {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
}

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

let positions: any[] = [];
let processedCount = 0;
let profitablePositions: Position[] = [];
let losingPositions: Position[] = [];

ws.on('open', () => {
  console.log('Connecting...');
  ws.send(JSON.stringify({ authorize: API_TOKEN }));
});

ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.msg_type === 'authorize') {
    console.log(`Balance: $${msg.authorize.balance.toFixed(2)}\n`);
    ws.send(JSON.stringify({ portfolio: 1 }));
  }

  if (msg.msg_type === 'portfolio') {
    positions = msg.portfolio?.contracts || [];
    console.log(`Found ${positions.length} open positions. Checking PnL...\n`);

    if (positions.length === 0) {
      console.log('No open positions');
      ws.close();
      process.exit(0);
    }

    // Check PnL for each position
    for (const pos of positions) {
      ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: pos.contract_id,
      }));
    }
  }

  if (msg.msg_type === 'proposal_open_contract') {
    processedCount++;
    const contract = msg.proposal_open_contract;

    if (contract) {
      const buyPrice = contract.buy_price || 0;
      const currentValue = contract.bid_price || 0;
      const pnl = currentValue - buyPrice;
      const pnlPct = buyPrice > 0 ? (pnl / buyPrice) * 100 : 0;

      const position: Position = {
        contractId: contract.contract_id?.toString() || '',
        symbol: contract.underlying || contract.display_name || 'Unknown',
        contractType: contract.contract_type || '',
        buyPrice,
        currentValue,
        pnl,
        pnlPct,
      };

      if (pnl > 0) {
        profitablePositions.push(position);
        console.log(`✅ ${position.symbol} ${position.contractType} | Buy: $${buyPrice.toFixed(2)} | Current: $${currentValue.toFixed(2)} | PnL: +$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      } else {
        losingPositions.push(position);
        console.log(`❌ ${position.symbol} ${position.contractType} | Buy: $${buyPrice.toFixed(2)} | Current: $${currentValue.toFixed(2)} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      }
    }

    // All positions processed
    if (processedCount >= positions.length) {
      printSummary();

      if (SHOULD_CLOSE && profitablePositions.length > 0) {
        await closePositions();
      } else if (profitablePositions.length > 0) {
        console.log('\n💡 To close profitable positions, run with CLOSE=true');
        ws.close();
        process.exit(0);
      } else {
        ws.close();
        process.exit(0);
      }
    }
  }

  if (msg.msg_type === 'sell') {
    if (msg.sell) {
      console.log(`   ✅ Closed contract ${msg.sell.contract_id} at $${msg.sell.sold_for?.toFixed(2)}`);
    } else if (msg.error) {
      console.log(`   ❌ Error closing: ${msg.error.message}`);
    }
  }

  if (msg.error && msg.msg_type !== 'sell') {
    console.log('Error:', msg.error.message);
  }
});

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Profitable positions: ${profitablePositions.length}`);
  console.log(`Losing positions: ${losingPositions.length}`);

  const totalProfit = profitablePositions.reduce((sum, p) => sum + p.pnl, 0);
  const totalLoss = losingPositions.reduce((sum, p) => sum + p.pnl, 0);

  console.log(`\nTotal unrealized profit: $${totalProfit.toFixed(2)}`);
  console.log(`Total unrealized loss: $${totalLoss.toFixed(2)}`);
  console.log(`Net unrealized PnL: $${(totalProfit + totalLoss).toFixed(2)}`);
  console.log('='.repeat(60));
}

async function closePositions() {
  console.log(`\n🔄 Closing ${profitablePositions.length} profitable positions...`);

  for (const pos of profitablePositions) {
    console.log(`\nClosing ${pos.symbol} ${pos.contractType} (${pos.contractId})...`);
    ws.send(JSON.stringify({
      sell: pos.contractId,
      price: 0, // Market price
    }));
    // Wait a bit between sells
    await new Promise(r => setTimeout(r, 500));
  }

  // Wait for all sell responses
  setTimeout(() => {
    console.log('\n✅ Done closing positions');
    ws.close();
    process.exit(0);
  }, profitablePositions.length * 1000 + 2000);
}

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout');
  ws.close();
  process.exit(1);
}, 120000);
