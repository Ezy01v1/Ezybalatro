import type { HoldemEvent, TableView } from '@naipes/engine';
import { z } from 'zod';
import type { SocketError } from './index';

export type { TableView, HoldemEvent, Card, LegalActions } from '@naipes/engine';

const chipAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const tableId = z.string().min(1).max(64);

export const playerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }).strict(),
  z.object({ type: z.literal('check') }).strict(),
  z.object({ type: z.literal('call') }).strict(),
  z.object({ type: z.literal('bet'), amount: chipAmount }).strict(),
  z.object({ type: z.literal('raise'), to: chipAmount }).strict(),
  z.object({ type: z.literal('allIn') }).strict(),
]);
export type PlayerAction = z.infer<typeof playerActionSchema>;

export const quickSeatRequestSchema = z.object({ buyIn: chipAmount.optional() }).strict();
export type QuickSeatRequest = z.infer<typeof quickSeatRequestSchema>;

export const actRequestSchema = z
  .object({
    tableId,
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    action: playerActionSchema,
  })
  .strict();
export type ActRequest = z.infer<typeof actRequestSchema>;

/** Used by sitOut, leave and sync. */
export const tableRequestSchema = z.object({ tableId }).strict();
export type TableRequest = z.infer<typeof tableRequestSchema>;

export const sitInRequestSchema = z
  .object({ tableId, postBlindsToEnter: z.boolean().optional() })
  .strict();
export type SitInRequest = z.infer<typeof sitInRequestSchema>;

export type TableClosedReason = 'empty' | 'shutdown' | 'error';

export interface TableUpdate {
  tableId: string;
  seq: number;
  events: readonly HoldemEvent[];
  view: TableView;
  turn: { seat: number; endsInMs: number } | null;
}

export interface TableClosed {
  tableId: string;
  reason: TableClosedReason;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: SocketError };
