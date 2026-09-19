import type { Response } from 'express';

import { NotFoundError, ProviderUnavailableError } from '../lib/errors.js';
import type { ApiResponse } from '../types.js';

export function sendSuccess<T>(response: Response, data: T, status = 200): void {
  response.status(status).json({ success: true, data } satisfies ApiResponse<T>);
}

export function sendFailure(response: Response, error: unknown): void {
  if (error instanceof NotFoundError) {
    response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
    return;
  }
  if (error instanceof ProviderUnavailableError) {
    response.status(502).json({ success: false, data: null, error: 'Music service is having a moment. Try again shortly.' });
    return;
  }
  response.status(500).json({ success: false, data: null, error: 'Something went wrong. Try again shortly.' });
}

export function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function nonNegativeInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
