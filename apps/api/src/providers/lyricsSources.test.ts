import assert from 'node:assert/strict';
import test from 'node:test';

import { KuGouProvider } from './kugou.js';
import { UnisonProvider } from './unison.js';
import { YouLyPlusProvider } from './youlyplus.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('LyricsPlus: a dead instance does not sink the race, and its lines become LRC', async () => {
  const provider = new YouLyPlusProvider({
    servers: ['https://dead.test', 'https://live.test'],
    fetchImpl: async (input) => {
      if (String(input).startsWith('https://dead.test')) return new Response('error code: 1033', { status: 530 });
      return json({
        type: 'Word',
        metadata: { source: 'qApple', title: 'Night Drive', artist: 'Driver' },
        lyrics: [
          { time: 27_395, text: 'first line', syllabus: [{ time: 27_395, text: 'first ' }] },
          { time: 30_189, text: 'second line' }
        ]
      });
    }
  });

  const found = await provider.find('Night Drive', 'Driver', 200);
  assert.equal(found?.source, 'LyricsPlus(Apple)');
  assert.equal(found?.filedAs, 'Driver — Night Drive');
  assert.equal(found?.lyrics, '[00:27.39] first line\n[00:30.18] second line');
});

test('LyricsPlus: an instance saying "no lyrics" is a miss, not a result', async () => {
  const provider = new YouLyPlusProvider({ servers: ['https://live.test'], fetchImpl: async () => json({ error: 'not found' }) });
  assert.equal(await provider.find('Nothing', 'Nobody', 200), null);
});

test('Unison: TTML entries become LRC, and search offers several versions', async () => {
  const ttml = '<tt><body><p begin="1.0">one</p><p begin="2.0">two</p></body></tt>';
  const provider = new UnisonProvider({
    baseUrl: 'https://unison.test',
    fetchImpl: async (input) =>
      String(input).includes('/lyrics/search')
        ? json({ success: true, data: [
            { song: 'Song', artist: 'Singer', lyrics: '[00:01.00] one', format: 'lrc' },
            { song: 'Song', artist: 'Singer', lyrics: ttml, format: 'ttml' },
            { song: 'Song', artist: 'Singer', lyrics: '   ', format: 'lrc' }
          ] })
        : json({ success: false, error: 'Lyrics not found' }, 404)
  });

  assert.equal(await provider.find('Song', 'Singer', 180), null);
  const versions = await provider.search('Song', 'Singer', 180);
  assert.equal(versions.length, 2);
  assert.ok(versions[1]?.lyrics.startsWith('[00:01'));
  assert.equal(versions[0]?.filedAs, 'Singer — Song');
});

test('KuGou: decodes the LRC, trims the credit block, keeps lyric lines with a colon, skips other recordings', async () => {
  const lrc = [
    '[ar:Driver]',
    '[00:00.50]Night Drive - Driver',
    '[00:01.00]Lyrics by：Someone',
    '[00:02.00]Composed by：Someone Else',
    '[00:03.00]She said: stay',
    '[00:04.00]until the morning'
  ].join('\n');
  const requests: string[] = [];
  const provider = new KuGouProvider({
    baseUrl: 'https://kugou.test',
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/search')) {
        return json({ candidates: [{ id: '1', accesskey: 'key-1', duration: 201_000 }, { id: '2', accesskey: 'key-2', duration: 320_000 }] });
      }
      return json({ content: Buffer.from(lrc, 'utf8').toString('base64') });
    }
  });

  const all = await provider.findAll('Night Drive', 'Driver', 200);
  assert.equal(all.length, 1, 'the 320 s candidate is another recording');
  assert.equal(all[0]?.lyrics, '[00:03.00]She said: stay\n[00:04.00]until the morning');
  assert.equal(requests.filter((url) => url.includes('/download')).length, 1);
});
