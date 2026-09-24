import type { Response } from 'express';

import { ConflictError, InvalidCredentialsError, NotFoundError, PersistenceError, ProviderUnavailableError, TimeoutError } from '../lib/errors.js';
import type { ApiResponse } from '../types.js';

export function sendSuccess<T>(response: Response, data: T, status = 200): void {
  response.status(status).json({ success: true, data } satisfies ApiResponse<T>);
}

export function sendFailure(response: Response, error: unknown): void {
  if (response.headersSent) {
    return;
  }
  if (error instanceof NotFoundError) {
    response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
    return;
  }
  if (error instanceof ConflictError) {
    response.status(409).json({ success: false, data: null, error: 'That email already has an account. Try signing in instead.' });
    return;
  }
  if (error instanceof InvalidCredentialsError) {
    response.status(401).json({ success: false, data: null, error: 'That email and password did not match.' });
    return;
  }
  if (error instanceof TimeoutError) {
    response.status(504).json({ success: false, data: null, error: 'That took too long. Check your connection and retry.' });
    return;
  }
  if (error instanceof ProviderUnavailableError || error instanceof PersistenceError) {
    response.status(502).json({ success: false, data: null, error: 'Music service is having a moment. Try again shortly.' });
    return;
  }
  // Everything above is a failure we expected and already have copy for. Anything
  // reaching here is a bug, and returning only the friendly sentence would throw
  // away the one description of it that exists. Log it against the request (so it
  // carries the same x-request-id as the access log) and still tell the browser
  // nothing about the internals.
  logUnexpected(response, error);
  response.status(500).json({ success: false, data: null, error: 'Something went wrong. Try again shortly.' });
}

/** pino-http hangs a per-request child logger off the request; fall back to stderr when it is absent. */
function logUnexpected(response: Response, error: unknown): void {
  const log = (response.req as { log?: { error?: (object: unknown, message: string) => void } } | undefined)?.log;
  if (log?.error) {
    log.error({ err: error }, 'unhandled request failure');
    return;
  }
  process.stderr.write(`unhandled request failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
}

export function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Like {@link queryString}, but rejects anything past `maxLength` instead of accepting it unbounded. */
export function boundedString(value: unknown, maxLength = 200): string | null {
  const trimmed = queryString(value);
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export function songId(value: unknown): string | null {
  const id = queryString(value);
  if (!id || id.length > 200 || /^https?:/i.test(id)) {
    return null;
  }
  return id;
}

export function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function nonNegativeInt(value: unknown, fallback: number, max = 100): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function sanitizeSettings(value: unknown): Record<string, string | number | boolean> {
  const input = asRecord(value);
  const settings: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      settings[key] = item;
    }
  }
  return settings;
}
