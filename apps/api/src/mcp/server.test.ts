import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { createApp } from '../app.js';

/** Same exactOptionalPropertyTypes friction as server.ts — see the comment there. */
async function connectClient(baseUrl: string, token?: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    ...(token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {})
  });
  await client.connect(transport as unknown as Transport);
  return client;
}

const rawSong = {
  id: 'song-1',
  name: 'Test Song',
  primaryArtists: 'Test Artist',
  duration: 180,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes('/songs/')) {
    return Promise.resolve(new Response(JSON.stringify({ success: true, data: rawSong }), { headers: { 'content-type': 'application/json' } }));
  }
  return Promise.resolve(new Response(JSON.stringify({ success: true, data: { results: [] } }), { headers: { 'content-type': 'application/json' } }));
}

/** Real HTTP server + the real MCP client SDK — this is the same handshake ChatGPT would perform. */
async function withServer(run: (baseUrl: string, guestToken: string) => Promise<void>): Promise<void> {
  const app = createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    lrclibApiUrl: 'https://lrclib.test/api',
    fetchImpl: fakeFetch,
    rateLimit: false,
    allowedOrigin: 'http://localhost:5173'
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const authResponse = await fetch(`${baseUrl}/api/auth/anon`, { method: 'POST' });
    const authBody = (await authResponse.json()) as { data: { token: string } };
    await run(baseUrl, authBody.data.token);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') throw new Error('expected a text content block');
  return first.text;
}

test('a request with no Authorization header is rejected at the HTTP layer, per the MCP auth spec', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /Bearer/);
  });
});

test('lists every registered tool over a real Streamable HTTP handshake', async () => {
  await withServer(async (baseUrl, token) => {
    const client = await connectClient(baseUrl, token);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const expected of ['get_taste_profile', 'get_listening_stats', 'search_catalog', 'get_recommendations', 'log_listen', 'record_feedback']) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
    // The token never appears in a tool's input schema — it travels only in the Authorization header.
    for (const tool of tools) {
      assert.ok(!Object.keys(tool.inputSchema?.properties ?? {}).includes('authToken'), `${tool.name} still takes authToken as an argument`);
    }
    await client.close();
  });
});

test('rejects a bad token instead of throwing', async () => {
  await withServer(async (baseUrl) => {
    await assert.rejects(() => connectClient(baseUrl, 'not-a-real-token'));
  });
});

test('log_listen updates taste, and get_taste_profile reads the update back — same connection, two calls, no shared session state', async () => {
  await withServer(async (baseUrl, token) => {
    const client = await connectClient(baseUrl, token);

    const before = JSON.parse(textOf(await client.callTool({ name: 'get_taste_profile', arguments: {} }) as never));
    assert.equal(before.signals, 0);

    const logged = await client.callTool({ name: 'log_listen', arguments: { songId: 'song-1', playedSeconds: 170 } });
    assert.notEqual(logged.isError, true);

    const after = JSON.parse(textOf(await client.callTool({ name: 'get_taste_profile', arguments: {} }) as never));
    assert.equal(after.signals, 1);
    assert.ok(after.topArtists.some((artist: { name: string }) => artist.name === 'Test Artist'));

    await client.close();
  });
});

test('record_feedback like/unlike round-trips through the library', async () => {
  await withServer(async (baseUrl, token) => {
    const client = await connectClient(baseUrl, token);

    const liked = JSON.parse(textOf(await client.callTool({ name: 'record_feedback', arguments: { songId: 'song-1', action: 'like' } }) as never));
    assert.equal(liked.liked, true);

    const unliked = JSON.parse(textOf(await client.callTool({ name: 'record_feedback', arguments: { songId: 'song-1', action: 'unlike' } }) as never));
    assert.equal(unliked.liked, false);

    await client.close();
  });
});

test('a second listener never sees the first listener\'s taste — no cross-request state', async () => {
  await withServer(async (baseUrl, tokenA) => {
    const secondAuth = await fetch(`${baseUrl}/api/auth/anon`, { method: 'POST' });
    const { data: { token: tokenB } } = (await secondAuth.json()) as { data: { token: string } };

    const clientA = await connectClient(baseUrl, tokenA);
    await clientA.callTool({ name: 'log_listen', arguments: { songId: 'song-1', playedSeconds: 170 } });
    await clientA.close();

    const clientB = await connectClient(baseUrl, tokenB);
    const tasteB = JSON.parse(textOf(await clientB.callTool({ name: 'get_taste_profile', arguments: {} }) as never));
    assert.equal(tasteB.signals, 0);
    await clientB.close();
  });
});
