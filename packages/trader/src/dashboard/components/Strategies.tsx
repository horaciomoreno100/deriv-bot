import React from 'react';
import { Box, Text } from 'ink';

export interface StrategyInfo {
  name: string;
  assets: string[];
  status: 'active' | 'paused';
  signalsToday: number;
}

interface StrategiesProps {
  strategies: StrategyInfo[];
}

export const Strategies: React.FC<StrategiesProps> = ({ strategies }) => {
  return (
    <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
      <Text bold color="magenta">
        🎯 ACTIVE STRATEGIES ({strategies.length})
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {strategies.length === 0 ? (
          <Text color="gray" dimColor>
            No active strategies
          </Text>
        ) : (
          strategies.map((strategy, index) => (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Text>
                <Text color="green">✓</Text> <Text bold>{strategy.name}</Text>
              </Text>
              <Text color="gray" dimColor>
                {'  '}Assets: {strategy.assets.join(', ')}
              </Text>
              <Text>
                <Text color="gray">  Status:</Text>{' '}
                <Text bold color={strategy.status === 'active' ? 'green' : 'yellow'}>
                  {strategy.status.toUpperCase()}
                </Text>{' '}
                <Text color="gray">| Signals:</Text> <Text>{strategy.signalsToday} today</Text>
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
