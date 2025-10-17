"""
Binary Trade Manager for simulating binary options contracts
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import pandas as pd

@dataclass
class BinaryContract:
    """Represents a binary options contract"""
    id: str
    direction: str  # 'CALL' or 'PUT'
    entry_price: float
    entry_time: datetime
    expiration_time: datetime
    stake: float
    payout_rate: float
    status: str = 'open'  # 'open', 'won', 'lost'
    result_price: Optional[float] = None
    profit: Optional[float] = None

class BinaryTradeManager:
    """
    Manages binary options contracts and evaluates their outcomes
    """
    
    def __init__(self, payout_rate: float = 0.8):
        self.payout_rate = payout_rate
        self.contracts: Dict[str, BinaryContract] = {}
        self.completed_contracts: List[BinaryContract] = []
        self.contract_counter = 0
    
    def create_contract(self, 
                      direction: str, 
                      entry_price: float, 
                      entry_time: datetime,
                      expiration_time: datetime,
                      stake: float) -> BinaryContract:
        """
        Create a new binary contract
        """
        contract_id = f"contract_{self.contract_counter}"
        self.contract_counter += 1
        
        contract = BinaryContract(
            id=contract_id,
            direction=direction,
            entry_price=entry_price,
            entry_time=entry_time,
            expiration_time=expiration_time,
            stake=stake,
            payout_rate=self.payout_rate
        )
        
        self.contracts[contract_id] = contract
        return contract
    
    def evaluate_contract(self, contract_id: str, current_price: float) -> Optional[BinaryContract]:
        """
        Evaluate a contract if it has expired
        """
        if contract_id not in self.contracts:
            return None
        
        contract = self.contracts[contract_id]
        
        # Check if contract has expired
        if contract.status != 'open':
            return None
        
        # Determine if contract won or lost
        won = self._check_contract_result(contract, current_price)
        
        # Calculate profit/loss
        if won:
            profit = contract.stake * contract.payout_rate
            contract.status = 'won'
        else:
            profit = -contract.stake
            contract.status = 'lost'
        
        contract.result_price = current_price
        contract.profit = profit
        
        # Move to completed contracts
        self.completed_contracts.append(contract)
        del self.contracts[contract_id]
        
        return contract
    
    def _check_contract_result(self, contract: BinaryContract, current_price: float) -> bool:
        """
        Check if a contract won or lost based on direction and price
        """
        if contract.direction == 'CALL':
            return current_price > contract.entry_price
        elif contract.direction == 'PUT':
            return current_price < contract.entry_price
        else:
            raise ValueError(f"Invalid direction: {contract.direction}")
    
    def get_active_contracts(self) -> List[BinaryContract]:
        """Get all active contracts"""
        return list(self.contracts.values())
    
    def get_completed_contracts(self) -> List[BinaryContract]:
        """Get all completed contracts"""
        return self.completed_contracts
    
    def get_total_profit(self) -> float:
        """Calculate total profit from all completed contracts"""
        return sum(contract.profit for contract in self.completed_contracts if contract.profit is not None)
    
    def get_win_rate(self) -> float:
        """Calculate win rate"""
        if not self.completed_contracts:
            return 0.0
        
        won_contracts = sum(1 for contract in self.completed_contracts if contract.status == 'won')
        return won_contracts / len(self.completed_contracts)
    
    def get_statistics(self) -> Dict:
        """Get trading statistics"""
        completed = self.completed_contracts
        
        if not completed:
            return {
                'total_contracts': 0,
                'won_contracts': 0,
                'lost_contracts': 0,
                'win_rate': 0.0,
                'total_profit': 0.0,
                'average_profit': 0.0,
                'largest_win': 0.0,
                'largest_loss': 0.0
            }
        
        won_contracts = [c for c in completed if c.status == 'won']
        lost_contracts = [c for c in completed if c.status == 'lost']
        
        profits = [c.profit for c in completed if c.profit is not None]
        
        return {
            'total_contracts': len(completed),
            'won_contracts': len(won_contracts),
            'lost_contracts': len(lost_contracts),
            'win_rate': self.get_win_rate(),
            'total_profit': self.get_total_profit(),
            'average_profit': sum(profits) / len(profits) if profits else 0.0,
            'largest_win': max(profits) if profits else 0.0,
            'largest_loss': min(profits) if profits else 0.0
        }
