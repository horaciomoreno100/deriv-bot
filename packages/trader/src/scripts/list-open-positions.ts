/**
 * List all open positions from Deriv API
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
  console.log('Connecting...');
  ws.send(JSON.stringify({ authorize: API_TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.msg_type === 'authorize') {
    console.log(`Balance: $${msg.authorize.balance.toFixed(2)}\n`);
    ws.send(JSON.stringify({ portfolio: 1 }));
  }

  if (msg.msg_type === 'portfolio') {
    const contracts = msg.portfolio?.contracts || [];
    console.log(`=== OPEN POSITIONS: ${contracts.length} ===\n`);

    if (contracts.length === 0) {
      console.log('No open positions');
      ws.close();
      process.exit(0);
    }

    contracts.forEach((c: any, i: number) => {
      console.log(`${i + 1}. ${c.symbol || c.underlying} ${c.contract_type}`);
      console.log(`   Buy Price: $${c.buy_price?.toFixed(2)}`);
      console.log(`   Contract ID: ${c.contract_id}`);
      console.log('');
    });

    ws.close();
    process.exit(0);
  }

  if (msg.error) {
    console.error('Error:', msg.error.message);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout');
  ws.close();
  process.exit(1);
}, 15000);
