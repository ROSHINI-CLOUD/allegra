/**
 * The optional ListenBrainz copy (1.68.0) is wired end to end and stays server-free and private. These read the
 * source, like the other guards, so a later change that drops a link or adds a hidden server fails here.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('ListenBrainz copy wiring', () => {
  it('queues a listen whether or not Listening stats is on, and before the stats switch returns', () => {
    const log = read('src/services/stats/listenLog.ts');
    const queued = log.indexOf('copyToListenbrainz(song, ending, startedAtIso);');
    const stats = log.indexOf('if (!useSettingsStore.getState().listeningStats) return;');
    expect(queued).toBeGreaterThan(-1);
    expect(stats).toBeGreaterThan(queued);
  });

  it('loads the saved link at start-up and from Settings', () => {
    expect(read('src/App.tsx')).toMatch(/runWhenIdle\('listenbrainz'[\s\S]*?startListenbrainzSync\(\)/);
    expect(read('src/screens/SettingsScreen.tsx')).toMatch(/<ListenbrainzSettings onLayout=\{at\('listenbrainz'\)\}/);
  });

  it('creates the queue table beside the listen log', () => {
    const db = read('src/database/db.ts');
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS listenbrainz_queue/);
    expect(db).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_listenbrainz_queue_listen/);
  });

  it('sends only to ListenBrainz and keeps the token in the keystore', () => {
    const api = read('src/services/listenbrainz/listenbrainzApi.ts');
    const hosts = [...api.matchAll(/https?:\/\/[^'"`/\s]+/g)].map(match => match[0]);
    expect(new Set(hosts)).toEqual(new Set(['https://api.listenbrainz.org']));
    const sync = read('src/services/listenbrainz/listenbrainzSync.ts');
    expect(sync).toMatch(/SecureStore\.setItemAsync\(KEY/);
    expect(sync).not.toMatch(/AsyncStorage/);
  });

  it('never logs the token', () => {
    for (const file of ['listenbrainzApi.ts', 'listenbrainzSync.ts', 'listenbrainzFlush.ts']) {
      expect(read(`src/services/listenbrainz/${file}`)).not.toMatch(/console\./);
    }
  });
});
