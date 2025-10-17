import { z } from 'zod';

/**
 * Zod schema for Tick validation
 */
export const TickSchema = z.object({
  asset: z.string().min(1),
  price: z.number().positive(),
  timestamp: z.number().int().positive(),
  direction: z.number().int().min(-1).max(1).optional(),
});

/**
 * Type inferred from schema
 */
export type TickSchemaType = z.infer<typeof TickSchema>;
