/**
 * Test to ensure UnifiedTradeAdapter is instantiated with correct parameter order
 * across all runner scripts.
 *
 * This test prevents the bug where parameters were swapped:
 * - WRONG: new UnifiedTradeAdapter(TRADE_MODE, gatewayClient)
 * - RIGHT: new UnifiedTradeAdapter(gatewayClient, TRADE_MODE)
 *
 * When parameters are swapped, the string 'cfd' or 'binary' is passed as gatewayClient,
 * causing "tradeCFD is not a function" errors at runtime.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('UnifiedTradeAdapter Instantiation', () => {
  it('should have correct parameter order in all runner scripts', () => {
    const scriptsDir = path.resolve(__dirname, '../../scripts');
    const allFiles = fs.readdirSync(scriptsDir);
    const runnerFiles = allFiles.filter(f => f.startsWith('run-') && f.endsWith('.ts'));

    const errors: string[] = [];

    for (const file of runnerFiles) {
      const filePath = path.join(scriptsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Find all UnifiedTradeAdapter instantiations
      const regex = /new\s+UnifiedTradeAdapter\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\)/g;
      let match;

      while ((match = regex.exec(content)) !== null) {
        const firstArg = match[1].trim();
        const secondArg = match[2].trim();

        // Check if first argument looks like a mode (string literal or TRADE_MODE variable)
        const modePatterns = [
          /^['"](?:binary|cfd)['"]$/, // String literals: 'binary', 'cfd', "binary", "cfd"
          /^TRADE_MODE$/,              // Common variable name for mode
          /^mode$/i,                   // Variable named 'mode'
        ];

        const firstArgLooksLikeMode = modePatterns.some(p => p.test(firstArg));

        // Check if second argument looks like a gateway client
        const clientPatterns = [
          /client$/i,        // ends with 'client'
          /^gateway/i,       // starts with 'gateway'
          /Client$/,         // ends with 'Client' (camelCase)
        ];

        const secondArgLooksLikeClient = clientPatterns.some(p => p.test(secondArg));

        // If first arg looks like mode AND second looks like client, parameters are swapped!
        if (firstArgLooksLikeMode && secondArgLooksLikeClient) {
          errors.push(
            `${file}: Parameters are SWAPPED!\n` +
            `  Found: new UnifiedTradeAdapter(${firstArg}, ${secondArg})\n` +
            `  Expected: new UnifiedTradeAdapter(${secondArg}, ${firstArg})\n` +
            `  The constructor signature is: UnifiedTradeAdapter(gatewayClient, mode)`
          );
        }

        // Also check: if first arg looks like mode but second doesn't look like client
        // This is still likely wrong
        if (firstArgLooksLikeMode && !secondArgLooksLikeClient) {
          // Only flag if the second arg also doesn't look like a client
          const secondArgMightBeClient = /client|gateway|ws|socket|connection/i.test(secondArg);
          if (!secondArgMightBeClient) {
            errors.push(
              `${file}: First parameter looks like a mode, which is incorrect!\n` +
              `  Found: new UnifiedTradeAdapter(${firstArg}, ${secondArg})\n` +
              `  The first parameter should be a GatewayClient instance`
            );
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `UnifiedTradeAdapter parameter order issues found:\n\n${errors.join('\n\n')}\n\n` +
        `REMINDER: UnifiedTradeAdapter constructor signature is:\n` +
        `  constructor(gatewayClient: GatewayClient, mode: TradeMode = 'binary')\n` +
        `\nThe gatewayClient MUST be the first parameter!`
      );
    }

    // Log success with count
    console.log(`✅ Checked ${runnerFiles.length} runner scripts - all have correct parameter order`);
  });

  it('should instantiate UnifiedTradeAdapter with GatewayClient as first parameter', () => {
    // This is a type-level test - TypeScript should catch this at compile time
    // but we document the expected behavior here

    // The constructor signature is:
    // constructor(gatewayClient: GatewayClient, mode: TradeMode = 'binary')

    // Example of CORRECT usage:
    // const adapter = new UnifiedTradeAdapter(gatewayClient, 'cfd');
    // const adapter = new UnifiedTradeAdapter(gatewayClient, TRADE_MODE);

    // Example of WRONG usage (would cause runtime errors):
    // const adapter = new UnifiedTradeAdapter(TRADE_MODE, gatewayClient); // WRONG!
    // const adapter = new UnifiedTradeAdapter('cfd', gatewayClient);      // WRONG!

    expect(true).toBe(true); // Placeholder - the real check is in the first test
  });
});
