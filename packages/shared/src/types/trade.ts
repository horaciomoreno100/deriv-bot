/**
 * Trading types
 */

/**
 * Contract direction
 */
export type ContractDirection = 'CALL' | 'PUT';

/**
 * Contract status
 */
export type ContractStatus = 'open' | 'won' | 'lost';

/**
 * Duration unit
 */
export type DurationUnit = 's' | 'm' | 'h' | 'd';

/**
 * Contract proposal (price quote)
 */
export interface Proposal {
  /** Proposal ID (used to buy contract) */
  id: string;
  /** Asset symbol */
  symbol: string;
  /** Contract type */
  contractType: ContractDirection;
  /** Stake amount */
  stake: number;
  /** Expected payout if win */
  payout: number;
  /** Entry spot price */
  spot: number;
  /** Spot timestamp */
  spotTime: number;
  /** Duration */
  duration: number;
  /** Duration unit */
  durationUnit: DurationUnit;
}

/**
 * Open contract (position)
 */
export interface Contract {
  /** Unique contract ID */
  id: string;
  /** Asset symbol */
  symbol: string;
  /** Contract direction */
  direction: ContractDirection;
  /** Stake amount */
  stake: number;
  /** Expected payout */
  payout: number;
  /** Entry price */
  entryPrice: number;
  /** Entry timestamp */
  entryTime: number;
  /** Exit price (when closed) */
  exitPrice?: number;
  /** Exit timestamp (when closed) */
  exitTime?: number;
  /** Current price */
  currentPrice?: number;
  /** Status */
  status: ContractStatus;
  /** Profit/loss (when closed) */
  profit?: number;
  /** Duration in seconds */
  duration: number;
  /** Strategy that generated this contract */
  strategyName?: string;
}

/**
 * Trade execution request
 */
export interface TradeRequest {
  /** Asset symbol */
  symbol: string;
  /** Direction */
  direction: ContractDirection;
  /** Stake amount */
  amount: number;
  /** Duration */
  duration: number;
  /** Duration unit */
  durationUnit: DurationUnit;
  /** Strategy that generated this trade */
  strategyName?: string;
}

/**
 * Trade result
 */
export interface TradeResult {
  /** Contract ID */
  contractId: string;
  /** Asset symbol */
  symbol?: string;
  /** Direction */
  direction?: ContractDirection;
  /** Status */
  status: ContractStatus;
  /** Stake amount */
  stake?: number;
  /** Payout received (if won) */
  payout?: number;
  /** Profit/loss */
  profit: number;
  /** Entry price */
  entryPrice?: number;
  /** Exit price */
  exitPrice: number;
  /** Entry timestamp */
  entryTime?: number;
  /** Exit timestamp */
  exitTime: number;
  /** Strategy that generated this trade */
  strategyName?: string;
}
