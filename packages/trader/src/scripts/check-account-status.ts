/**
 * Check account status: balance, open positions, recent trades
 */

import WebSocket from 'ws';

const APP_ID = process.env.DERIV_APP_ID || '106646';
const API_TOKEN = process.env.DERIV_API_TOKEN || process.env.DERIV_TOKEN;

if (!API_TOKEN) {
  console.error('DERIV_API_TOKEN env var required');
  process.exit(1);
}

const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

ws.on('open', () => {
  console.log('Connecting to Deriv API...');
  ws.send(JSON.stringify({ authorize: API_TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.msg_type === 'authorize') {
    console.log('\n=== ACCOUNT INFO ===');
    console.log(`Account: ${msg.authorize.loginid}`);
    console.log(`Balance: $${msg.authorize.balance.toFixed(2)}`);
    console.log(`Currency: ${msg.authorize.currency}`);

    // Get portfolio (open positions)
    ws.send(JSON.stringify({ portfolio: 1 }));

    // Get profit table (recent trades)
    ws.send(JSON.stringify({
      profit_table: 1,
      description: 1,
      limit: 30,
      sort: 'DESC',
    }));
  }

  if (msg.msg_type === 'portfolio') {
    const contracts = msg.portfolio?.contracts || [];
    console.log('\n=== OPEN POSITIONS ===');
    console.log(`Total: ${contracts.length}`);

    if (contracts.length > 0) {
      contracts.slice(0, 15).forEach((c: any) => {
        console.log(`  - ${c.underlying || c.symbol} ${c.contract_type} Entry: ${c.buy_price}`);
      });
      if (contracts.length > 15) {
        console.log(`  ... and ${contracts.length - 15} more`);
      }
    }
  }

  if (msg.msg_type === 'profit_table') {
    const trades = msg.profit_table?.transactions || [];
    console.log('\n=== RECENT TRADES ===');
    console.log(`Total: ${trades.length}`);

    let totalProfit = 0;
    let wins = 0;
    let losses = 0;

    trades.forEach((t: any) => {
      const profit = t.sell_price - t.buy_price;
      totalProfit += profit;
      if (profit >= 0) wins++;
      else losses++;

      const status = profit >= 0 ? '✅' : '❌';
      const pnlStr = profit >= 0 ? `+${profit.toFixed(2)}` : profit.toFixed(2);
      console.log(`  ${status} ${t.shortcode || t.transaction_id} | Buy: $${t.buy_price.toFixed(2)} | Sell: $${t.sell_price?.toFixed(2) || 'N/A'} | P/L: ${pnlStr}`);
    });

    console.log('\n=== SUMMARY ===');
    console.log(`Wins: ${wins} | Losses: ${losses} | Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
    console.log(`Total P/L: $${totalProfit.toFixed(2)}`);

    ws.close();
    process.exit(0);
  }

  if (msg.error) {
    console.log('Error:', msg.error.message);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
  process.exit(1);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('Timeout waiting for response');
  ws.close();
  process.exit(1);
}, 30000);
