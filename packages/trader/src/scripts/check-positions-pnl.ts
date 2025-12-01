/**
 * Check PnL for all open positions and identify profitable ones
 */

import { GatewayClient } from '@deriv-bot/shared';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://37.27.47.129:3000';

async function checkPositionsPnL() {
  const client = new GatewayClient({ url: GATEWAY_URL });

  console.log(`Connecting to ${GATEWAY_URL}...`);
  await client.connect();
  console.log('Connected!\n');

  try {
    // Get portfolio
    const portfolio = await client.getPortfolio();
    const contracts = portfolio.contracts || [];

    console.log(`Found ${contracts.length} open positions\n`);

    if (contracts.length === 0) {
      console.log('No open positions found.');
      return;
    }

    const profitable: { contractId: string; symbol: string; pnl: number; entryPrice: number; currentPrice: number }[] = [];
    const losing: { contractId: string; symbol: string; pnl: number; entryPrice: number; currentPrice: number }[] = [];

    // Check each contract's PnL
    for (const contract of contracts) {
      const contractId = contract.contract_id?.toString() || '';
      const symbol = contract.underlying || contract.symbol || 'Unknown';
      const buyPrice = contract.buy_price || 0;

      try {
        // Get current contract status
        const details = await client.getContractStatus(contractId);
        const currentValue = details.bid_price || details.current_spot || 0;
        const pnl = currentValue - buyPrice;
        const pnlPct = buyPrice > 0 ? (pnl / buyPrice) * 100 : 0;

        const position = {
          contractId,
          symbol,
          pnl,
          entryPrice: buyPrice,
          currentPrice: currentValue,
        };

        if (pnl > 0) {
          profitable.push(position);
          console.log(`✅ ${symbol} #${contractId}: +$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        } else {
          losing.push(position);
          console.log(`❌ ${symbol} #${contractId}: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        }

        // Small delay to not overwhelm the API
        await new Promise(r => setTimeout(r, 100));

      } catch (error: any) {
        console.log(`⚠️  ${symbol} #${contractId}: Error getting details - ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Profitable positions: ${profitable.length}`);
    console.log(`Losing positions: ${losing.length}`);

    const totalProfitPnL = profitable.reduce((sum, p) => sum + p.pnl, 0);
    const totalLossPnL = losing.reduce((sum, p) => sum + p.pnl, 0);

    console.log(`Total profit from profitable: $${totalProfitPnL.toFixed(2)}`);
    console.log(`Total loss from losing: $${totalLossPnL.toFixed(2)}`);
    console.log(`Net PnL: $${(totalProfitPnL + totalLossPnL).toFixed(2)}`);

    // Ask if user wants to close profitable positions
    if (profitable.length > 0) {
      console.log('\n📊 Profitable positions to close:');
      for (const p of profitable) {
        console.log(`  - ${p.symbol} #${p.contractId}: +$${p.pnl.toFixed(2)}`);
      }

      // Check if AUTO_CLOSE env var is set
      if (process.env.AUTO_CLOSE === 'true') {
        console.log('\n🔄 AUTO_CLOSE=true - Closing profitable positions...');

        for (const p of profitable) {
          try {
            console.log(`Closing ${p.symbol} #${p.contractId}...`);
            await client.closeTrade(p.contractId);
            console.log(`✅ Closed ${p.contractId}`);
            await new Promise(r => setTimeout(r, 500));
          } catch (error: any) {
            console.log(`❌ Failed to close ${p.contractId}: ${error.message}`);
          }
        }
      } else {
        console.log('\nTo close profitable positions, run with AUTO_CLOSE=true');
      }
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await client.disconnect();
  }
}

checkPositionsPnL().catch(console.error);
