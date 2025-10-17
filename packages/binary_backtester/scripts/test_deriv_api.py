#!/usr/bin/env python3
"""
Test Deriv API connection and basic functionality
"""

import asyncio
from deriv_api import DerivAPI

async def test_deriv_api():
    """Test basic Deriv API functionality"""
    print("🧪 Testing Deriv API...")
    
    try:
        # Create API instance
        api = DerivAPI(app_id=1089)
        print("✅ API instance created")
        
        # Test connection
        print("🔌 Testing connection...")
        response = await api.ping({'ping': 1})
        print(f"✅ Ping response: {response}")
        
        # Test getting active symbols
        print("📊 Getting active symbols...")
        symbols = await api.get_active_symbols()
        print(f"✅ Got {len(symbols)} symbols")
        
        # Show some symbols
        for i, symbol in enumerate(symbols[:5]):
            print(f"   {i+1}. {symbol.get('symbol', 'N/A')}: {symbol.get('display_name', 'N/A')}")
        
        # Test getting historical data
        print("\n📈 Testing historical data...")
        try:
            # Try to get some historical data for R_100
            hist_response = await api.ticks_history(
                ticks_history='R_100',
                end=1734567890,  # Some timestamp
                start=1734567890 - 3600,  # 1 hour before
                granularity=60,
                count=10
            )
            print(f"✅ Historical data response: {hist_response}")
        except Exception as e:
            print(f"❌ Historical data error: {e}")
        
        print("\n✅ Deriv API test completed successfully!")
        
    except Exception as e:
        print(f"❌ API test failed: {e}")
        return False
        
    return True

if __name__ == "__main__":
    success = asyncio.run(test_deriv_api())
    exit(0 if success else 1)
