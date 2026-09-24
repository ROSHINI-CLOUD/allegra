import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import type { LyricLine } from '../types.js';
import { packBatches, TranslationService } from './translation.js';

function lines(...texts: string[]): LyricLine[] {
  return texts.map((text, index) => ({ text, timestamp: index * 5, lineOrder: index }));
}

/** A MyMemory stand-in: uppercases each line, records every request. */
function fakeMyMemory(options: { status?: number; quotaFinished?: boolean; mergeLines?: boolean } = {}) {
  const requests: URL[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    requests.push(url);
    const q = url.searchParams.get('q') ?? '';
    const translated = options.mergeLines ? q.replace(/\n/g, ' ') : q.toUpperCase();
    return new Response(
      JSON.stringify({
        responseStatus: options.status ?? 200,
        quotaFinished: options.quotaFinished ?? false,
        responseData: { translatedText: translated }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;
  return { fetchImpl, requests };
}

test('translates line by line, keeping order, timestamps and instrumental markers', async () => {
  const { fetchImpl } = fakeMyMemory();
  const service = new TranslationService(new MemoryCacheStore(), { fetchImpl });
  const input = lines('pehli', '[INSTRUMENTAL]', 'doosri');
  const result = await service.translate(input, 'Song', 'Artist', 'English', 'hindi');
  assert.ok(result);
  assert.equal(result.provider, 'mymemory');
  assert.deepEqual(result.lines.map((line) => line.text), ['PEHLI', '[INSTRUMENTAL]', 'DOOSRI']);
  assert.deepEqual(result.lines.map((line) => line.timestamp), [0, 5, 10]);
});

test('repeated lines (a chorus) are only sent once, and lines share requests', async () => {
  const { fetchImpl, requests } = fakeMyMemory();
  const service = new TranslationService(new MemoryCacheStore(), { fetchImpl });
  await service.translate(lines('chorus', 'verse', 'chorus', 'chorus'), 'Song', 'Artist', 'English', 'hindi');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.searchParams.get('q'), 'chorus\nverse');
  assert.equal(requests[0]?.searchParams.get('langpair'), 'hi|en');
});

test('an unknown source language is left for the provider to detect', async () => {
  const { fetchImpl, requests } = fakeMyMemory();
  await new TranslationService(new MemoryCacheStore(), { fetchImpl }).translate(lines('x'), 'S', 'A');
  assert.equal(requests[0]?.searchParams.get('langpair'), 'autodetect|en');
});

test('the contact email is sent only when configured', async () => {
  const { fetchImpl, requests } = fakeMyMemory();
  await new TranslationService(new MemoryCacheStore(), { fetchImpl, contactEmail: 'ops@example.com' }).translate(lines('x'), 'S', 'A', 'English', 'tamil');
  assert.equal(requests[0]?.searchParams.get('de'), 'ops@example.com');
  assert.equal(requests[0]?.searchParams.get('langpair'), 'ta|en');
});

test('out of quota is a failure, never shown as a translation', async () => {
  const { fetchImpl } = fakeMyMemory({ quotaFinished: true });
  const result = await new TranslationService(new MemoryCacheStore(), { fetchImpl }).translate(lines('x'), 'S', 'A');
  assert.equal(result, null);
  const { fetchImpl: throttled } = fakeMyMemory({ status: 429 });
  assert.equal(await new TranslationService(new MemoryCacheStore(), { fetchImpl: throttled }).translate(lines('x'), 'S', 'A'), null);
});

test('a self-hosted LibreTranslate fallback answers when MyMemory is unavailable', async () => {
  const requests: URL[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.hostname === 'api.mymemory.translated.net') {
      return new Response(JSON.stringify({ responseStatus: 429 }), { status: 200 });
    }
    assert.equal(url.href, 'https://translate.example/translate');
    return new Response(JSON.stringify({ translatedText: 'HELLO' }), { status: 200 });
  }) as typeof fetch;
  const result = await new TranslationService(new MemoryCacheStore(), { fetchImpl, fallbackBaseUrl: 'https://translate.example' })
    .translate(lines('hello'), 'Song', 'Artist', 'English', 'hindi');
  assert.equal(result?.provider, 'libretranslate');
  assert.deepEqual(result?.lines.map((line) => line.text), ['HELLO']);
  assert.equal(requests.length, 2);
});

test('when the provider merges a batch, each line is retried on its own', async () => {
  let call = 0;
  const fetchImpl = (async (input: URL | string) => {
    call += 1;
    const q = new URL(String(input)).searchParams.get('q') ?? '';
    const translated = q.includes('\n') ? 'MERGED' : q.toUpperCase();
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: translated } }), { status: 200 });
  }) as typeof fetch;
  const result = await new TranslationService(new MemoryCacheStore(), { fetchImpl }).translate(lines('a', 'b'), 'S', 'A', 'English', 'hindi');
  assert.deepEqual(result?.lines.map((line) => line.text), ['A', 'B']);
  assert.equal(call, 3);
});

test('a translated song is cached', async () => {
  const { fetchImpl, requests } = fakeMyMemory();
  const service = new TranslationService(new MemoryCacheStore(), { fetchImpl });
  await service.translate(lines('x'), 'S', 'A', 'English', 'hindi');
  await service.translate(lines('x'), 'S', 'A', 'English', 'hindi');
  assert.equal(requests.length, 1);
});

test('batches stay under the provider limit in bytes, not characters', () => {
  const devanagari = 'क'.repeat(100); // 300 bytes
  const batches = packBatches([devanagari, devanagari, 'short']);
  assert.deepEqual(batches.map((batch) => batch.length), [1, 2]);
  for (const batch of batches) assert.ok(Buffer.byteLength(batch.join('\n'), 'utf8') <= 450);
});
