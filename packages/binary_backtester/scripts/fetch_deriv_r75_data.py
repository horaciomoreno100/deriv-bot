#!/usr/bin/env python3
"""
Fetch 30 days of R_75 (Volatility Index 75) data from Deriv API
This script aggregates tick data into 1-minute OHLC candles
"""

import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional
import argparse

try:
    from deriv_api import DerivAPI
except ImportError:
    print("❌ Error: python-deriv-api not installed")
    print("   Run: pip install python-deriv-api")
    exit(1)


class DerivDataFetcher:
    """Fetch historical data from Deriv API and aggregate into candles"""

    def __init__(self, app_id: int = 1089):
        """
        Initialize Deriv data fetcher

        Args:
            app_id: Deriv API app ID (default: 1089 for demo)
        """
        self.app_id = app_id
        self.api = None
        self.data_dir = Path(__file__).parent.parent / "data"
        self.data_dir.mkdir(exist_ok=True)

    async def connect(self):
        """Connect to Deriv WebSocket API"""
        print("🔌 Connecting to Deriv API...")
        self.api = DerivAPI(app_id=self.app_id)
        print("✅ Connected to Deriv API")

    async def disconnect(self):
        """Disconnect from Deriv API"""
        if self.api:
            print("🔌 Disconnecting from Deriv API...")

    async def fetch_candles_history(
        self,
        symbol: str,
        granularity: int = 60,
        end_time: Optional[int] = None,
        count: int = 5000
    ) -> List[Dict]:
        """
        Fetch historical candle data from Deriv API using candles endpoint

        Args:
            symbol: Trading symbol (e.g., 'R_75', 'R_100')
            granularity: Candle timeframe in seconds (default: 60 for 1 minute)
            end_time: End timestamp (Unix epoch). If None, uses current time
            count: Number of candles to fetch (max 5000 per request)

        Returns:
            List of candle dictionaries with OHLC data
        """
        if end_time is None:
            end_time = int(datetime.now().timestamp())

        try:
            response = await self.api.ticks_history({
                "ticks_history": symbol,
                "style": "candles",
                "granularity": granularity,
                "end": end_time,
                "count": count
            })

            if 'error' in response:
                print(f"❌ API Error: {response['error'].get('message', 'Unknown error')}")
                return []

            if 'candles' not in response:
                print(f"⚠️  No candles data in response")
                return []

            candles = response['candles']

            # Convert API format to our format
            result = []
            for candle in candles:
                result.append({
                    'epoch': int(candle['epoch']),
                    'open': float(candle['open']),
                    'high': float(candle['high']),
                    'low': float(candle['low']),
                    'close': float(candle['close'])
                })

            return result

        except Exception as e:
            print(f"❌ Error fetching candles: {e}")
            return []

    async def fetch_all_candles(self, symbol: str, days: int = 30, granularity: int = 60) -> List[Dict]:
        """
        Fetch all candles for the specified time period
        Makes multiple API requests to get all data (5000 candles per request)

        Args:
            symbol: Trading symbol
            days: Number of days to fetch
            granularity: Candle timeframe in seconds

        Returns:
            List of all candles
        """
        print(f"📊 Fetching {days} days of {symbol} candles...")

        end_time = int(datetime.now().timestamp())
        start_time = int((datetime.now() - timedelta(days=days)).timestamp())

        print(f"⏱️  Timeframe: {granularity}s")
        print(f"📅 Start: {datetime.fromtimestamp(start_time).isoformat()}")
        print(f"📅 End: {datetime.fromtimestamp(end_time).isoformat()}")

        # Estimate number of requests needed
        # Calculate expected candles based on timeframe
        expected_candles = int((days * 86400) / granularity)
        estimated_requests = (expected_candles // 5000) + 1
        print(f"📈 Estimated {expected_candles:,} candles needed ({estimated_requests} requests)...")

        all_candles = []
        current_end = end_time
        request_count = 0

        while current_end > start_time:
            request_count += 1
            print(f"📡 Request {request_count}/{estimated_requests}... ", end='', flush=True)

            candles = await self.fetch_candles_history(symbol, granularity, current_end, 5000)

            if not candles:
                print("⚠️  No more data available")
                break

            print(f"✅ Fetched {len(candles)} candles")

            # Filter candles within our date range
            valid_candles = [c for c in candles if c['epoch'] >= start_time]
            all_candles.extend(valid_candles)

            # Get the oldest candle time for next request
            oldest_candle = min(candles, key=lambda c: c['epoch'])
            current_end = oldest_candle['epoch'] - granularity

            # Stop if we've gone past the start time
            if oldest_candle['epoch'] <= start_time:
                break

            # Small delay to avoid rate limiting
            await asyncio.sleep(0.1)

        # Sort candles by time (oldest first)
        all_candles.sort(key=lambda c: c['epoch'])

        print(f"✅ Total candles collected: {len(all_candles):,}")

        return all_candles

    def aggregate_ticks_to_candles(self, ticks: List[Dict], timeframe: int = 60) -> List[Dict]:
        """
        Aggregate tick data into OHLC candles

        Args:
            ticks: List of tick dictionaries with 'epoch' and 'quote'
            timeframe: Candle timeframe in seconds (default: 60 for 1 minute)

        Returns:
            List of OHLC candle dictionaries
        """
        print(f"🔄 Aggregating {len(ticks):,} ticks into {timeframe}s candles...")

        if not ticks:
            return []

        candles = {}

        for tick in ticks:
            # Calculate candle start time
            candle_time = (tick['epoch'] // timeframe) * timeframe
            price = tick['quote']

            if candle_time not in candles:
                # New candle
                candles[candle_time] = {
                    'epoch': candle_time,
                    'open': price,
                    'high': price,
                    'low': price,
                    'close': price
                }
            else:
                # Update existing candle
                candles[candle_time]['high'] = max(candles[candle_time]['high'], price)
                candles[candle_time]['low'] = min(candles[candle_time]['low'], price)
                candles[candle_time]['close'] = price

        # Convert to sorted list
        candle_list = sorted(candles.values(), key=lambda c: c['epoch'])

        print(f"✅ Created {len(candle_list):,} candles")

        return candle_list

    async def fetch_and_save(self, symbol: str, days: int = 30, timeframe: int = 60):
        """
        Fetch candle data directly from API and save to file

        Args:
            symbol: Trading symbol
            days: Number of days to fetch
            timeframe: Candle timeframe in seconds

        Returns:
            Path to saved file or None if failed
        """
        # Fetch all candles directly from API
        candles = await self.fetch_all_candles(symbol, days, timeframe)

        if not candles:
            print("❌ No candles fetched")
            return None

        # Save to file
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"deriv_candles_{symbol}_{timestamp}.json"
        filepath = self.data_dir / filename

        with open(filepath, 'w') as f:
            json.dump(candles, f, indent=2)

        print(f"💾 Saved {len(candles):,} candles to: {filepath}")

        # Print statistics
        start_date = datetime.fromtimestamp(candles[0]['epoch'])
        end_date = datetime.fromtimestamp(candles[-1]['epoch'])
        duration_days = (end_date - start_date).total_seconds() / 86400

        print("\n📊 Data Statistics:")
        print(f"   Symbol: {symbol}")
        print(f"   Candles: {len(candles):,}")
        print(f"   Start: {start_date.isoformat()}")
        print(f"   End: {end_date.isoformat()}")
        print(f"   Duration: {duration_days:.2f} days")
        print(f"   Expected trades: {int(duration_days * 5)}-{int(duration_days * 10)} (at 5-10/day)")

        return filepath


async def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Fetch historical data from Deriv API and aggregate to candles'
    )
    parser.add_argument(
        '--symbol',
        type=str,
        default='R_75',
        help='Trading symbol (default: R_75)'
    )
    parser.add_argument(
        '--days',
        type=int,
        default=30,
        help='Number of days to fetch (default: 30)'
    )
    parser.add_argument(
        '--timeframe',
        type=int,
        default=60,
        help='Candle timeframe in seconds (default: 60 for 1 minute)'
    )
    parser.add_argument(
        '--app-id',
        type=int,
        default=1089,
        help='Deriv API app ID (default: 1089)'
    )

    args = parser.parse_args()

    print("🎯 DERIV DATA FETCHER")
    print("=" * 60)
    print(f"📊 Symbol: {args.symbol}")
    print(f"📅 Days: {args.days}")
    print(f"⏱️  Timeframe: {args.timeframe}s")
    print("=" * 60)

    fetcher = DerivDataFetcher(app_id=args.app_id)

    try:
        await fetcher.connect()
        filepath = await fetcher.fetch_and_save(args.symbol, args.days, args.timeframe)

        if filepath:
            print("\n✅ DATA FETCH COMPLETED!")
            print("=" * 60)
            print(f"📁 File: {filepath}")
            print("\n🚀 Next steps:")
            print("   1. Run backtest: python quick_test_balanced.py")
            print("   2. Check NEXT_STEPS.md for optimization guide")
            return 0
        else:
            print("\n❌ DATA FETCH FAILED")
            return 1

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        await fetcher.disconnect()


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
