/**
 * Round 7 (owner-approved 2026-11-06): the rules every list, the shell, chips, buttons and menus share. These read the
 * source, as the other design guards do, so a later change that quietly undoes one of them fails here.
 */
// Native animation curves do not load in the Node test runner.
jest.mock('react-native-reanimated', () => ({ Easing: { bezier: () => (t: number) => t } }));

import * as fs from 'fs';
import * as path from 'path';
import { Control, Radius } from '../constants/allegraTheme';
import { chipLeadingIcon, COMPACT_HEIGHT, identityMeta, songRowSubtitle } from './round7Rules';

const SRC = path.resolve(__dirname, '..');
// Line endings normalised: a Windows checkout has CRLF and the patterns below match on \n.
const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');
const ANDROID = path.resolve(SRC, '../android/app/src/main/java/com/lyricflow/app/views');

describe('item 9 and the lists rule: one song row everywhere', () => {
  it('is 56 tall with a 44 cover and 6dp corners', () => {
    expect(Control.row).toBe(56);
    expect(Control.rowArtwork).toBe(44);
    expect(Radius.cover).toBe(6);
  });

  it('keeps the title and the artist to one line each, ending in an ellipsis', () => {
    for (const file of ['ui/SongRow.tsx', 'ui/ListRow.tsx']) {
      const source = read(file);
      expect(source).not.toMatch(/numberOfLines=\{2\}>\{title\}/);
      expect(source).toMatch(/numberOfLines=\{1\} ellipsizeMode="tail">\{title\}/);
    }
  });

  it('puts the artist and the caller note on the second line, never empty parts', () => {
    expect(songRowSubtitle('Mira Vale', undefined, false)).toBe('Mira Vale');
    expect(songRowSubtitle('Mira Vale', 'Album', true)).toBe('Mira Vale · Album · Playing');
    expect(songRowSubtitle(undefined, undefined, false)).toBe('');
  });

  it('artist and album pages use the shared row', () => {
    expect(read('components/browse/BrowseShelf.tsx')).toMatch(/<SharedSongRow /);
  });

  it('Up next draws the same row geometry natively', () => {
    const queue = fs.readFileSync(path.join(ANDROID, 'NativeQueueListView.kt'), 'utf8');
    expect(queue).toMatch(/const val ROW_DP = 56f/);
    expect(queue).toMatch(/const val ART_DP = 44f/);
    expect(queue).toMatch(/const val ART_RADIUS_DP = 6f/);
  });
});

