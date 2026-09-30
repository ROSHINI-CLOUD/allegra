import type { LibraryChange } from '@shared/library';
import type { SongRef } from '@shared/songRef';

import { LIKED_PLAYLIST_ID, buildLocalIndex, opsForFirstSync, planInbound, refForLocalSong, snapshotOfLocal } from './plan';

const A = 'saavn:a' as SongRef;
const B = 'saavn:b' as SongRef;
const snapshot = (ref: SongRef, title: string, artist = 'Dua Lipa') => ({ ref, title, artist, artwork: '', duration: 200 });

const index = buildLocalIndex([
  { id: 'row-origin', title: 'Anything', artist: 'X', originId: 'saavn:a' },
  { id: 'row-old', title: "Don't Start Now", artist: 'Dua Lipa' }, // downloaded before origins were kept
]);

describe('planInbound', () => {
  it('likes the downloaded copy when there is one, otherwise keeps an online like', () => {
    const changes: LibraryChange[] = [
      { kind: 'like', rev: 1, ref: A, liked: true, likedAt: 1 },
      { kind: 'like', rev: 2, ref: 'saavn:zz' as SongRef, song: snapshot('saavn:zz' as SongRef, 'Dont Start Now (Official Video)'), liked: true, likedAt: 2 },
      { kind: 'like', rev: 3, ref: B, song: snapshot(B, 'Levitating'), liked: true, likedAt: 3 },
    ];
    expect(planInbound(changes, index, new Set())).toEqual([
      { kind: 'like_local', songId: 'row-origin', ref: A, liked: true },
      { kind: 'online_unlike', ref: A },
      { kind: 'like_local', songId: 'row-old', ref: 'saavn:zz', liked: true },
      { kind: 'online_unlike', ref: 'saavn:zz' },
      { kind: 'online_like', ref: B, song: snapshot(B, 'Levitating'), likedAt: 3 },
    ]);
  });

  it('an unlike clears both the row and any online copy', () => {
    expect(planInbound([{ kind: 'like', rev: 1, ref: A, liked: false, likedAt: 1 }], index, new Set())).toEqual([
      { kind: 'like_local', songId: 'row-origin', ref: A, liked: false },
      { kind: 'online_unlike', ref: A },
    ]);
  });

  it('fills a playlist created in the same batch; skips items of unknown playlists and the Liked list', () => {
    const actions = planInbound(
      [
        { kind: 'playlist', rev: 1, playlistId: 'p1', name: 'Road', isPublic: false, deleted: false, createdAt: 5 },
        { kind: 'playlist_item', rev: 2, playlistId: 'p1', ref: A, deleted: false, addedAt: 6 },
        { kind: 'playlist_item', rev: 3, playlistId: 'p1', ref: B, song: snapshot(B, 'Levitating'), deleted: false, addedAt: 7 },
        { kind: 'playlist_item', rev: 4, playlistId: 'gone', ref: B, deleted: false, addedAt: 8 },
        { kind: 'playlist', rev: 5, playlistId: LIKED_PLAYLIST_ID, name: 'x', isPublic: false, deleted: false, createdAt: 1 },
      ],
      index,
      new Set(),
    );
    expect(actions).toEqual([
      { kind: 'playlist_upsert', playlistId: 'p1', name: 'Road', createdAt: 5 },
      { kind: 'playlist_local', playlistId: 'p1', songId: 'row-origin', ref: A, present: true, addedAt: 6 },
      { kind: 'playlist_online', playlistId: 'p1', ref: A, present: false, addedAt: 6 },
      { kind: 'playlist_online', playlistId: 'p1', ref: B, song: snapshot(B, 'Levitating'), present: true, addedAt: 7 },
    ]);
  });

  it('deletes only playlists the phone has', () => {
    const changes: LibraryChange[] = [
      { kind: 'playlist', rev: 1, playlistId: 'mine', name: 'M', isPublic: false, deleted: true, createdAt: 1 },
      { kind: 'playlist', rev: 2, playlistId: 'never-here', name: 'N', isPublic: false, deleted: true, createdAt: 1 },
    ];
    expect(planInbound(changes, index, new Set(['mine']))).toEqual([{ kind: 'playlist_delete', playlistId: 'mine' }]);
  });
});

describe('phone songs', () => {
  it('only songs from the catalog get a ref', () => {
    expect(refForLocalSong({ id: 'x', originId: 'saavn:q' })).toBe('saavn:q');
    expect(refForLocalSong({ id: 'stream:gaana:9' })).toBe('gaana:9');
    expect(refForLocalSong({ id: 'local-file-1' })).toBeNull();
  });

  it('a local cover file does not travel', () => {
    expect(snapshotOfLocal({ id: 'x', title: 'T', coverImageUri: 'file:///cover.jpg' }, A).artwork).toBe('');
    expect(snapshotOfLocal({ id: 'x', title: 'T', coverImageUri: 'https://c/1.jpg' }, A).artwork).toBe('https://c/1.jpg');
  });
});

describe('opsForFirstSync', () => {
  const phone = {
    likes: [{ ref: A }],
    playlists: [{ id: 'p1', name: 'Mine', items: [{ ref: A }] }],
  };
  const account = { likedRefs: new Set<SongRef>([B]), playlists: new Map([['p1', new Set<SongRef>([B])], ['p2', new Set<SongRef>()]]) };

  it('merge adds the phone and removes nothing', () => {
    expect(opsForFirstSync('merge', phone, account, 100).map(op => op.op)).toEqual(['like', 'playlist_upsert', 'playlist_add']);
  });

  it('account sends nothing', () => {
    expect(opsForFirstSync('account', phone, account, 100)).toEqual([]);
  });

  it("phone makes the account match the phone, in order", () => {
    const ops = opsForFirstSync('phone', phone, account, 100);
    expect(ops.map(op => [op.op, 'ref' in op ? op.ref : 'playlistId' in op ? op.playlistId : ''])).toEqual([
      ['like', A],
      ['playlist_upsert', 'p1'],
      ['playlist_add', A],
      ['unlike', B],
      ['playlist_remove', B],
      ['playlist_delete', 'p2'],
    ]);
    expect(ops.map(op => op.at)).toEqual([100, 101, 102, 103, 104, 105]);
  });
});
