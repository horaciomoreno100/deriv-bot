"""
Real Deriv API data loader for binary options backtester MVP
Uses actual Deriv API data instead of synthetic data
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import json
import os
from .real_deriv_connector import RealDerivConnector

class RealDerivDataLoader:
    """
    Loads real historical data from Deriv API
    """
    
    def __init__(self, data_path: Optional[str] = None):
        self.data_path = data_path or "data"
        self.ensure_data_directory()
        self.connector = RealDerivConnector()
        
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
        Load real historical data from Deriv API
        """
        print(f"📊 Loading REAL data from Deriv API for {symbol}...")
        
        # Try to load from local cache first
        local_file = self._get_local_file_path(symbol, timeframe, start_date, end_date)
        if os.path.exists(local_file):
            print(f"✅ Loading cached real data from {local_file}")
            return self._load_from_file(local_file)
        
        # Connect to Deriv API and fetch real data
        try:
            if not self.connector.connect():
                raise Exception("Failed to connect to Deriv API")
            
            # Calculate number of candles needed
            total_seconds = (end_date - start_date).total_seconds()
            num_candles = int(total_seconds / timeframe)
            
            print(f"🔄 Fetching {num_candles} real candles from Deriv API...")
            
            # Get real data from Deriv API
            real_candles = self.connector.get_historical_data(symbol, num_candles)
            
            if real_candles:
                df = self._process_real_candles(real_candles)
                if not df.empty:
                    # Save real data to cache
                    self._save_real_data(local_file, df)
                    print(f"✅ Loaded {len(df)} REAL candles from Deriv API")
                    return df
            
            # If no real data, try to load from existing real data files
            print("⚠️  No real-time data, checking for existing real data files...")
            return self._load_existing_real_data(symbol, timeframe, start_date, end_date)
                
        except Exception as e:
            print(f"❌ Error fetching from Deriv API: {e}")
            print("⚠️  Trying to load existing real data...")
            return self._load_existing_real_data(symbol, timeframe, start_date, end_date)
        finally:
            self.connector.disconnect()
    
    def _load_existing_real_data(self, symbol: str, timeframe: int, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """
        Load existing real data from files
        """
        try:
            # Look for existing real data files
            for filename in os.listdir(self.data_path):
                if filename.startswith('deriv_candles_') and filename.endswith('.json'):
                    filepath = os.path.join(self.data_path, filename)
                    print(f"📂 Loading existing real data from {filename}")
                    
                    with open(filepath, 'r') as f:
                        candles = json.load(f)
                    
                    if candles:
                        df = self._process_real_candles(candles)
                        if not df.empty:
                            print(f"✅ Loaded {len(df)} REAL candles from existing data")
                            return df
            
            print("❌ No real data files found")
            raise Exception("No real data available")
            
        except Exception as e:
            print(f"❌ Error loading existing real data: {e}")
            raise Exception("No real data available - cannot use synthetic data")
    
    def _process_real_candles(self, candles: List[Dict]) -> pd.DataFrame:
        """
        Process real Deriv API candles into DataFrame
        """
        if not candles:
            return pd.DataFrame()
        
        data = []
        
        for candle in candles:
            try:
                # Real Deriv candles format
                if 'epoch' in candle and 'open' in candle:
                    timestamp = candle['epoch']
                    open_price = float(candle['open'])
                    high_price = float(candle['high'])
                    low_price = float(candle['low'])
                    close_price = float(candle['close'])
                    
                    # Convert timestamp to datetime
                    dt = datetime.fromtimestamp(timestamp)
                    
                    data.append({
                        'datetime': dt,
                        'open': open_price,
                        'high': high_price,
                        'low': low_price,
                        'close': close_price,
                        'volume': 100  # Default volume
                    })
                    
            except (ValueError, KeyError) as e:
                print(f"⚠️  Error processing real candle: {e}")
                continue
        
        if not data:
            return pd.DataFrame()
        
        df = pd.DataFrame(data)
        df = df.set_index('datetime')
        df = df.sort_index()
        
        print(f"📊 Processed {len(df)} real candles")
        print(f"   Date range: {df.index.min()} to {df.index.max()}")
        print(f"   Price range: ${df['close'].min():.2f} - ${df['close'].max():.2f}")
        
        return df[['open', 'high', 'low', 'close']]
    
    def _get_local_file_path(self, symbol: str, timeframe: int, start_date: datetime, end_date: datetime) -> str:
        """Get local file path for cached real data"""
        start_str = start_date.strftime('%Y%m%d')
        end_str = end_date.strftime('%Y%m%d')
        filename = f"real_{symbol}_{timeframe}s_{start_str}_{end_str}.json"
        return os.path.join(self.data_path, filename)
    
    def _load_from_file(self, file_path: str) -> pd.DataFrame:
        """Load real data from local JSON file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Convert to DataFrame
            df = pd.DataFrame(data['candles'])
            df['datetime'] = pd.to_datetime(df['datetime'])
            df = df.set_index('datetime')
            
            print(f"✅ Loaded {len(df)} real candles from cache")
            return df[['open', 'high', 'low', 'close']]
            
        except Exception as e:
            print(f"❌ Error loading real data from {file_path}: {e}")
            raise
    
    def _save_real_data(self, file_path: str, df: pd.DataFrame):
        """Save real DataFrame to local JSON file"""
        try:
            data = {
                'symbol': df.index[0].strftime('%Y%m%d') if len(df) > 0 else 'unknown',
                'timeframe': 60,
                'source': 'real_deriv_api',
                'candles': []
            }
            
            for timestamp, row in df.iterrows():
                data['candles'].append({
                    'datetime': timestamp.isoformat(),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close'])
                })
            
            with open(file_path, 'w') as f:
                json.dump(data, f, indent=2)
            
            print(f"💾 Cached real data to {file_path}")
            
        except Exception as e:
            print(f"⚠️  Could not save real data to cache: {e}")
    
    def get_available_symbols(self) -> List[str]:
        """Get list of available real data symbols"""
        if not os.path.exists(self.data_path):
            return []
        
        symbols = []
        for filename in os.listdir(self.data_path):
            if filename.startswith('real_') and filename.endswith('.json'):
                symbol = filename.split('_')[1]
                if symbol not in symbols:
                    symbols.append(symbol)
        
        return symbols