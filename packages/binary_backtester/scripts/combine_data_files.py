#!/usr/bin/env python3
"""
Combine multiple data files to create a larger dataset for backtesting
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

class DataCombiner:
    """Combine multiple data files for larger dataset"""
    
    def __init__(self):
        self.data_dir = Path(__file__).parent.parent / "data"
        self.output_dir = self.data_dir / "combined"
        self.output_dir.mkdir(exist_ok=True)
        
    def load_data_file(self, filepath):
        """Load data from a JSON file"""
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            
            # Handle different formats
            if isinstance(data, dict) and 'candles' in data:
                candles = data['candles']
                symbol = data.get('symbol', 'unknown')
            elif isinstance(data, list):
                candles = data
                symbol = 'unknown'
            else:
                print(f"❌ Unknown format in {filepath}")
                return None
                
            print(f"✅ Loaded {len(candles)} candles from {filepath.name}")
            return {
                'symbol': symbol,
                'candles': candles,
                'filename': filepath.name
            }
            
        except Exception as e:
            print(f"❌ Error loading {filepath}: {e}")
            return None
            
    def combine_data_files(self, pattern="*.json"):
        """Combine all data files matching pattern"""
        print(f"🔍 Looking for files matching: {pattern}")
        
        data_files = list(self.data_dir.glob(pattern))
        if not data_files:
            print(f"❌ No files found matching {pattern}")
            return None
            
        print(f"📁 Found {len(data_files)} files")
        
        all_candles = []
        symbols = set()
        
        for filepath in data_files:
            print(f"\n📊 Processing {filepath.name}...")
            data = self.load_data_file(filepath)
            
            if data:
                all_candles.extend(data['candles'])
                symbols.add(data['symbol'])
                
        if not all_candles:
            print("❌ No data loaded")
            return None
            
        # Sort candles by timestamp and fix timestamp issues
        def get_timestamp(candle):
            ts = candle.get('timestamp', candle.get('epoch', 0))
            # Convert to int if it's a string
            if isinstance(ts, str):
                try:
                    return int(ts)
                except:
                    return 0
            return int(ts) if ts else 0
            
        all_candles.sort(key=get_timestamp)
        
        # Fix timestamp issues - ensure all timestamps are valid
        base_timestamp = get_timestamp(all_candles[0]) if all_candles else 0
        for i, candle in enumerate(all_candles):
            if not get_timestamp(candle) or get_timestamp(candle) < 1000000000:  # Invalid timestamp
                # Create a valid timestamp
                candle['timestamp'] = base_timestamp + (i * 60)  # 1 minute intervals
                if 'epoch' in candle:
                    candle['epoch'] = candle['timestamp']
        
        # Create combined dataset
        combined_data = {
            "symbol": list(symbols)[0] if len(symbols) == 1 else "MULTIPLE",
            "timeframe": 60,
            "candles": all_candles,
            "totalCandles": len(all_candles),
            "combined_from": [f.name for f in data_files],
            "symbols": list(symbols),
            "created_at": datetime.now().isoformat()
        }
        
        # Save combined data
        output_file = self.output_dir / f"combined_30days_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(combined_data, f, indent=2)
            
        print(f"\n✅ Combined data saved to: {output_file}")
        print(f"📊 Total candles: {len(all_candles):,}")
        print(f"📅 Date range: {all_candles[0].get('timestamp', all_candles[0].get('epoch', 0))} to {all_candles[-1].get('timestamp', all_candles[-1].get('epoch', 0))}")
        
        return output_file
        
    def create_synthetic_30days(self, base_file):
        """Create a synthetic 30-day dataset from existing data"""
        print(f"🔄 Creating synthetic 30-day dataset from {base_file.name}...")
        
        data = self.load_data_file(base_file)
        if not data:
            return None
            
        candles = data['candles']
        if len(candles) < 100:
            print(f"❌ Not enough data in {base_file.name} ({len(candles)} candles)")
            return None
            
        # Create synthetic data by repeating and modifying the base data
        synthetic_candles = []
        base_timestamp = candles[0].get('timestamp', candles[0].get('epoch', 0))
        
        # Repeat the data multiple times to simulate 30 days
        days_needed = 30
        current_day = 0
        
        while current_day < days_needed:
            for i, candle in enumerate(candles):
                # Create new timestamp for each day
                new_timestamp = base_timestamp + (current_day * 24 * 60 * 60) + (i * 60)
                
                # Add some random variation to prices
                import random
                variation = random.uniform(0.98, 1.02)  # ±2% variation
                
                new_candle = {
                    'timestamp': new_timestamp,
                    'open': candle['open'] * variation,
                    'high': candle['high'] * variation,
                    'low': candle['low'] * variation,
                    'close': candle['close'] * variation,
                    'volume': candle.get('volume', 1000)
                }
                
                synthetic_candles.append(new_candle)
                
            current_day += 1
            
        # Create synthetic dataset
        synthetic_data = {
            "symbol": data['symbol'],
            "timeframe": 60,
            "candles": synthetic_candles,
            "totalCandles": len(synthetic_candles),
            "synthetic": True,
            "base_file": base_file.name,
            "days": 30,
            "created_at": datetime.now().isoformat()
        }
        
        # Save synthetic data
        output_file = self.output_dir / f"synthetic_30days_{data['symbol']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(synthetic_data, f, indent=2)
            
        print(f"✅ Synthetic 30-day dataset saved to: {output_file}")
        print(f"📊 Total candles: {len(synthetic_candles):,}")
        print(f"📅 Simulated 30 days of data")
        
        return output_file

def main():
    """Main function"""
    print("🎯 DATA COMBINER FOR 30-DAY BACKTESTING")
    print("=" * 45)
    
    combiner = DataCombiner()
    
    # Try to combine existing files
    print("\n📊 Attempting to combine existing data files...")
    combined_file = combiner.combine_data_files("*.json")
    
    if combined_file:
        print(f"\n✅ Successfully combined data files")
        print(f"📁 Output: {combined_file}")
        return 0
    
    # If no files to combine, create synthetic data
    print("\n🔄 No files to combine, creating synthetic 30-day dataset...")
    
    # Find any existing data file
    data_files = list(combiner.data_dir.glob("*.json"))
    if not data_files:
        print("❌ No data files found to create synthetic dataset")
        return 1
        
    # Use the largest file as base
    largest_file = max(data_files, key=lambda f: f.stat().st_size)
    print(f"📁 Using {largest_file.name} as base for synthetic data")
    
    synthetic_file = combiner.create_synthetic_30days(largest_file)
    if synthetic_file:
        print(f"\n✅ Successfully created synthetic 30-day dataset")
        print(f"📁 Output: {synthetic_file}")
        return 0
    
    print("❌ Failed to create dataset")
    return 1

if __name__ == "__main__":
    exit_code = main()
    exit(exit_code)
