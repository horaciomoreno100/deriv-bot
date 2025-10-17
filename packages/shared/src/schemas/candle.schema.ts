import { z } from 'zod';

/**
 * Zod schema for Candle validation
 */
export const CandleSchema = z.object({
  asset: z.string().min(1),
  timeframe: z.number().int().positive(),
  timestamp: z.number().int().positive(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative().optional(),
});

/**
 * Type inferred from schema
 */
export type CandleSchemaType = z.infer<typeof CandleSchema>;
