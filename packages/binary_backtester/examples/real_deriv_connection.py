"""
Real Deriv API connection example for binary options backtester MVP
"""

import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.real_deriv_connector import RealDerivConnector
from datetime import datetime, timedelta
import time

def test_deriv_connection():
    """
    Test real connection to Deriv API
    """
    print("🔌 TESTING REAL DERIV API CONNECTION")
    print("=" * 50)
    
    # Initialize connector with real credentials
    connector = RealDerivConnector(
        app_id="106646",  # Real Deriv app ID
        token="7He7yWbKh3vgmEY"  # Real Deriv token
    )
    
    print("⚙️ Configuration:")
    print(f"   App ID: {connector.app_id}")
    print(f"   Token: {connector.token[:10]}...")
    print("-" * 50)
    
    # Test connection
    print("🚀 Testing connection to Deriv API...")
    if connector.connect():
        print("✅ Successfully connected to Deriv API!")
        print(f"   Login ID: {connector.login_id}")
        print(f"   Balance: ${connector.balance}")
        
        # Test getting historical data
        print("\n📊 Testing historical data request...")
        symbol = "frxXAUUSD"
        count = 100
        
        print(f"   Requesting {count} candles for {symbol}...")
        connector.get_historical_data(symbol, count)
        
        # Wait a bit for data
        print("   Waiting for data...")
        time.sleep(3)
        
        print("✅ Historical data request sent!")
        
    else:
        print("❌ Failed to connect to Deriv API")
        print("💡 Check your credentials and network connection")
    
    # Disconnect
    print("\n🔌 Disconnecting...")
    connector.disconnect()
    
    print("=" * 50)
    print("🎯 Connection test completed!")

def main():
    """
    Main function to test Deriv connection
    """
    try:
        test_deriv_connection()
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
