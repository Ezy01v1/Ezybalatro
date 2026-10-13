import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { requestIdFrom } from './request-id';

/** Request URL without its query string (tokens or ids may travel there). */
export function pathOnly(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Paths censored in every log line: credentials, tokens, passwords, secrets and connection strings.
 * Request bodies are never logged (pino-http logs method, url, headers and status only); cards and
 * table state never reach the logger.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'token',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  'password',
  '*.password',
  'secret',
  '*.secret',
  '*.secretKey',
  '*.SUPABASE_SECRET_KEY',
  '*.DATABASE_URL',
  '*.DIRECT_URL',
  '*.connectionString',
];

/** nestjs-pino options: JSON lines on stdout, request id from `x-request-id` (validated) or a uuid. */
export function loggerParams(level: string): Params {
  return {
    pinoHttp: {
      level,
      stream: process.stdout,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      serializers: {
        req: (req: { id?: unknown; method?: string; url?: string; headers?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: pathOnly(req.url),
          headers: req.headers,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = requestIdFrom(req.headers['x-request-id']);
        res.setHeader('x-request-id', id);
        return id;
      },
    },
  };
}
