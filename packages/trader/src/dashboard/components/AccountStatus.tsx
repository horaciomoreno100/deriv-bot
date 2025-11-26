import React from 'react';
import { Box, Text } from 'ink';
import type { Balance } from '@deriv-bot/shared';

interface AccountStatusProps {
  balance: Balance | null;
  lastUpdate: Date;
}

export const AccountStatus: React.FC<AccountStatusProps> = ({ balance, lastUpdate }) => {
  return (
    <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
      <Text bold color="green">
        📊 ACCOUNT STATUS
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {balance ? (
          <>
            <Text>
              <Text color="gray">Account:</Text>{' '}
              <Text bold>{balance.loginid || 'N/A'}</Text>{' '}
              <Text color="yellow">({balance.accountType.toUpperCase()})</Text>
            </Text>
            <Text>
              <Text color="gray">Balance:</Text>{' '}
              <Text bold color="green">
                ${balance.amount.toFixed(2)} {balance.currency}
              </Text>
            </Text>
          </>
        ) : (
          <Text color="yellow">Loading...</Text>
        )}
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Last Update: {lastUpdate.toLocaleTimeString()}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
