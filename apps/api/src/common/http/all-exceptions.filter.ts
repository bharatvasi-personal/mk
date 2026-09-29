import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { TenantContext } from '../tenant/tenant-context';

/**
 * One error shape for every failure, with the request id attached so a partner can
 * read a number off the screen and it can be found in the logs.
 *
 * Prisma and Postgres errors are translated rather than leaked: a raw
 * "duplicate key value violates unique constraint orders_branch_id_client_ref_key"
 * is both useless to the user and mildly informative to an attacker.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = TenantContext.peek()?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Something went wrong' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body = typeof res === 'string' ? { message: res } : (res as Record<string, unknown>);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, body } = this.fromPrisma(exception));
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
        'Unhandled exception',
      );
    }

    if (status >= 500) {
      this.logger.error({ requestId, status, body }, 'Request failed');
    }

    // Depending on how the exception surfaced, the response object may be the Fastify
    // reply or the underlying Node ServerResponse. Handle both rather than throwing a
    // second error out of the error handler.
    const anyReply = reply as unknown as {
      status?: (code: number) => { send: (payload: unknown) => void };
      code?: (code: number) => { send: (payload: unknown) => void };
      writeHead?: (code: number, headers: Record<string, string>) => void;
      end?: (chunk: string) => void;
    };
    const payload = { ...body, statusCode: status, requestId };

    if (typeof anyReply.status === 'function') {
      void anyReply.status(status).send(payload);
    } else if (typeof anyReply.code === 'function') {
      void anyReply.code(status).send(payload);
    } else if (typeof anyReply.writeHead === 'function' && typeof anyReply.end === 'function') {
      anyReply.writeHead(status, { 'content-type': 'application/json' });
      anyReply.end(JSON.stringify(payload));
    } else {
      this.logger.error({ requestId, status, payload }, 'Could not send an error response');
    }
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: Record<string, unknown>;
  } {
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: { message: 'That record already exists', fields: e.meta?.['target'] },
        };
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, body: { message: 'Referenced record does not exist' } };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, body: { message: 'Record not found' } };
      case 'P2010': {
        // Our own immutability and cross-tenant triggers raise through here.
        const msg = String((e.meta as { message?: string } | undefined)?.message ?? '');
        if (msg.includes('append-only') || msg.includes('immutable')) {
          return { status: HttpStatus.CONFLICT, body: { message: msg.split('\n')[0] } };
        }
        if (msg.includes('Cross-tenant')) {
          return { status: HttpStatus.FORBIDDEN, body: { message: 'Cross-tenant reference rejected' } };
        }
        return { status: HttpStatus.BAD_REQUEST, body: { message: 'Database rejected the operation' } };
      }
      default:
        this.logger.error({ code: e.code, meta: e.meta }, 'Unmapped Prisma error');
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { message: 'Database error' } };
    }
  }
}
