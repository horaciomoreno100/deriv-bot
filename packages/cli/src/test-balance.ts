import { GatewayClient } from '@deriv-bot/trader';

async function test() {
  const client = new GatewayClient({
    url: 'ws://localhost:3000',
    enableLogging: false
  });

  await client.connect();
  const balance = await client.getBalance();
  console.log('BALANCE RESULT:', JSON.stringify(balance, null, 2));
  await client.disconnect();
}

test().catch(console.error);
