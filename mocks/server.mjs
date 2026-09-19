import { createServer } from 'node:http';

const port = Number.parseInt(process.env.MOCK_PORT ?? '9090', 10);
const audio = Buffer.alloc(64 * 1024, 0);

const songs = [
  song('mock-arijit', 'Agar Tum Saath Ho', 'Alka Yagnik, Arijit Singh', 329, 'Hindi'),
  song('mock-anuv', 'Husn', 'Anuv Jain', 217, 'Hindi'),
  song('mock-coldplay', 'Yellow', 'Coldplay', 267, 'English')
];

const lyrics = [
  { timestamp: 0, text: 'Look at the stars', lineOrder: 0 },
  { timestamp: 4.2, text: 'Look how they shine for you', lineOrder: 1 },
  { timestamp: 9.8, text: 'And everything you do', lineOrder: 2 },
  { timestamp: 15.4, text: 'Yeah, they were all yellow', lineOrder: 3 }
];

function song(id, title, artist, duration, language) {
  return {
    id,
    title,
    artist,
    album: 'Allegra Mock Sessions',
    artwork: `https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1000&q=80&sig=${id}`,
    streamUrl: `/api/stream/${id}`,
    duration,
    hasLyrics: true,
    language,
    playCount: 1_000_000,
    source: 'Saavn'
  };
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function success(data) {
  return { success: true, data };
}

function failure(error) {
  return { success: false, data: null, error };
}

function sendStream(request, response, id) {
  if (!songs.some((item) => item.id === id)) {
    json(response, 404, failure("We couldn't find that."));
    return;
  }

  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, {
      'access-control-allow-origin': '*',
      'accept-ranges': 'bytes',
      'content-length': audio.length,
      'content-type': 'audio/mpeg',
      'cross-origin-resource-policy': 'cross-origin'
    });
    response.end(audio);
    return;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { 'content-range': `bytes */${audio.length}` });
    response.end();
    return;
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : audio.length - 1;
  const end = Math.min(requestedEnd, audio.length - 1);
  if (start >= audio.length || start > end) {
    response.writeHead(416, { 'content-range': `bytes */${audio.length}` });
    response.end();
    return;
  }

  const body = audio.subarray(start, end + 1);
  response.writeHead(206, {
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    'content-length': body.length,
    'content-range': `bytes ${start}-${end}/${audio.length}`,
    'content-type': 'audio/mpeg',
    'cross-origin-resource-policy': 'cross-origin'
  });
  response.end(body);
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-headers': 'authorization, content-type, range',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*'
    });
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/api/health') {
    json(response, 200, { ok: true, version: 'mock' });
    return;
  }

  if (request.method === 'GET' && path === '/api/search') {
    const query = url.searchParams.get('q')?.trim() ?? '';
    json(response, 200, success({
      results: query.toLowerCase() === 'empty' ? [] : songs,
      source: 'Saavn'
    }));
    return;
  }

  const songMatch = /^\/api\/songs\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && songMatch) {
    const match = songs.find((item) => item.id === songMatch[1]);
    json(response, match ? 200 : 404, match ? success(match) : failure("We couldn't find that."));
    return;
  }

  const streamMatch = /^\/api\/stream\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && streamMatch) {
    sendStream(request, response, streamMatch[1]);
    return;
  }

  if (request.method === 'GET' && path === '/api/lyrics') {
    json(response, 200, success({
      source: 'LRCLIB',
      type: 'synced',
      matchScore: 100,
      matchReason: 'Title match • Synced • Exact duration',
      lines: lyrics
    }));
    return;
  }

  if (request.method === 'GET' && path === '/api/artwork') {
    json(response, 200, success({ urls: [songs[0].artwork] }));
    return;
  }

  if (request.method === 'POST' && path === '/api/auth/anon') {
    json(response, 200, success({ token: 'mock-token', userId: 'mock-user' }));
    return;
  }

  json(response, 404, failure("We couldn't find that."));
});

server.listen(port, () => {
  process.stdout.write(`Allegra mock API listening on http://localhost:${port}\n`);
});
