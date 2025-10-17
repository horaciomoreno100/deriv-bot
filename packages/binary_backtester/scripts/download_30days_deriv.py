#!/usr/bin/env python3
"""
Download 30 days of Deriv data using official Python API
"""

import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from deriv_api import DerivAPI

class DerivDataDownloader:
    """Download historical data from Deriv API"""
    
    def __init__(self, app_id=1089):
        self.app_id = app_id
        self.api = None
        self.data_dir = Path(__file__).parent.parent / "data"
        self.data_dir.mkdir(exist_ok=True)
        
    async def connect(self):
        """Connect to Deriv API"""
        print("🔌 Connecting to Deriv API...")
        self.api = DerivAPI(app_id=self.app_id)
        await self.api.connect()
        print("✅ Connected to Deriv API")
        
    async def disconnect(self):
        """Disconnect from Deriv API"""
        if self.api:
            await self.api.disconnect()
            print("🔌 Disconnected from Deriv API")
            
    async def get_historical_data(self, symbol, days=30):
        """Get historical data for a symbol"""
        print(f"📊 Downloading {days} days of data for {symbol}...")
        
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        try:
            # Get historical candles
            response = await self.api.ticks_history(
                ticks_history=symbol,
                end=end_date.timestamp(),
                start=start_date.timestamp(),
                granularity=60,  # 1 minute candles
                count=1000  # Maximum per request
            )
            
            if 'error' in response:
                print(f"❌ Error: {response['error']}")
                return None
                
            candles = response.get('candles', [])
            print(f"✅ Fetched {len(candles)} candles")
            print(f"   Period: {start_date.isoformat()} to {end_date.isoformat()}")
            
            # Save data
            filename = f"{symbol}_60s_{days}days_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = self.data_dir / filename
            
            data = {
                "symbol": symbol,
                "timeframe": 60,
                "days": days,
                "candles": candles,
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
                "totalCandles": len(candles),
                "downloaded_at": datetime.now().isoformat()
            }
            
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
                
            print(f"💾 Saved to: {filepath}")
            return {
                "filename": filename,
                "candles": len(candles),
                "period": f"{start_date.isoformat()} to {end_date.isoformat()}"
            }
            
        except Exception as e:
            print(f"❌ Error fetching data for {symbol}: {e}")
            return None
            
    async def download_multiple_symbols(self, symbols, days=30):
        """Download data for multiple symbols"""
        results = []
        
        for symbol in symbols:
            print(f"\n📊 Downloading {symbol}...")
            result = await self.get_historical_data(symbol, days)
            if result:
                results.append(result)
                print(f"✅ {symbol}: {result['candles']} candles downloaded")
            else:
                print(f"❌ Failed to download {symbol}")
                
        return results

async def main():
    """Main function"""
    print("🎯 DERIV 30-DAY DATA DOWNLOADER (Python API)")
    print("=" * 50)
    
    downloader = DerivDataDownloader()
    
    try:
        # Connect
        await downloader.connect()
        
        # Download data for different symbols
        symbols = [
            "R_100",      # Volatility 100
            "R_75",       # Volatility 75  
            "frxXAUUSD",  # Gold
            "frxEURUSD",  # EUR/USD
            "frxGBPUSD",  # GBP/USD
        ]
        
        results = await downloader.download_multiple_symbols(symbols, days=30)
        
        print("\n🎯 DOWNLOAD COMPLETED!")
        print("=" * 30)
        print(f"✅ Downloaded data for {len(results)} symbols")
        print("✅ 30 days of data for robust backtesting")
        print("✅ Ready for Python backtester")
        print("\n📁 Files saved in:", downloader.data_dir)
        
        # Show summary
        total_candles = sum(r['candles'] for r in results)
        print(f"\n📊 Total candles downloaded: {total_candles:,}")
        print("🚀 Run: python examples/test_optimized_reversal_hunter.py")
        
    except Exception as e:
        print(f"❌ Download failed: {e}")
        return 1
    finally:
        await downloader.disconnect()
        
    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
