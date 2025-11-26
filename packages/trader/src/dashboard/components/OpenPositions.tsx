import React from 'react';
import { Box, Text } from 'ink';

export interface Position {
  contractId: string;
  symbol: string;
  contractType: string;
  buyPrice: number;
  currentPrice: number;
  profit: number;
  profitPercentage: number;
  purchaseTime: Date;
  status: 'open' | 'sold';
}

interface OpenPositionsProps {
  positions: Position[];
}

export const OpenPositions: React.FC<OpenPositionsProps> = ({ positions }) => {
  return (
    <Box borderStyle="round" borderColor="blue" paddingX={1} flexDirection="column">
      <Text bold color="blue">
        📈 OPEN POSITIONS ({positions.length})
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {positions.length === 0 ? (
          <Text color="gray" dimColor>
            No open positions
          </Text>
        ) : (
          positions.slice(0, 5).map((pos) => {
            const isProfit = pos.profit >= 0;
            const icon = isProfit ? '🟢' : '🔴';
            const profitSign = isProfit ? '+' : '';
            const color = isProfit ? 'green' : 'red';

            return (
              <Box key={pos.contractId} flexDirection="column" marginBottom={1}>
                <Text>
                  {icon}{' '}
                  <Text bold>{pos.symbol}</Text>{' '}
                  <Text color="cyan">{pos.contractType}</Text>
                </Text>
                <Text>
                  <Text color="gray">  P&L:</Text>{' '}
                  <Text bold color={color}>
                    {profitSign}${pos.profit.toFixed(2)}
                  </Text>{' '}
                  <Text color={color}>
                    ({profitSign}
                    {pos.profitPercentage.toFixed(2)}%)
                  </Text>
                </Text>
                <Text color="gray" dimColor>
                  {'  '}Entry: {pos.buyPrice.toFixed(2)} | Current: {pos.currentPrice.toFixed(2)}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
};
