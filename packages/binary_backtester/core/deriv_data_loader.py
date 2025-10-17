"""
Data loader for Deriv API integration
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import json
import os

class DerivDataLoader:
    """
    Loads historical data from Deriv API or local files
    """
    
    def __init__(self, data_path: Optional[str] = None):
        self.data_path = data_path or "data"
        self.ensure_data_directory()
    
    def ensure_data_directory(self):
        """Create data directory if it doesn't exist"""
        if not os.path.exists(self.data_path):
            os.makedirs(self.data_path)
    
    def load_historical_data(self,
                           symbol: str,
                           timeframe: int,
                           start_date: datetime,
                           end_date: datetime) -> pd.DataFrame:
        """
        Load historical data for a symbol and timeframe
        """
        # Try to load from Deriv format files first (deriv_candles_*.json)
        deriv_file = self._find_deriv_file()
        if deriv_file:
            print(f"📊 Loading Deriv data from {deriv_file}")
            return self._load_from_deriv_file(deriv_file)

        # Try to load from local file
        local_file = self._get_local_file_path(symbol, timeframe)
        if os.path.exists(local_file):
            return self._load_from_file(local_file)

        # If no local file, generate synthetic data for MVP
        print(f"⚠️  No local data found for {symbol}, generating synthetic data...")
        return self._generate_synthetic_data(symbol, timeframe, start_date, end_date)
    
    def _find_deriv_file(self) -> Optional[str]:
        """Find the most recent deriv_candles_*.json file"""
        if not os.path.exists(self.data_path):
            return None

        deriv_files = [f for f in os.listdir(self.data_path) if f.startswith('deriv_candles_') and f.endswith('.json')]
        if not deriv_files:
            return None

        # Get the most recent file
        deriv_files_full = [os.path.join(self.data_path, f) for f in deriv_files]
        latest_file = max(deriv_files_full, key=os.path.getmtime)
        return latest_file

    def _load_from_deriv_file(self, file_path: str) -> pd.DataFrame:
        """Load data from Deriv format JSON file"""
        try:
            with open(file_path, 'r') as f:
                candles = json.load(f)

            # Convert to DataFrame
            df_data = []
            for candle in candles:
                df_data.append({
                    'datetime': datetime.fromtimestamp(candle['epoch']),
                    'open': float(candle['open']),
                    'high': float(candle['high']),
                    'low': float(candle['low']),
                    'close': float(candle['close']),
                    'volume': 100  # Fake volume since Deriv doesn't provide it
                })

            df = pd.DataFrame(df_data)
            df = df.set_index('datetime')

            print(f"✅ Loaded {len(df)} candles from Deriv file")
            return df

        except Exception as e:
            print(f"❌ Error loading Deriv data from {file_path}: {e}")
            raise

    def _get_local_file_path(self, symbol: str, timeframe: int) -> str:
        """Get local file path for data"""
        filename = f"{symbol}_{timeframe}s.json"
        return os.path.join(self.data_path, filename)
    
    def _load_from_file(self, file_path: str) -> pd.DataFrame:
        """Load data from local JSON file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Convert to DataFrame
            df = pd.DataFrame(data['candles'])
            df['datetime'] = pd.to_datetime(df['timestamp'], unit='s')
            df = df.set_index('datetime')
            
            # Ensure we have OHLC columns
            required_columns = ['open', 'high', 'low', 'close']
            for col in required_columns:
                if col not in df.columns:
                    raise ValueError(f"Missing required column: {col}")
            
            return df[required_columns]
            
        except Exception as e:
            print(f"❌ Error loading data from {file_path}: {e}")
            raise
    
    def _generate_synthetic_data(self, 
                               symbol: str, 
                               timeframe: int, 
                               start_date: datetime, 
                               end_date: datetime) -> pd.DataFrame:
        """
        Generate synthetic OHLC data for MVP testing
        """
        print(f"🔄 Generating synthetic data for {symbol} ({timeframe}s timeframe)")
        
        # Calculate number of candles needed
        total_seconds = (end_date - start_date).total_seconds()
        num_candles = int(total_seconds / timeframe)
        
        # Generate price data using random walk
        base_price = 2000.0 if 'XAU' in symbol else 1.1000  # Gold or Forex
        
        prices = [base_price]
        for i in range(num_candles - 1):
            # Random walk with slight upward bias
            change = np.random.normal(0, 0.001) * prices[-1]
            new_price = prices[-1] + change
            prices.append(max(new_price, 0.01))  # Ensure positive prices
        
        # Generate OHLC data
        data = []
        current_time = start_date
        
        for i, close_price in enumerate(prices):
            # Generate OHLC for this candle
            open_price = prices[i-1] if i > 0 else close_price
            high_price = max(open_price, close_price) * (1 + abs(np.random.normal(0, 0.002)))
            low_price = min(open_price, close_price) * (1 - abs(np.random.normal(0, 0.002)))
            
            data.append({
                'datetime': current_time,
                'open': open_price,
                'high': high_price,
                'low': low_price,
                'close': close_price,
                'volume': np.random.randint(100, 1000)
            })
            
            current_time += timedelta(seconds=timeframe)
        
        # Create DataFrame
        df = pd.DataFrame(data)
        df = df.set_index('datetime')
        
        # Save synthetic data for future use
        self._save_synthetic_data(symbol, timeframe, df)
        
        print(f"✅ Generated {len(df)} candles of synthetic data")
        return df[['open', 'high', 'low', 'close']]
    
    def _save_synthetic_data(self, symbol: str, timeframe: int, df: pd.DataFrame):
        """Save synthetic data to file"""
        try:
            file_path = self._get_local_file_path(symbol, timeframe)
            
            # Convert to Deriv format
            data = {
                'symbol': symbol,
                'timeframe': timeframe,
                'candles': []
            }
            
            for timestamp, row in df.iterrows():
                data['candles'].append({
                    'timestamp': int(timestamp.timestamp()),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': int(row.get('volume', 100))
                })
            
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=2)
            
            print(f"💾 Saved synthetic data to {file_path}")
            
        except Exception as e:
            print(f"⚠️  Could not save synthetic data: {e}")
    
    def get_available_symbols(self) -> List[str]:
        """Get list of available symbols"""
        if not os.path.exists(self.data_path):
            return []
        
        symbols = []
        for filename in os.listdir(self.data_path):
            if filename.endswith('.json'):
                symbol = filename.split('_')[0]
                if symbol not in symbols:
                    symbols.append(symbol)
        
        return symbols
