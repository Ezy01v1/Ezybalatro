import { z } from 'zod';

/** REST error envelope (CLAUDE.md conventions). */
export const restErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type RestError = z.infer<typeof restErrorSchema>;

/** Socket error codes. Extended as the protocol grows (docs/protocol.md). */
export const socketErrorCodeSchema = z.enum([
  'NOT_YOUR_TURN',
  'INVALID_AMOUNT',
  'STALE_SEQ',
  'INVALID_MESSAGE',
  'INTERNAL',
]);
export type SocketErrorCode = z.infer<typeof socketErrorCodeSchema>;

export const socketErrorSchema = z.object({
  type: z.literal('error'),
  code: socketErrorCodeSchema,
  message: z.string(),
});
export type SocketError = z.infer<typeof socketErrorSchema>;

export const SOCKET_EVENTS = {
  ping: 'ping',
  pong: 'pong',
  error: 'error',
} as const;

export const pongSchema = z.object({ type: z.literal('pong'), serverTime: z.number().int() });
export type Pong = z.infer<typeof pongSchema>;

export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
