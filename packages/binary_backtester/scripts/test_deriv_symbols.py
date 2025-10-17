#!/usr/bin/env python3
"""
Test Deriv API to see available symbols and methods
"""

import asyncio
from deriv_api import DerivAPI

async def test_deriv_symbols():
    """Test Deriv API to see what's available"""
    print("🧪 Testing Deriv API - Available Symbols")
    print("=" * 50)
    
    try:
        # Create API instance
        api = DerivAPI(app_id=1089)
        print("✅ API instance created")
        
        # Test connection
        print("🔌 Testing connection...")
        response = await api.ping({'ping': 1})
        print(f"✅ Ping response: {response}")
        
        # Get active symbols
        print("\n📊 Getting active symbols...")
        try:
            symbols = await api.active_symbols({"active_symbols": "full"})
            print(f"✅ Got active symbols response: {type(symbols)}")
            if isinstance(symbols, dict) and 'active_symbols' in symbols:
                symbol_list = symbols['active_symbols']
                print(f"✅ Found {len(symbol_list)} active symbols")
                
                # Show some symbols
                for i, symbol in enumerate(symbol_list[:10]):
                    print(f"   {i+1}. {symbol.get('symbol', 'N/A')}: {symbol.get('display_name', 'N/A')}")
                    
                # Look for volatility symbols
                vol_symbols = [s for s in symbol_list if 'R_' in s.get('symbol', '')]
                print(f"\n📈 Volatility symbols found: {len(vol_symbols)}")
                for symbol in vol_symbols[:5]:
                    print(f"   - {symbol.get('symbol')}: {symbol.get('display_name')}")
                    
            else:
                print(f"❌ Unexpected symbols format: {symbols}")
                
        except Exception as e:
            print(f"❌ Error getting active symbols: {e}")
        
        # Test ticks_history method
        print("\n📈 Testing ticks_history method...")
        try:
            # Try with a simple request
            hist_response = await api.ticks_history({
                "ticks_history": "R_100",
                "count": 10
            })
            print(f"✅ Ticks history response: {hist_response}")
        except Exception as e:
            print(f"❌ Ticks history error: {e}")
            
        # Test other methods
        print("\n🔍 Testing other available methods...")
        try:
            # Try to get asset index
            assets = await api.asset_index({"asset_index": 1})
            print(f"✅ Asset index: {type(assets)}")
        except Exception as e:
            print(f"❌ Asset index error: {e}")
            
        print("\n✅ Deriv API test completed!")
        
    except Exception as e:
        print(f"❌ API test failed: {e}")
        return False
        
    return True

if __name__ == "__main__":
    success = asyncio.run(test_deriv_symbols())
    exit(0 if success else 1)
