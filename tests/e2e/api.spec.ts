import { expect, test } from '@playwright/test';

import { firstSongId, SEARCH_QUERY } from './helpers';

test('health reports ok and a version', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { ok?: boolean; version?: unknown };
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe('string');
});

test('search returns playable songs behind our own stream route', async ({ request }) => {
  const response = await request.get(`/api/search?q=${encodeURIComponent(SEARCH_QUERY)}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    success: boolean;
    data: { results: Array<Record<string, unknown>> };
  };
  expect(body.success).toBe(true);
  expect(body.data.results.length).toBeGreaterThan(0);
  for (const song of body.data.results) {
    expect(typeof song.id).toBe('string');
    expect(typeof song.title).toBe('string');
    // Provider URLs never reach the browser.
    expect(song.streamUrl).toMatch(/^\/api\/stream\//);
    // Duration is always seconds.
    if (song.duration !== undefined) expect(Number(song.duration)).toBeLessThan(60 * 60);
  }
});

test('a Range request stays a 206 with Content-Range (the byte-range rule)', async ({ request }) => {
  const id = await firstSongId(request);
  const response = await request.get(`/api/stream/${encodeURIComponent(id)}`, {
    headers: { Range: 'bytes=100-200' }
  });
  expect(response.status()).toBe(206);
  expect(response.headers()['content-range']).toMatch(/^bytes 100-200\//);
  expect(response.headers()['accept-ranges']).toBe('bytes');
  expect((await response.body()).length).toBe(101);
});

test('a song looks up by id', async ({ request }) => {
  const id = await firstSongId(request);
  const response = await request.get(`/api/songs/${encodeURIComponent(id)}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { success: boolean; data: { id: string } };
  expect(body.success).toBe(true);
  expect(body.data.id).toBe(id);
});

test('home feed answers in the standard envelope', async ({ request }) => {
  const response = await request.get('/api/home');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { success: boolean; data: unknown };
  expect(body.success).toBe(true);
  expect(body.data).toBeTruthy();
});

test('an unknown API route is a 404 in the standard envelope, not a page', async ({ request }) => {
  const response = await request.get('/api/definitely-not-a-route');
  expect(response.status()).toBe(404);
  const body = (await response.json()) as { success: boolean; error?: unknown };
  expect(body.success).toBe(false);
  expect(typeof body.error).toBe('string');
});

test('signed-out calls to listener data are refused, not crashed', async ({ request }) => {
  const response = await request.get('/api/me/settings');
  expect([401, 403]).toContain(response.status());
  const body = (await response.json()) as { success: boolean };
  expect(body.success).toBe(false);
});
