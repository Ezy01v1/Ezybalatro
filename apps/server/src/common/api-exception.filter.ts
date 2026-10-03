import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { RestError } from '@naipes/shared';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

/** Global REST error filter. Shape: { error: { code, message, requestId } } (CLAUDE.md). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = request.header('x-request-id') ?? randomUUID();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Unexpected error.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? 'HTTP_ERROR';
      message = exception.message;
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record.code === 'string') code = record.code;
        if (Array.isArray(record.message)) message = record.message.join('; ');
        else if (typeof record.message === 'string') message = record.message;
      }
    } else {
      // Never leak internals (stack, cards, tokens) to the client; log server-side only.
      this.logger.error(
        `[${requestId}] Unhandled error`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: RestError = { error: { code, message, requestId } };
    response.status(status).setHeader('x-request-id', requestId).json(payload);
  }
}
