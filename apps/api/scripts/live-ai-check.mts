import 'dotenv/config';

const base = process.env.API_BASE ?? 'http://127.0.0.1:8080';

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

async function getJson(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { headers });
  return { status: response.status, json: await response.json() };
}

const translate = await postJson('/api/ai/translate-lyrics', {
  title: 'Tum Hi Ho',
  artist: 'Arijit Singh',
  targetLanguage: 'English',
  lines: [
    { text: 'Tum hi ho', timestamp: 0, lineOrder: 0 },
    { text: 'Ab tum hi ho', timestamp: 5, lineOrder: 1 }
  ]
});
console.log('translate', translate.status, JSON.stringify(translate.json));

const guest = await postJson('/api/auth/guest', {});
const token = (guest.json as { data?: { token?: string } }).data?.token;
if (!token) {
  console.error('no guest token', guest);
  process.exit(1);
}
const auth = { authorization: `Bearer ${token}` };

const search = await getJson('/api/search?q=arijit%20singh&limit=5');
const songs = ((search.json as { data?: { results?: Array<{ id: string; title: string }> } }).data?.results ?? []);
console.log('search count', songs.length, songs.map((song) => song.title).slice(0, 3));
if (songs.length < 2) process.exit(1);

await postJson('/api/me/liked', { songId: songs[0]!.id }, auth);
await postJson('/api/me/liked', { songId: songs[1]!.id }, auth);
await postJson('/api/me/recently-played', { songId: songs[0]!.id }, auth);

const rec = await getJson(`/api/ai/recommendations?songId=${songs[0]!.id}`, auth);
const recData = (rec.json as { data?: { provider?: string; reasoning?: string; songs?: unknown[] }; error?: string }).data;
console.log(
  'recommendations',
  rec.status,
  recData
    ? { provider: recData.provider, reasoning: recData.reasoning, count: recData.songs?.length }
    : (rec.json as { error?: string }).error
);
