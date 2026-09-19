import type { Response } from 'express';

import { NotFoundError, PersistenceError, ProviderUnavailableError, TimeoutError } from '../lib/errors.js';
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
  if (error instanceof TimeoutError) {
    response.status(504).json({ success: false, data: null, error: 'That took too long. Check your connection and retry.' });
    return;
  }
  if (error instanceof ProviderUnavailableError || error instanceof PersistenceError) {
    response.status(502).json({ success: false, data: null, error: 'Music service is having a moment. Try again shortly.' });
    return;
  }
  response.status(500).json({ success: false, data: null, error: 'Something went wrong. Try again shortly.' });
}

export function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
