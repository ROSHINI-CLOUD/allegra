import assert from 'node:assert/strict';

const baseUrl = process.env.CONTRACT_BASE_URL?.replace(/\/+$/, '');
if (!baseUrl) {
  throw new Error('CONTRACT_BASE_URL is required, for example https://api.example.com');
}

async function get(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { response, body: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
}

const health = await get('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body?.ok, true);
assert.equal(typeof health.body?.version, 'string');

const search = await get(`/api/search?q=${encodeURIComponent(process.env.CONTRACT_QUERY ?? 'arijit singh')}`);
assert.equal(search.response.status, 200);
assert.equal(search.body?.success, true);
assert.ok(Array.isArray(search.body?.data?.results));
for (const song of search.body.data.results) {
  assert.equal(typeof song.id, 'string');
  assert.equal(typeof song.title, 'string');
  assert.equal(typeof song.streamUrl, 'string');
  assert.match(song.streamUrl, /^\/api\/stream\//);
}

const songId = process.env.CONTRACT_SONG_ID;
if (songId) {
  const stream = await get(`/api/stream/${encodeURIComponent(songId)}`, {
    headers: { Range: 'bytes=100-200' }
  });
  assert.equal(stream.response.status, 206);
  assert.match(stream.response.headers.get('content-range') ?? '', /^bytes 100-200\//);
  assert.equal(stream.response.headers.get('accept-ranges'), 'bytes');
}

process.stdout.write(`Contract smoke passed against ${baseUrl}\n`);
