#!/usr/bin/env python3
"""
Extend existing data to simulate 30 days for robust backtesting
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
import random

class DataExtender:
    """Extend existing data to 30 days"""
    
    def __init__(self):
        self.data_dir = Path(__file__).parent.parent / "data"
        self.output_dir = self.data_dir / "extended"
        self.output_dir.mkdir(exist_ok=True)
        
    def load_existing_data(self, filepath):
        """Load existing data file"""
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
            
    def extend_data_to_30days(self, data, target_days=30):
        """Extend data to 30 days by repeating and varying the base data"""
        print(f"🔄 Extending data to {target_days} days...")
        
        base_candles = data['candles']
        if len(base_candles) < 100:
            print(f"❌ Not enough base data ({len(base_candles)} candles)")
            return None
            
        # Calculate how many times we need to repeat the data
        base_days = len(base_candles) / (24 * 60)  # Assuming 1-minute candles
        repetitions_needed = int(target_days / base_days) + 1
        
        print(f"   Base data covers {base_days:.1f} days")
        print(f"   Need {repetitions_needed} repetitions to reach {target_days} days")
        
        extended_candles = []
        base_timestamp = base_candles[0].get('timestamp', base_candles[0].get('epoch', 0))
        
        # Generate exactly 30 days of data
        target_candles = target_days * 24 * 60  # 30 days * 24 hours * 60 minutes
        current_timestamp = base_timestamp
        
        for i in range(target_candles):
            # Cycle through base candles
            base_candle = base_candles[i % len(base_candles)]
            
            # Add random variation to prices (±1% to ±3%)
            variation = random.uniform(0.97, 1.03)
            
            # Add some trend variation over time
            trend_factor = 1 + (i / target_candles) * 0.01  # Slight trend over 30 days
            
            new_candle = {
                'timestamp': current_timestamp,
                'open': base_candle['open'] * variation * trend_factor,
                'high': base_candle['high'] * variation * trend_factor,
                'low': base_candle['low'] * variation * trend_factor,
                'close': base_candle['close'] * variation * trend_factor,
                'volume': base_candle.get('volume', 1000)
            }
            
            extended_candles.append(new_candle)
            
            # Increment timestamp by 1 minute
            current_timestamp += 60
                
        # Trim to exactly 30 days
        target_candles = target_days * 24 * 60
        extended_candles = extended_candles[:target_candles]
        
        print(f"✅ Extended to {len(extended_candles)} candles ({len(extended_candles)/(24*60):.1f} days)")
        
        return extended_candles
        
    def create_30day_dataset(self, base_file, target_days=30):
        """Create a 30-day dataset from base file"""
        print(f"📊 Creating {target_days}-day dataset from {base_file.name}...")
        
        # Load base data
        data = self.load_existing_data(base_file)
        if not data:
            return None
            
        # Extend data
        extended_candles = self.extend_data_to_30days(data, target_days)
        if not extended_candles:
            return None
            
        # Create extended dataset
        extended_data = {
            "symbol": data['symbol'],
            "timeframe": 60,
            "candles": extended_candles,
            "totalCandles": len(extended_candles),
            "extended": True,
            "base_file": base_file.name,
            "target_days": target_days,
            "created_at": datetime.now().isoformat()
        }
        
        # Save extended data
        output_file = self.output_dir / f"extended_{target_days}days_{data['symbol']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(extended_data, f, indent=2)
            
        print(f"✅ Extended dataset saved to: {output_file}")
        print(f"📊 Total candles: {len(extended_candles):,}")
        print(f"📅 Simulated {target_days} days of data")
        
        return output_file

def main():
    """Main function"""
    print("🎯 DATA EXTENDER FOR 30-DAY BACKTESTING")
    print("=" * 45)
    print("🔄 Extending existing data to 30 days for robust evaluation")
    print("=" * 45)
    
    extender = DataExtender()
    
    # Find the best base file
    data_files = list(extender.data_dir.glob("*.json"))
    if not data_files:
        print("❌ No data files found")
        return 1
        
    # Use the largest file as base
    largest_file = max(data_files, key=lambda f: f.stat().st_size)
    print(f"📁 Using {largest_file.name} as base for extension")
    
    # Create 30-day dataset
    extended_file = extender.create_30day_dataset(largest_file, target_days=30)
    if extended_file:
        print(f"\n✅ Successfully created 30-day dataset")
        print(f"📁 Output: {extended_file}")
        print(f"🚀 Ready for robust backtesting!")
        return 0
    
    print("❌ Failed to create extended dataset")
    return 1

if __name__ == "__main__":
    exit_code = main()
    exit(exit_code)
