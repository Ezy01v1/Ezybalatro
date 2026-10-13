import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/** A client `x-request-id` when it is 1-64 of `[A-Za-z0-9-]`; anything else gets a new uuid. */
export function requestIdFrom(header: unknown): string {
  return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
}

/** The id pino-http gave the request (`req.id`), or one derived from the header. */
export function requestIdOf(req: IncomingMessage & { id?: unknown }): string {
  if (typeof req.id === 'string' && REQUEST_ID.test(req.id)) return req.id;
  return requestIdFrom(req.headers['x-request-id']);
}