describe('item 9: Download is back beside the ⋮ on Stream and Search', () => {
  it('passes a save action to every catalog row on Stream and Search', () => {
    const stream = read('screens/StreamScreen.tsx');
    expect(stream).toMatch(/onSave=\{i => save\(quick\[i\]\)\}/);
    expect(read('screens/SearchScreen.tsx')).toMatch(/onSave=\{\(\) => save\(s\)\}/);
    expect(read('components/stream/StreamHome.tsx')).toMatch(/<DownloadButton song=\{item\.download\} onSave=\{onSave\} \/>/);
  });

  it('gives Download its own 48dp target with no slop over the row', () => {
    const button = read('components/stream/DownloadButton.tsx');
    expect(button).toMatch(/hit: \{ width: Control\.target, minHeight: Control\.row/);
    expect(button).not.toMatch(/hitSlop=\{8\}/);
  });
});

describe('items 3 and 8: the bottom surface and navigation', () => {
  it('draws nothing behind the selected tab, natively or in the fallback', () => {
    const bar = fs.readFileSync(path.join(ANDROID, 'NativeTabBarView.kt'), 'utf8');
    const v6 = bar.slice(bar.indexOf('private fun drawV6'), bar.indexOf('private fun barTop'));
    expect(v6).not.toMatch(/0xFF22252C/);
    expect(v6).toMatch(/isFocused/);
    expect(read('components/V6TabBar.tsx')).not.toMatch(/styles\.selected/);
  });

  // 2026-11-15 (owner): full width with the player sheet's outline and a top rim, so closing the player ends on one
  // shape (navigation/miniShell); the play control keeps its inset.
  it('gives the mini player a top rim on the sheet’s outline and rests the bottom navigation on black', () => {
    const player = read('components/PillPlayer.tsx');
    expect(player).toMatch(/<MiniPlayerGlow uri=\{coverImageUri\} active=\{!sheetUp && !createOpen\} \/>/);
    expect(player).toMatch(/\.\.\.miniShellOutline/);
    expect(player).toMatch(/borderTopWidth: StyleSheet\.hairlineWidth, borderColor: ShellFrost\.miniRim/);
    expect(player).toMatch(/playButtonOffset: \{ marginRight: MINI_PLAY_OFFSET \}/);
    const bar = read('components/V6TabBar.tsx');
    expect(bar).toMatch(/colors=\{ShellFrost\.navSurfaceColors\}/);
    expect(bar).toMatch(/colors=\{ShellFrost\.navFadeColors\}/);
    expect(bar).toMatch(/navTopEdge/);
    expect(bar).toMatch(/<LinearGradient pointerEvents="none" colors=\{ShellFrost\.navFadeColors\} locations=\{ShellFrost\.navFadeStops\}/);
    expect(bar).toMatch(/top: -ShellFrost\.navFade/);
  });

  it('shows Liked songs with no cover over a forest-green wash, a big title and a round Play (1.43.0)', () => {
    const detail = read('screens/PlaylistDetailScreen.tsx');
    expect(detail).toMatch(/const isLiked = playlistId === LIKED_PLAYLIST_ID;/);
    expect(detail).toMatch(/const renderHeader = \(\) => isLiked \? renderLikedHeader\(\) : renderPlaylistHeader\(\);/);
    expect(detail).toMatch(/colors=\{ShellFrost\.likedWashColors\}/);
    // 1.44.0 (owner: "a lil too big"): a 28pt title, icon-only download and sort, a 48dp Play.
    expect(detail).toMatch(/<Text variant="page" numberOfLines=\{2\} accessibilityRole="header">\{playlistName\}<\/Text>/);
    expect(detail).not.toMatch(/variant="display"/);
    expect(detail).toMatch(/<OfflineControl iconOnly playlistId=\{playlistId\}/);
    expect(detail).toMatch(/icon="swap-vertical" label=\{`Sort liked songs, \$\{sortLabel\}`\}/);
    expect(detail).toMatch(/roundPlay: \{ width: Control\.target, height: Control\.target/);
    const liked = detail.slice(detail.indexOf('const renderLikedHeader'), detail.indexOf('const renderRoundPlay'));
    expect(liked).not.toMatch(/size="lg"/);
    // A premium two-tone forest wash running diagonally into the page.
    expect(detail).toMatch(/start=\{ShellFrost\.likedWashStart\} end=\{ShellFrost\.likedWashEnd\}/);
    expect(detail).toMatch(/<ListRow title="Add to this playlist" icon="add"/);
    // Both headers' washes run from the very top of the screen.
    expect(detail).toMatch(/contentContainerStyle: \{ paddingBottom: bottom \}/);
    const theme = read('constants/allegraTheme.ts');
    expect(theme).toMatch(/likedWashColors: \['#2F8058', '#1C5C3D', '#0F3424', '#07170F', 'rgba\(5, 5, 5, 0\)'\]/);
    expect(theme).toMatch(/likedWashStops: \[0, 0\.28, 0\.58, 0\.82, 1\]/);
  });

  it('opens the profile menu smoothly on true black (1.44.0, owner)', () => {
    const menu = read('components/nav/ProfileMenu.tsx');
    // Stays up until it has slid out, opens on a spring, follows a swipe shut.
    expect(menu).toMatch(/<Modal visible=\{mounted\}/);
    expect(menu).toMatch(/if \(finished\) runOnJS\(setMounted\)\(false\)/);
    expect(menu).toMatch(/withSpring\(1, Motion\.spring\.open\)/);
    expect(menu).toMatch(/<GestureDetector gesture=\{swipe\}>/);
    expect(menu).toMatch(/<GestureHandlerRootView/);
    // True black, no grey tiles behind the icons.
    expect(menu).toMatch(/backgroundColor: ShellFrost\.menuBlack/);
    expect(menu).not.toMatch(/Surface\.raised|Surface\.control/);
    expect(menu).toMatch(/iconStyle="plain"/);
    expect(read('constants/allegraTheme.ts')).toMatch(/menuBlack: '#000000'/);
  });

  it('lays a playlist out like the owner’s Spotify screenshots (1.44.0)', () => {
    const detail = read('screens/PlaylistDetailScreen.tsx');
    const header = detail.slice(detail.indexOf('const renderPlaylistHeader'), detail.indexOf('const renderHeader'));
    // Top to bottom: Find in playlist, the cover (it turns into song cards), the name on the left, its length,
    // download and share | shuffle and the round Play, then Add / Edit / Name and details / Sort.
    const order = ['accessibilityLabel="Find in playlist"', '<CoverFlipCard', '<Text variant="page"', 'time-outline',
      '<OfflineControl', 'label="Share playlist"', 'label="Shuffle playlist"', "renderRoundPlay('playlist')",
      '<Chip label="Add"', "isEditMode ? 'Done' : 'Edit'", '<Chip label="Name and details"', 'icon="swap-vertical"'];
    const at = order.map(part => header.indexOf(part));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The wash is a calm tone of the cover (playlistPage); back and ⋮ are plain icons, no disc (owner, 2026-11-13).
    expect(header).toMatch(/colors=\{wash\} locations=\{PLAYLIST_WASH_STOPS\}/);
    expect(detail).toMatch(/icon="arrow-back" label="Back" variant="plain"/);
    expect(detail).toMatch(/icon="ellipsis-vertical" label="Playlist options" variant="plain"/);
  });

  it('shows the mini player title in bold with the artist under it, and Spotify\'s saved mark (1.43.0)', () => {
    const pill = read('components/PillPlayer.tsx');
    expect(pill).toMatch(/<Marquee text=\{displayed\.title\} style=\{styles\.line\}/);
    expect(pill).toMatch(/\{status === 'error' \? 'Couldn’t play, tap to retry' : displayed\.artist \|\| ' '\}/);
    expect(pill).toMatch(/name=\{liked \? 'checkmark-circle' : 'add-circle-outline'\}/);
    // The progress line stays on the card's top edge (owner).
    expect(pill.indexOf('<MiniScrubber ')).toBeLessThan(pill.indexOf('<Animated.View style={[styles.row'));
  });

  it('scrubs the mini player on the UI thread with no thumb and no time readout (1.41.0)', () => {
    const pill = read('components/PillPlayer.tsx');
    expect(pill).toMatch(/<MiniScrubber /);
    expect(pill).not.toMatch(/setDrag|styles\.thumb|styles\.preview/);
    expect(read('components/MiniScrubber.tsx')).not.toMatch(/runOnJS\(true\)/);
  });
});

describe('items 1, 4 and 7: capsules', () => {
  it('draws chips and buttons as capsules', () => {
    expect(read('ui/Chip.tsx')).toMatch(/borderRadius: Radius\.pill,\n {4}backgroundColor: Glass\.chip/);
    expect(read('ui/Button.tsx')).toMatch(/paddingHorizontal: Space\.lg - Space\.xxs,\n {4}borderRadius: Radius\.pill/);
  });

  it('marks a chosen chip with a check, so it reads without colour', () => {
    expect(chipLeadingIcon(true)).toBe('checkmark');
    expect(chipLeadingIcon(false)).toBeUndefined();
    expect(chipLeadingIcon(true, 'time-outline')).toBe('time-outline');
  });

  it('draws a compact capsule smaller than its 48dp target', () => {
    expect(COMPACT_HEIGHT).toBe(40);
    expect(COMPACT_HEIGHT).toBeLessThan(Control.target);
  });

  // A playlist moved to Spotify's round Play with a shuffle icon in 1.44.0 (owner's screenshots, tested above).
  it('pairs a filled Play with a compact Shuffle on artist and album pages', () => {
    for (const file of ['screens/ArtistScreen.tsx', 'screens/CollectionScreen.tsx']) {
      const source = read(file);
      expect(source).toMatch(/variant="primary"/);
      expect(source).toMatch(/label="Shuffle"[^>]*size="compact"|size="compact"[^>]*label="Shuffle"/);
    }
  });
});

describe('item 2: action sheets open on their identity', () => {
  it('says what the sheet is about in one line', () => {
    expect(identityMeta('Song', 'Mira Vale', '3:33')).toBe('Song · Mira Vale · 3:33');
    expect(identityMeta('Mix', '25 songs', undefined, '')).toBe('Mix · 25 songs');
  });

  it('uses the identity header on the song and mix sheets', () => {
    // Stream's long press opens the one song actions sheet (2026-11-13), which carries the identity header.
    expect(read('components/stream/useStreamSongActions.tsx')).toMatch(/<MiniSongMenu /);
    expect(read('components/player/MiniSongMenu.tsx')).toMatch(/<SheetIdentity /);
    // Library and playlist rows open the same sheet through useSongActions.
    expect(read('components/library/useSongActions.tsx')).toMatch(/<MiniSongMenu /);
    expect(read('screens/StreamScreen.tsx')).toMatch(/<SheetIdentity title=\{mixActions\.title\}/);
  });
});

describe('item 6: voice search lives in the Search field', () => {
  it('puts the mic and the listening panel in the field, and keeps the card out of the way', () => {
    const search = read('screens/SearchScreen.tsx');
    expect(search).toMatch(/\{voice\.trailing\}/);
    expect(search).toMatch(/\{voice\.panel\}/);
    expect(read('components/VoiceSearchCard.tsx')).toMatch(/const visible = phase !== 'idle' && !inField;/);
  });
});
