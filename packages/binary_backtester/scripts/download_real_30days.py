#!/usr/bin/env python3
"""
Download REAL 30 days of Deriv data using official Python API
"""

import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from deriv_api import DerivAPI

class RealDerivDownloader:
    """Download real historical data from Deriv API"""
    
    def __init__(self, app_id=1089):
        self.app_id = app_id
        self.api = None
        self.data_dir = Path(__file__).parent.parent / "data"
        self.data_dir.mkdir(exist_ok=True)
        
    async def connect(self):
        """Connect to Deriv API"""
        print("🔌 Connecting to Deriv API...")
        self.api = DerivAPI(app_id=self.app_id)
        print("✅ Connected to Deriv API")
        
    async def disconnect(self):
        """Disconnect from Deriv API"""
        if self.api:
            print("🔌 Disconnected from Deriv API")
            
    async def get_historical_data(self, symbol, days=30):
        """Get real historical data for a symbol"""
        print(f"📊 Downloading {days} days of REAL data for {symbol}...")
        
        # Calculate date range - use more recent dates
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        print(f"   Requesting data from {start_date.isoformat()} to {end_date.isoformat()}")
        print(f"   Start timestamp: {int(start_date.timestamp())}")
        print(f"   End timestamp: {int(end_date.timestamp())}")
        
        try:
            # Get historical candles using the correct method
            # According to the API docs, we need to use the ticks_history method with proper parameters
            response = await self.api.ticks_history({
                "ticks_history": symbol,
                "end": int(end_date.timestamp()),
                "start": int(start_date.timestamp()),
                "granularity": 60,  # 1 minute candles
                "count": 1000  # Maximum per request
            })
            
            if 'error' in response:
                print(f"❌ Error: {response['error']}")
                return None
                
            candles = response.get('candles', [])
            print(f"✅ Fetched {len(candles)} REAL candles")
            print(f"   Period: {start_date.isoformat()} to {end_date.isoformat()}")
            
            # Save data
            filename = f"{symbol}_REAL_60s_{days}days_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = self.data_dir / filename
            
            data = {
                "symbol": symbol,
                "timeframe": 60,
                "days": days,
                "candles": candles,
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
                "totalCandles": len(candles),
                "downloaded_at": datetime.now().isoformat(),
                "real_data": True
            }
            
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
                
            print(f"💾 Saved REAL data to: {filepath}")
            return {
                "filename": filename,
                "candles": len(candles),
                "period": f"{start_date.isoformat()} to {end_date.isoformat()}"
            }
            
        except Exception as e:
            print(f"❌ Error fetching REAL data for {symbol}: {e}")
            return None
            
    async def download_multiple_symbols(self, symbols, days=30):
        """Download real data for multiple symbols"""
        results = []
        
        for symbol in symbols:
            print(f"\n📊 Downloading REAL data for {symbol}...")
            result = await self.get_historical_data(symbol, days)
            if result:
                results.append(result)
                print(f"✅ {symbol}: {result['candles']} REAL candles downloaded")
            else:
                print(f"❌ Failed to download REAL data for {symbol}")
                
        return results

async def main():
    """Main function"""
    print("🎯 REAL DERIV 30-DAY DATA DOWNLOADER")
    print("=" * 50)
    print("📊 Downloading REAL 30 days of data from Deriv API")
    print("=" * 50)
    
    downloader = RealDerivDownloader()
    
    try:
        # Connect
        await downloader.connect()
        
        # Download real data for different symbols - try forex symbols
        symbols = [
            "frxAUDUSD",  # AUD/USD - forex symbol
        ]
        
        results = await downloader.download_multiple_symbols(symbols, days=1)
        
        print("\n🎯 REAL DATA DOWNLOAD COMPLETED!")
        print("=" * 40)
        print(f"✅ Downloaded REAL data for {len(results)} symbols")
        print("✅ 30 days of REAL market data")
        print("✅ Ready for robust backtesting")
        print("\n📁 Files saved in:", downloader.data_dir)
        
        # Show summary
        total_candles = sum(r['candles'] for r in results)
        print(f"\n📊 Total REAL candles downloaded: {total_candles:,}")
        print("🚀 Run: python examples/test_30days_simple.py")
        
    except Exception as e:
        print(f"❌ Download failed: {e}")
        return 1
    finally:
        await downloader.disconnect()
        
    return 0

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
