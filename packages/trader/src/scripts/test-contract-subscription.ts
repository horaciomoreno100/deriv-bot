/**
 * Test Script: Contract Subscription for Real-Time Closure Detection
 *
 * This isolated test validates that we can:
 * 1. Open a trade
 * 2. Subscribe to contract updates via proposal_open_contract
 * 3. Receive real-time profit updates
 * 4. Detect when the trade closes (is_sold: true) with final profit
 *
 * Run: TRADE_MODE=cfd pnpm tsx src/scripts/test-contract-subscription.ts
 */

import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const DERIV_API_TOKEN = process.env.DERIV_API_TOKEN;
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// Test configuration - Tighter TP/SL for faster closure
const TEST_ASSET = 'R_100';
const TEST_STAKE = 1; // $1 stake
const TEST_MULTIPLIER = 100;
const TEST_TP_PCT = 0.002; // 0.2% TP ($0.20 profit)
const TEST_SL_PCT = 0.001; // 0.1% SL ($0.10 loss)

interface ContractUpdate {
  contract_id: string;
  status: string;
  is_sold: number;
  profit: number;
  profit_percentage: number;
  current_spot: number;
  entry_spot: number;
  buy_price: number;
  sell_price?: number;
  sell_time?: number;
}

class ContractSubscriptionTest {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void }>();
  private contractSubscription: string | null = null;
  private contractId: string | null = null;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`\n🔌 Connecting to Deriv API...`);
      console.log(`   URL: ${DERIV_WS_URL}`);

      this.ws = new WebSocket(DERIV_WS_URL);

      this.ws.on('open', () => {
        console.log(`✅ Connected to Deriv API\n`);
        resolve();
      });

      this.ws.on('error', (err) => {
        console.error(`❌ WebSocket error:`, err);
        reject(err);
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        console.log(`\n🔌 WebSocket closed`);
      });
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle errors
      if (message.error) {
        console.error(`❌ API Error:`, message.error.message);
        const reqId = message.req_id;
        if (reqId && this.pendingRequests.has(reqId)) {
          const pending = this.pendingRequests.get(reqId)!;
          pending.reject(new Error(message.error.message));
          this.pendingRequests.delete(reqId);
        }
        return;
      }

      // Handle proposal_open_contract updates (subscription)
      if (message.msg_type === 'proposal_open_contract' && message.proposal_open_contract) {
        this.handleContractUpdate(message.proposal_open_contract);

        // Also resolve pending request if this is the initial subscription response
        if (message.req_id && this.pendingRequests.has(message.req_id)) {
          const pending = this.pendingRequests.get(message.req_id)!;
          pending.resolve(message);
          this.pendingRequests.delete(message.req_id);
        }
        return;
      }

      // Handle regular responses
      if (message.req_id && this.pendingRequests.has(message.req_id)) {
        const pending = this.pendingRequests.get(message.req_id)!;
        pending.resolve(message);
        this.pendingRequests.delete(message.req_id);
      }
    } catch (err) {
      console.error(`Failed to parse message:`, err);
    }
  }

  private handleContractUpdate(contract: any): void {
    const isSold = contract.is_sold === 1;
    const profit = contract.profit || 0;
    const profitPct = contract.profit_percentage || 0;
    const status = contract.status;

    const profitSign = profit >= 0 ? '+' : '';
    const emoji = isSold ? (profit >= 0 ? '✅' : '❌') : '📊';

    console.log(`\n${emoji} CONTRACT UPDATE:`);
    console.log(`   Contract ID: ${contract.contract_id}`);
    console.log(`   Status: ${status}`);
    console.log(`   Is Sold: ${isSold ? 'YES' : 'NO'}`);
    console.log(`   Entry: ${contract.entry_spot}`);
    console.log(`   Current: ${contract.current_spot}`);
    console.log(`   Profit: ${profitSign}$${profit.toFixed(2)} (${profitSign}${profitPct.toFixed(2)}%)`);

    if (isSold) {
      console.log(`   Sell Price: ${contract.sell_price}`);
      console.log(`   Sell Time: ${new Date((contract.sell_time || 0) * 1000).toISOString()}`);
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🎯 TRADE CLOSED - FINAL PROFIT: ${profitSign}$${profit.toFixed(2)}`);
      console.log(`${'='.repeat(60)}`);

      // This is what we need! The profit is available when is_sold = true
      console.log(`\n✅ SUCCESS: Real-time closure detection works!`);
      console.log(`   We can use this profit value to update statistics.\n`);

      // Exit after closure detected
      setTimeout(() => process.exit(0), 2000);
    }
  }

  private async request(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = ++this.requestId;
      const requestPayload = { ...payload, req_id: reqId };

      this.pendingRequests.set(reqId, { resolve, reject });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(requestPayload));
      } else {
        reject(new Error('WebSocket not open'));
      }

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async authorize(): Promise<void> {
    if (!DERIV_API_TOKEN) {
      throw new Error('DERIV_API_TOKEN not set in environment');
    }

    console.log(`🔑 Authorizing...`);
    const response = await this.request({
      authorize: DERIV_API_TOKEN,
    });

    console.log(`✅ Authorized as: ${response.authorize.email}`);
    console.log(`   Account: ${response.authorize.loginid}`);
    console.log(`   Balance: $${response.authorize.balance}\n`);
  }

  async getCurrentPrice(): Promise<number> {
    console.log(`📊 Getting current price for ${TEST_ASSET}...`);
    const response = await this.request({
      ticks: TEST_ASSET,
    });

    const price = response.tick?.quote;
    console.log(`   Current price: ${price}\n`);
    return price;
  }

  async openTrade(currentPrice: number): Promise<string> {
    // Calculate TP/SL as dollar amounts (not price levels)
    const direction = 'MULTUP'; // Always buy for test
    const positionSize = TEST_STAKE * TEST_MULTIPLIER;
    const tpDollar = Math.round(positionSize * TEST_TP_PCT * 100) / 100; // $0.40 for 0.4%
    const slDollar = Math.round(positionSize * TEST_SL_PCT * 100) / 100; // $0.20 for 0.2%

    console.log(`📈 Opening ${direction} trade...`);
    console.log(`   Asset: ${TEST_ASSET}`);
    console.log(`   Stake: $${TEST_STAKE}`);
    console.log(`   Multiplier: ${TEST_MULTIPLIER}x`);
    console.log(`   Position Size: $${positionSize}`);
    console.log(`   Take Profit: $${tpDollar} profit (+${(TEST_TP_PCT * 100).toFixed(1)}%)`);
    console.log(`   Stop Loss: $${slDollar} loss (-${(TEST_SL_PCT * 100).toFixed(1)}%)`);

    // Step 1: Get proposal first
    console.log(`\n   Step 1: Getting proposal...`);
    const proposalResponse = await this.request({
      proposal: 1,
      contract_type: direction,
      symbol: TEST_ASSET,
      basis: 'stake',
      amount: TEST_STAKE,
      multiplier: TEST_MULTIPLIER,
      currency: 'USD',
      limit_order: {
        take_profit: tpDollar,
        stop_loss: slDollar,
      },
    });

    if (proposalResponse.error) {
      throw new Error(proposalResponse.error.message);
    }

    const proposalId = proposalResponse.proposal.id;
    const askPrice = proposalResponse.proposal.ask_price;
    console.log(`   Proposal ID: ${proposalId}`);
    console.log(`   Ask Price: $${askPrice}`);

    // Step 2: Buy using proposal ID
    console.log(`   Step 2: Buying contract...`);
    const buyResponse = await this.request({
      buy: proposalId,
      price: askPrice,
    });

    if (buyResponse.error) {
      throw new Error(buyResponse.error.message);
    }

    const contractId = buyResponse.buy.contract_id.toString();
    const buyPrice = buyResponse.buy.buy_price;

    console.log(`\n✅ Trade opened!`);
    console.log(`   Contract ID: ${contractId}`);
    console.log(`   Buy Price: $${buyPrice}`);

    this.contractId = contractId;
    return contractId;
  }

  async subscribeToContract(contractId: string): Promise<void> {
    console.log(`\n📡 Subscribing to contract updates...`);
    console.log(`   Contract ID: ${contractId}`);

    const response = await this.request({
      proposal_open_contract: 1,
      contract_id: parseInt(contractId),
      subscribe: 1,
    });

    if (response.subscription) {
      this.contractSubscription = response.subscription.id;
      console.log(`✅ Subscribed! Subscription ID: ${this.contractSubscription}`);
    }

    console.log(`\n⏳ Waiting for contract updates...`);
    console.log(`   (Trade will close automatically when TP or SL is hit)\n`);
  }

  async run(): Promise<void> {
    try {
      console.log(`${'='.repeat(60)}`);
      console.log(`🧪 CONTRACT SUBSCRIPTION TEST`);
      console.log(`${'='.repeat(60)}`);
      console.log(`\nThis test validates real-time contract closure detection.`);
      console.log(`We'll open a small trade and watch for the is_sold event.\n`);

      await this.connect();
      await this.authorize();

      const currentPrice = await this.getCurrentPrice();
      const contractId = await this.openTrade(currentPrice);
      await this.subscribeToContract(contractId);

      // Keep alive - the handleContractUpdate will exit when trade closes
      console.log(`\n🔄 Monitoring contract... Press Ctrl+C to cancel.\n`);

    } catch (error: any) {
      console.error(`\n❌ Test failed:`, error.message);
      process.exit(1);
    }
  }
}

// Run test
const test = new ContractSubscriptionTest();
test.run();
