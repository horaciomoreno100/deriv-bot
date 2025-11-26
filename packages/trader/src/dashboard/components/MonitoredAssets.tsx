import React from 'react';
import { Box, Text } from 'ink';

export interface Asset {
  symbol: string;
  price: number;
  change: number;
  status: string;
}

interface MonitoredAssetsProps {
  assets: Asset[];
}

export const MonitoredAssets: React.FC<MonitoredAssetsProps> = ({ assets }) => {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">
        📊 MONITORED ASSETS ({assets.length})
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {assets.length === 0 ? (
          <Text color="gray" dimColor>
            No monitored assets
          </Text>
        ) : (
          assets.map((asset) => {
            const changeIcon = asset.change >= 0 ? '▲' : '▼';
            const changeSign = asset.change >= 0 ? '+' : '';
            const changeColor = asset.change >= 0 ? 'green' : 'red';

            return (
              <Box key={asset.symbol}>
                <Text>
                  <Text bold>{asset.symbol}:</Text>{' '}
                  <Text color="white">{asset.price.toFixed(2)}</Text>{' '}
                  <Text color={changeColor}>
                    {changeIcon} {changeSign}
                    {asset.change.toFixed(2)}%
                  </Text>{' '}
                  <Text color="gray">[{asset.status}]</Text>
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
};
