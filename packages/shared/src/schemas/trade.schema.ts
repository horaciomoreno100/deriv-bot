import { z } from 'zod';

/**
 * Contract direction schema
 */
export const ContractDirectionSchema = z.enum(['CALL', 'PUT']);

/**
 * Contract status schema
 */
export const ContractStatusSchema = z.enum(['open', 'won', 'lost']);

/**
 * Duration unit schema
 */
export const DurationUnitSchema = z.enum(['s', 'm', 'h', 'd']);

/**
 * Trade request schema
 */
export const TradeRequestSchema = z.object({
  symbol: z.string().min(1),
  direction: ContractDirectionSchema,
  amount: z.number().positive(),
  duration: z.number().int().positive(),
  durationUnit: DurationUnitSchema,
  strategyName: z.string().optional(),
});

/**
 * Proposal schema
 */
export const ProposalSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  contractType: ContractDirectionSchema,
  stake: z.number().positive(),
  payout: z.number().positive(),
  spot: z.number().positive(),
  spotTime: z.number().int().positive(),
  duration: z.number().int().positive(),
  durationUnit: DurationUnitSchema,
});

/**
 * Contract schema
 */
export const ContractSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  direction: ContractDirectionSchema,
  stake: z.number().positive(),
  payout: z.number().positive(),
  entryPrice: z.number().positive(),
  entryTime: z.number().int().positive(),
  exitPrice: z.number().positive().optional(),
  exitTime: z.number().int().positive().optional(),
  currentPrice: z.number().positive().optional(),
  status: ContractStatusSchema,
  profit: z.number().optional(),
  duration: z.number().int().positive(),
});

/**
 * Trade result schema
 */
export const TradeResultSchema = z.object({
  contractId: z.string(),
  symbol: z.string(),
  direction: ContractDirectionSchema,
  status: ContractStatusSchema,
  stake: z.number().positive(),
  payout: z.number().positive(),
  profit: z.number(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  entryTime: z.number().int().positive(),
  exitTime: z.number().int().positive(),
});
