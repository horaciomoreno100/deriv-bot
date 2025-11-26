import React from 'react';
import { Box, Text } from 'ink';

export interface SignalProximity {
  asset: string;
  proximity: number;
  direction: 'CALL' | 'PUT' | null;
  conditions: {
    name: string;
    status: 'met' | 'not_met' | 'warning';
    value?: string | number;
  }[];
}

interface SignalProximityProps {
  proximity: SignalProximity[];
}

const ProgressBar: React.FC<{ value: number; width?: number }> = ({ value, width = 20 }) => {
  const filled = Math.floor((value / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  let color: 'red' | 'yellow' | 'green' = 'red';
  if (value >= 75) color = 'green';
  else if (value >= 50) color = 'yellow';

  return <Text color={color}>{bar}</Text>;
};

export const SignalProximityPanel: React.FC<SignalProximityProps> = ({ proximity }) => {
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold color="yellow">
        📡 SIGNAL PROXIMITY
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {proximity.length === 0 ? (
          <Text color="gray" dimColor>
            No signals available
          </Text>
        ) : (
          proximity.map((sig, index) => (
            <Box key={index} flexDirection="column" marginBottom={1}>
              <Box>
                <Text bold>{sig.asset}: </Text>
                <ProgressBar value={sig.proximity} />
                <Text> {sig.proximity}%</Text>
                {sig.direction && (
                  <Text color={sig.direction === 'CALL' ? 'green' : 'red'}>
                    {' '}
                    ({sig.direction})
                  </Text>
                )}
              </Box>
              <Box flexDirection="column" marginLeft={2}>
                {sig.conditions.slice(0, 3).map((cond, condIndex) => {
                  const icon =
                    cond.status === 'met' ? '✓' : cond.status === 'warning' ? '⚠️' : '✗';
                  const color =
                    cond.status === 'met'
                      ? 'green'
                      : cond.status === 'warning'
                      ? 'yellow'
                      : 'red';
                  const value = cond.value ? `: ${cond.value}` : '';

                  return (
                    <Text key={condIndex} color={color}>
                      {icon} {cond.name}
                      {value}
                    </Text>
                  );
                })}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
