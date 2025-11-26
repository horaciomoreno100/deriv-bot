import React from 'react';
import { Box, Text } from 'ink';

export const Header: React.FC = () => {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        🚀 DERIV BOT TRADING DASHBOARD
      </Text>
    </Box>
  );
};
