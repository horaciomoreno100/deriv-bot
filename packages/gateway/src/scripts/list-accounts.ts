#!/usr/bin/env node
/**
 * Script to list all available Deriv accounts
 * 
 * Usage:
 *   pnpm run list-accounts
 *   or
 *   tsx src/scripts/list-accounts.ts
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { DerivClient } from '../api/deriv-client.js';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find project root by looking for .env file
// Start from current script location and go up
function findProjectRoot(startPath: string): string | null {
  let current = resolve(startPath);
  const root = resolve(current, '/');

  while (current !== root) {
    const envPath = join(current, '.env');
    if (existsSync(envPath)) {
      return current;
    }
    current = resolve(current, '..');
  }
  return null;
}

// Load environment variables from project root
const projectRoot = findProjectRoot(__dirname) || process.cwd();
const envPath = join(projectRoot, '.env');

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`📁 Cargando .env desde: ${envPath}`);
} else {
  // Try current working directory
  dotenv.config();
  if (process.env.DERIV_API_TOKEN) {
    console.log(`📁 Usando variables de entorno del sistema`);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('📋 LISTANDO CUENTAS DISPONIBLES EN DERIV');
  console.log('='.repeat(80));
  console.log();

  const appId = parseInt(process.env.DERIV_APP_ID || '106646', 10);
  const apiToken = process.env.DERIV_API_TOKEN || '';

  if (!apiToken) {
    console.error('❌ Error: DERIV_API_TOKEN no está configurado');
    console.error('   Por favor, configura DERIV_API_TOKEN en tu archivo .env o como variable de entorno');
    console.error(`   Directorio actual: ${process.cwd()}`);
    console.error(`   Proyecto raíz: ${projectRoot}`);
    console.error(`   .env encontrado: ${existsSync(envPath) ? 'Sí' : 'No'}`);
    process.exit(1);
  }

  const client = new DerivClient({
    appId,
    apiToken,
    endpoint: process.env.DERIV_ENDPOINT || 'wss://ws.derivws.com/websockets/v3',
  });

  try {
    console.log('🔌 Conectando a Deriv API...');
    await client.connect();
    console.log('✅ Conectado\n');

    console.log('📊 Obteniendo lista de cuentas...');
    const accounts = await client.getAccounts();

    if (accounts.length === 0) {
      console.log('⚠️  No se encontraron cuentas');
      return;
    }

    console.log(`\n✅ Se encontraron ${accounts.length} cuenta(s):\n`);
    console.log('='.repeat(80));

    // Get real balance for each account
    const accountsWithBalance = await Promise.all(
      accounts.map(async (account) => {
        try {
          const balance = await client.getBalance(account.loginid);
          return {
            ...account,
            realBalance: balance.amount,
            realCurrency: balance.currency,
          };
        } catch (error: any) {
          // If we can't get balance for this account, use the one from account_list
          return {
            ...account,
            realBalance: account.balance,
            realCurrency: account.currency,
            balanceError: error.message,
          };
        }
      })
    );

    accountsWithBalance.forEach((account, index) => {
      console.log(`\n📌 Cuenta #${index + 1}:`);
      console.log(`   Login ID: ${account.loginid}`);
      console.log(`   Tipo: ${account.accountType.toUpperCase()}`);
      console.log(`   Plataforma: ${account.platform || 'N/A'}`);
      console.log(`   Moneda: ${account.realCurrency}`);

      // Show both balances if they differ
      if (Math.abs(account.realBalance - account.balance) > 0.01) {
        console.log(`   Balance (account_list): ${account.balance.toFixed(2)} ${account.currency}`);
        console.log(`   Balance (real): ${account.realBalance.toFixed(2)} ${account.realCurrency} ⭐`);
      } else {
        console.log(`   Balance: ${account.realBalance.toFixed(2)} ${account.realCurrency}`);
      }

      if ('balanceError' in account && account.balanceError) {
        console.log(`   ⚠️  Error obteniendo balance: ${account.balanceError}`);
      }

      if (account.accountName) {
        console.log(`   Nombre: ${account.accountName}`);
      }
      if (account.marketType) {
        console.log(`   Mercado: ${account.marketType}`);
      }

      // Show account type explanation based on loginid prefix
      if (account.loginid.startsWith('VRT')) {
        console.log(`   📝 Demo account (Binary Options/CFD)`);
      } else if (account.loginid.startsWith('CR')) {
        console.log(`   📝 Real account (Binary Options/CFD)`);
      } else if (account.loginid.startsWith('MF')) {
        console.log(`   📝 Real account (MT5 - CFD)`);
      } else if (account.loginid.startsWith('CT')) {
        console.log(`   📝 Real account (cTrader - CFD)`);
      } else if (account.loginid.startsWith('DX')) {
        console.log(`   📝 Real account (Deriv X - CFD)`);
      } else if (account.loginid.startsWith('VRW')) {
        console.log(`   📝 Real account (Virtual - Synthetic)`);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 Para usar una cuenta específica, configura:');
    if (accounts.length > 0 && accounts[0]) {
      console.log(`   DERIV_ACCOUNT="${accounts[0].loginid}"`);
    }
    console.log('\n   O usa "current" para la cuenta por defecto:');
    console.log('   DERIV_ACCOUNT="current"');
    console.log();

    // Also get current account balance
    console.log('📊 Cuenta actual (current):');
    try {
      const currentBalance = await client.getBalance('current');
      console.log(`   Login ID: ${currentBalance.loginid || 'N/A'}`);
      console.log(`   Tipo: ${currentBalance.accountType.toUpperCase()}`);
      console.log(`   Balance: ${currentBalance.amount.toFixed(2)} ${currentBalance.currency}`);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`   ⚠️  Error obteniendo balance: ${errorMessage}`);
    }

    // Get open positions for each account
    console.log('\n' + '='.repeat(80));
    console.log('📈 POSICIONES ABIERTAS');
    console.log('='.repeat(80));

    for (const account of accountsWithBalance) {
      try {
        console.log(`\n🔍 Buscando posiciones abiertas en ${account.loginid}...`);
        const positions = await client.getPortfolio(account.loginid);

        if (positions.length === 0) {
          console.log(`   ✅ No hay posiciones abiertas`);
          continue;
        }

        console.log(`\n   📊 ${positions.length} posición(es) abierta(s):\n`);

        let totalProfit = 0;
        positions.forEach((pos, idx) => {
          const profitColor = pos.profit >= 0 ? '🟢' : '🔴';
          console.log(`   ${profitColor} Posición #${idx + 1}:`);
          console.log(`      Contract ID: ${pos.contractId}`);
          console.log(`      Asset: ${pos.symbol}`);
          console.log(`      Tipo: ${pos.contractType}`);
          console.log(`      Precio entrada: ${pos.buyPrice.toFixed(2)}`);
          console.log(`      Precio actual: ${pos.currentPrice.toFixed(2)}`);
          console.log(`      Ganancia/Pérdida: ${pos.profit >= 0 ? '+' : ''}${pos.profit.toFixed(2)} (${pos.profitPercentage >= 0 ? '+' : ''}${pos.profitPercentage.toFixed(2)}%)`);
          if (pos.multiplier) {
            console.log(`      Multiplicador: ${pos.multiplier}x`);
          }
          if (pos.takeProfit) {
            console.log(`      Take Profit: ${pos.takeProfit.toFixed(2)}`);
          }
          if (pos.stopLoss) {
            console.log(`      Stop Loss: ${pos.stopLoss.toFixed(2)}`);
          }
          console.log(`      Abierta: ${pos.purchaseTime.toLocaleString()}`);
          console.log();
          totalProfit += pos.profit;
        });

        const totalColor = totalProfit >= 0 ? '🟢' : '🔴';
        console.log(`   ${totalColor} Ganancia/Pérdida Total: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}`);

      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`   ⚠️  Error obteniendo posiciones: ${errorMessage}`);
      }
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.message?.includes('Permission denied')) {
      console.error('\n💡 Sugerencia: Verifica que tu token de API tenga los permisos necesarios');
    }
    process.exit(1);
  } finally {
    // Note: DerivClient doesn't have a disconnect method, WebSocket will close automatically
    console.log('\n🔌 Desconectando...');
  }
}

main().catch(console.error);

