import React from 'react';
import { Box, Text } from 'ink';

export const Commands: React.FC = () => {
  return (
    <Box borderStyle="round" borderColor="white" paddingX={1} flexDirection="column">
      <Text bold>⌨️  COMMANDS</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">
          <Text color="white" bold>
            q
          </Text>{' '}
          - Quit
        </Text>
        <Text color="gray">
          <Text color="white" bold>
            r
          </Text>{' '}
          - Refresh
        </Text>
        <Text color="gray">
          <Text color="white" bold>
            c
          </Text>{' '}
          - Compact mode
        </Text>
        <Text color="gray">
          <Text color="white" bold>
            h
          </Text>{' '}
          - Help
        </Text>
      </Box>
    </Box>
  );
};
