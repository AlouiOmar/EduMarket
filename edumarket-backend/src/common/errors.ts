import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  /** `details` is returned to the client (for example the overlapping events of a scheduling conflict); never put secrets in it. */
  constructor(public status: number, public code: string, message = code, public details?: Record<string, unknown>) { super(message); }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const known = error instanceof AppError;
  const validation = error instanceof ZodError;
  const duplicate = (error as { code?: number })?.code === 11000;
  const invalidId = (error as { name?: string })?.name === 'CastError';
  const malformedJson = (error as { type?: string })?.type === 'entity.parse.failed';
  const status = known ? error.status : validation || invalidId || malformedJson ? 400 : duplicate ? 409 : 500;
  const code = known ? error.code : validation ? 'VALIDATION_ERROR' : invalidId ? 'INVALID_IDENTIFIER' : malformedJson ? 'MALFORMED_JSON' : duplicate ? 'RESOURCE_ALREADY_EXISTS' : 'INTERNAL_ERROR';
  if (status === 500) console.error('Unhandled request error', error);
  res.status(status).json({ success: false, error: { code, ...(known && error.details ? { details: error.details } : {}) } });
};
