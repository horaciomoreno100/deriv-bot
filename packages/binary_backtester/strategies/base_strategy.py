"""
Base strategy class for binary options
"""

import backtrader as bt
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

class BaseBinaryStrategy(bt.Strategy):
    """
    Base strategy class for binary options trading
    """
    
    params = (
        ('symbol', 'frxXAUUSD'),
        ('expiration_time', 1),  # minutes
        ('stake_amount', 10.0),
        ('payout_rate', 0.8),
    )
    
    def __init__(self):
        # Initialize indicators and state
        self.binary_contracts = {}
        self.contract_counter = 0
        self.last_signal_time = None
        self.cooldown_seconds = 60  # 1 minute cooldown between trades
        
        # Track results
        self.total_trades = 0
        self.won_trades = 0
        self.lost_trades = 0
        self.total_profit = 0.0
    
    def next(self):
        """
        Main strategy logic - override in subclasses
        """
        # Check for expired contracts
        self._check_expired_contracts()
        
        # Check cooldown
        if self._is_in_cooldown():
            return
        
        # Generate signal (override in subclasses)
        signal = self.generate_signal()
        
        if signal:
            self._execute_binary_trade(signal)
    
    def generate_signal(self) -> Optional[str]:
        """
        Generate trading signal - override in subclasses
        Returns: 'CALL', 'PUT', or None
        """
        raise NotImplementedError("Subclasses must implement generate_signal()")
    
    def _execute_binary_trade(self, direction: str):
        """
        Execute a binary options trade
        """
        current_price = self.data.close[0]
        current_time = self.datetime.datetime()
        expiration_time = current_time + timedelta(minutes=self.params.expiration_time)
        
        # Create contract
        contract_id = f"contract_{self.contract_counter}"
        self.contract_counter += 1
        
        contract = {
            'id': contract_id,
            'direction': direction,
            'entry_price': current_price,
            'entry_time': current_time,
            'expiration_time': expiration_time,
            'stake': self.params.stake_amount,
            'payout_rate': self.params.payout_rate,
            'status': 'open'
        }
        
        self.binary_contracts[contract_id] = contract
        self.last_signal_time = current_time
        self.total_trades += 1
        
        print(f"📊 {direction} contract created at {current_price:.2f}, expires at {expiration_time}")
    
    def _check_expired_contracts(self):
        """
        Check for expired contracts and evaluate results
        """
        current_time = self.datetime.datetime()
        current_price = self.data.close[0]
        
        expired_contracts = []
        
        for contract_id, contract in self.binary_contracts.items():
            if contract['status'] == 'open' and current_time >= contract['expiration_time']:
                # Contract has expired, evaluate result
                result = self._evaluate_contract(contract, current_price)
                expired_contracts.append(contract_id)
                
                # Update statistics
                if result['won']:
                    self.won_trades += 1
                    profit = contract['stake'] * contract['payout_rate']
                else:
                    self.lost_trades += 1
                    profit = -contract['stake']
                
                self.total_profit += profit
                
                # Update broker cash
                self.broker.set_cash(self.broker.get_cash() + profit)
                
                print(f"🎯 Contract {contract_id}: {'WON' if result['won'] else 'LOST'} - Profit: {profit:.2f}")
        
        # Remove expired contracts
        for contract_id in expired_contracts:
            del self.binary_contracts[contract_id]
    
    def _evaluate_contract(self, contract: Dict, current_price: float) -> Dict[str, Any]:
        """
        Evaluate if a contract won or lost
        """
        direction = contract['direction']
        entry_price = contract['entry_price']
        
        if direction == 'CALL':
            won = current_price > entry_price
        elif direction == 'PUT':
            won = current_price < entry_price
        else:
            raise ValueError(f"Invalid direction: {direction}")
        
        return {
            'won': won,
            'entry_price': entry_price,
            'exit_price': current_price,
            'direction': direction
        }
    
    def _is_in_cooldown(self) -> bool:
        """
        Check if we're in cooldown period
        """
        if self.last_signal_time is None:
            return False
        
        current_time = self.datetime.datetime()
        time_diff = (current_time - self.last_signal_time).total_seconds()
        
        return time_diff < self.cooldown_seconds
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        Get trading statistics
        """
        win_rate = self.won_trades / self.total_trades if self.total_trades > 0 else 0.0
        
        return {
            'total_trades': self.total_trades,
            'won_trades': self.won_trades,
            'lost_trades': self.lost_trades,
            'win_rate': win_rate,
            'total_profit': self.total_profit,
            'active_contracts': len(self.binary_contracts)
        }
    
    def stop(self):
        """
        Called when strategy stops
        """
        stats = self.get_statistics()
        print("\n" + "="*50)
        print("📊 STRATEGY RESULTS")
        print("="*50)
        print(f"Total Trades: {stats['total_trades']}")
        print(f"Won Trades: {stats['won_trades']}")
        print(f"Lost Trades: {stats['lost_trades']}")
        print(f"Win Rate: {stats['win_rate']:.2%}")
        print(f"Total Profit: {stats['total_profit']:.2f}")
        print(f"Final Balance: {self.broker.get_cash():.2f}")
        print("="*50)
