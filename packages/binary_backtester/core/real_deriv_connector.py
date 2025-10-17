"""
Real Deriv API connector for binary options backtester MVP
Uses the same connection method as the existing Deriv bot
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import json
import os
import websocket
import threading
import time

class RealDerivConnector:
    """
    Real Deriv API connector using WebSocket
    Based on the existing Deriv bot implementation
    """
    
    def __init__(self, app_id: str = "106646", token: str = "7He7yWbKh3vgmEY"):
        self.app_id = app_id
        self.token = token
        self.ws = None
        self.is_connected = False
        self.is_authorized = False
        self.balance = 0
        self.login_id = ""
        self.data_path = "data"
        self.ensure_data_directory()
        
    def ensure_data_directory(self):
        """Create data directory if it doesn't exist"""
        if not os.path.exists(self.data_path):
            os.makedirs(self.data_path)
    
    def connect(self) -> bool:
        """
        Connect to Deriv API using WebSocket
        """
        try:
            ws_url = f"wss://ws.derivws.com/websockets/v3?app_id={self.app_id}"
            print(f"🔌 Conectando a Deriv API: {ws_url}")
            
            self.ws = websocket.WebSocketApp(
                ws_url,
                on_open=self._on_open,
                on_message=self._on_message,
                on_error=self._on_error,
                on_close=self._on_close
            )
            
            # Run WebSocket in a separate thread
            wst = threading.Thread(target=self.ws.run_forever)
            wst.daemon = True
            wst.start()
            
            # Wait for connection
            timeout = 10
            start_time = time.time()
            while not self.is_connected and (time.time() - start_time) < timeout:
                time.sleep(0.1)
            
            if not self.is_connected:
                print("❌ Timeout conectando a Deriv API")
                return False
            
            # Wait for authorization
            start_time = time.time()
            while not self.is_authorized and (time.time() - start_time) < timeout:
                time.sleep(0.1)
            
            if not self.is_authorized:
                print("❌ Timeout en autorización")
                return False
            
            print("✅ Conectado y autorizado en Deriv API")
            return True
            
        except Exception as e:
            print(f"❌ Error conectando a Deriv API: {e}")
            return False
    
    def _on_open(self, ws):
        """WebSocket opened"""
        print("✅ WebSocket abierto")
        self.is_connected = True
        self._authorize()
    
    def _on_message(self, ws, message):
        """Handle WebSocket messages"""
        try:
            response = json.loads(message)
            
            if 'authorize' in response:
                if 'error' in response['authorize']:
                    print(f"❌ Error de autorización: {response['authorize']['error']}")
                else:
                    print("🎉 Autorización exitosa!")
                    self.is_authorized = True
                    self.balance = float(response['authorize']['balance'])
                    self.login_id = response['authorize']['loginid']
                    print(f"👤 Usuario: {self.login_id}")
                    print(f"💰 Balance: ${self.balance}")
            
            elif 'candles' in response:
                self._handle_candles(response)
            
            elif 'error' in response:
                print(f"❌ Error: {response['error']}")
                
        except Exception as e:
            print(f"❌ Error procesando mensaje: {e}")
    
    def _on_error(self, ws, error):
        """WebSocket error"""
        print(f"❌ Error WebSocket: {error}")
    
    def _on_close(self, ws, close_status_code, close_msg):
        """WebSocket closed"""
        print("🔌 WebSocket cerrado")
        self.is_connected = False
        self.is_authorized = False
    
    def _authorize(self):
        """Send authorization request"""
        if not self.ws:
            return
        
        auth_message = {
            "authorize": self.token
        }
        
        print("🔐 Enviando autorización...")
        self.ws.send(json.dumps(auth_message))
    
    def _handle_candles(self, response):
        """Handle candles data"""
        if 'candles' in response and response['candles']:
            candles = response['candles']
            print(f"📊 Recibidos {len(candles)} candles")
            # Store candles for later use
            self._store_candles(candles)
    
    def _store_candles(self, candles):
        """Store candles to file"""
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"deriv_candles_{timestamp}.json"
            filepath = os.path.join(self.data_path, filename)
            
            with open(filepath, 'w') as f:
                json.dump(candles, f, indent=2)
            
            print(f"💾 Candles guardados en: {filepath}")
            
        except Exception as e:
            print(f"⚠️  Error guardando candles: {e}")
    
    def get_historical_data(self, symbol: str, count: int = 1000) -> Optional[List[Dict]]:
        """
        Get historical data from Deriv API
        """
        if not self.is_authorized:
            print("❌ No autorizado para obtener datos históricos")
            return None
        
        try:
            # Request historical data
            message = {
                "ticks_history": symbol,
                "adjust_start_time": 1,
                "count": count,
                "end": "latest",
                "start": 1,
                "style": "candles",
                "granularity": 60  # 1 minute
            }
            
            print(f"📊 Solicitando {count} candles para {symbol}...")
            self.ws.send(json.dumps(message))
            
            # Wait for response (simplified - in production would use proper async handling)
            time.sleep(2)
            
            return None  # Would return actual data in production
            
        except Exception as e:
            print(f"❌ Error obteniendo datos históricos: {e}")
            return None
    
    def disconnect(self):
        """Disconnect from Deriv API"""
        if self.ws:
            self.ws.close()
            self.is_connected = False
            self.is_authorized = False
            print("🔌 Desconectado de Deriv API")
    
    def is_connected_to_api(self) -> bool:
        """Check if connected and authorized"""
        return self.is_connected and self.is_authorized
