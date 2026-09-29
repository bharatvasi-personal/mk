import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates with the Zod schema from @mk/shared rather than with class-validator
 * decorators, so the API and the web forms are checked against literally the same
 * object. Validation drift between client and server is the usual source of
 * "it worked in the form but the API said no".
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      })),
    });
  }
}

/** `@Body(zodBody(createOrderSchema))` reads better than instantiating the pipe inline. */
export const zodBody = <T>(schema: ZodSchema<T>) => new ZodValidationPipe(schema);

/**
 * `@Query(zodQuery(schema))` — the same treatment for query strings.
 *
 * Added because a required `?from=` that simply was not sent produced
 * `new Date(undefined)` deep inside a Prisma call and came back as a 500 "Something went
 * wrong". A missing parameter is the caller's mistake and should say so: the difference
 * between a 400 naming the field and a 500 is an hour of reading server logs.
 */
export const zodQuery = <T>(schema: ZodSchema<T>) => new ZodValidationPipe(schema);
