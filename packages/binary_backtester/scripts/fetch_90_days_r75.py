#!/usr/bin/env python3
"""
Fetch 90 days of R_75 1-minute candles from Deriv API
For ML training dataset
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from data_fetcher.deriv_fetcher import DerivDataFetcher


async def fetch_90_days():
    """Fetch 90 days of R_75 data"""
    print("🚀 Fetching 90 days of R_75 1m candles for ML training")
    print("=" * 70)

    # Initialize fetcher
    fetcher = DerivDataFetcher()

    try:
        # Calculate date range (90 days ago to now)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=90)

        print(f"📅 Date range: {start_date.date()} to {end_date.date()}")
        print(f"📊 Symbol: R_75 (Volatility 75 Index)")
        print(f"⏱️  Timeframe: 1 minute (60s)")
        print(f"📈 Expected candles: ~{90 * 24 * 60} (129,600)")
        print()

        # Fetch data
        print("🔄 Fetching data from Deriv API...")
        candles = await fetcher.fetch_candles(
            symbol='R_75',
            timeframe='60s',  # 1 minute
            days=90,
            granularity=60
        )

        if not candles:
            print("❌ No data received from API")
            return None

        print(f"✅ Fetched {len(candles)} candles")

        # Validate data
        print("\n🔍 Validating data...")

        # Check for gaps
        if len(candles) > 1:
            timestamps = [c['time'] for c in candles]
            gaps = []
            for i in range(1, len(timestamps)):
                diff = timestamps[i] - timestamps[i-1]
                if diff > 120:  # More than 2 minutes gap
                    gaps.append({
                        'index': i,
                        'gap_seconds': diff,
                        'from': datetime.fromtimestamp(timestamps[i-1]),
                        'to': datetime.fromtimestamp(timestamps[i])
                    })

            if gaps:
                print(f"⚠️  Found {len(gaps)} gaps in data:")
                for gap in gaps[:5]:  # Show first 5
                    print(f"   Gap at index {gap['index']}: {gap['gap_seconds']}s "
                          f"({gap['from']} to {gap['to']})")
                if len(gaps) > 5:
                    print(f"   ... and {len(gaps) - 5} more gaps")
            else:
                print("✅ No significant gaps found")

        # Check for missing OHLC
        missing_count = 0
        for i, c in enumerate(candles):
            if not all(k in c for k in ['open', 'high', 'low', 'close']):
                missing_count += 1

        if missing_count > 0:
            print(f"⚠️  {missing_count} candles with missing OHLC data")
        else:
            print("✅ All candles have complete OHLC data")

        # Data summary
        print("\n📊 Data Summary:")
        print(f"   Total candles: {len(candles)}")
        print(f"   Date range: {datetime.fromtimestamp(candles[0]['time'])} to "
              f"{datetime.fromtimestamp(candles[-1]['time'])}")
        print(f"   Duration: {(candles[-1]['time'] - candles[0]['time']) / (24*3600):.1f} days")

        # Price range
        all_prices = []
        for c in candles:
            all_prices.extend([c['open'], c['high'], c['low'], c['close']])
        print(f"   Price range: {min(all_prices):.2f} - {max(all_prices):.2f}")

        # Save to file
        output_dir = Path(__file__).parent.parent / 'data'
        output_dir.mkdir(exist_ok=True)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = output_dir / f'ml_dataset_R75_90days_{timestamp}.json'

        # Prepare data structure
        data = {
            'symbol': 'R_75',
            'timeframe': '60s',
            'granularity': 60,
            'days': 90,
            'fetched_at': datetime.now().isoformat(),
            'candles': candles,
            'metadata': {
                'total_candles': len(candles),
                'start_date': datetime.fromtimestamp(candles[0]['time']).isoformat(),
                'end_date': datetime.fromtimestamp(candles[-1]['time']).isoformat(),
                'duration_days': (candles[-1]['time'] - candles[0]['time']) / (24*3600),
                'gaps_found': len(gaps) if 'gaps' in locals() else 0,
                'missing_ohlc': missing_count
            }
        }

        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)

        print(f"\n💾 Data saved to: {output_file.name}")
        print(f"   File size: {output_file.stat().st_size / 1024 / 1024:.2f} MB")

        print("\n✅ Data fetch complete!")
        return str(output_file)

    except Exception as e:
        print(f"❌ Error fetching data: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        await fetcher.close()


if __name__ == '__main__':
    result = asyncio.run(fetch_90_days())
    if result:
        print(f"\n🎯 Next step: Run feature engineering on {result}")
        sys.exit(0)
    else:
        print("\n❌ Data fetch failed")
        sys.exit(1)
