import { AppScreen } from '../components/AppScreen';
import { TypeScale } from '../constants/allegraTheme';
/**
 * Settings, in Allegra's language: one scrolling page of dark sections
 * (components/settings/SettingsKit) in a dark room with the song's glow
 * behind the title (components/settings/SettingsGlow), with jump chips.
 * Every control here changes something.
 */

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import appConfig from '../../app.json';
import { LanguagePickerModal } from '../components/LanguagePickerModal';
import { Toast } from '../components/Toast';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { SETTINGS_TOUR, settingsDials, settingsScene } from '../components/allegra/infoTours';
import { Tactile } from '../components/allegra/motion';
import { useArtworkPalette } from '../components/allegra/useArtworkPalette';
import AllegraAccountSettings from '../components/settings/AllegraAccountSettings';
import DynamicIslandSettings from '../components/settings/DynamicIslandSettings';
import LuvLinkSettings from '../components/settings/LuvLinkSettings';
import DownloadsFolderRows from '../components/settings/DownloadsFolderRows';
import SettingsGlow from '../components/settings/SettingsGlow';
import * as Kit from '../components/settings/SettingsKit';
import { Action, Choice, JumpChips, Row, Section, SettingsAccordion } from '../components/settings/SettingsKit';
import { ShortcutSettings } from '../components/settings/ShortcutSettings';
import { Control, Glass, Motion, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { Colors } from '../constants/colors';
import { SettingsStrings } from '../constants/uiStrings';
import { clearAllData } from '../database/queries';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { readIslandStatus } from '../services/NativeDynamicIsland';
import { convertAudioFileToSong, scanAudioFiles } from '../services/mediaScanner';
import { useLuvsPreferencesStore } from '../store/luvsPreferencesStore';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import { LYRICS_SIZE_MAX, LYRICS_SIZE_MIN, LyricsAlign, LyricsHighlight, PlayerBackground, ReduceEffects, isCardPlayerBackground, useSettingsStore } from '../store/settingsStore';
import { useSongsStore } from '../store/songsStore';
import { TabScreenProps } from '../types/navigation';
import { Button, ConfirmSheet, IconButton, Sheet, SheetScrollView, TactileRow } from '../ui';
import { exportAllSongs, importSongsFromJson, shareExportedFile } from '../utils/exportImport';
import { countOf } from '../utils/formatters';
import * as Haptics from '../utils/haptics';
import { deviceTier } from '../utils/performanceTier';
import { DISPLAY_SIZES, DisplaySize } from '../utils/displaySize';
import { displaySizeAvailable, readDisplaySize, saveDisplaySize } from '../services/displaySizeNative';

// ─── Screen ──────────────────────────────────────────────────────────────────

type Props = TabScreenProps<'Settings'>;

const APP_VERSION = appConfig.expo.version;

const SettingsScreen: React.FC<Props> = ({ route, navigation }) => {
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance(Space.xxl);
  const settings = useSettingsStore();
  // Selectors, not the whole store: this page stays mounted behind the others.
  const fetchSongs = useSongsStore(s => s.fetchSongs);
  const addSong = useSongsStore(s => s.addSong);
  const songs = useSongsStore(s => s.songs);
  const playerCurrentCover = usePlayerStore(state => state.currentSong?.coverImageUri);

  const [, setIsImporting] = React.useState(false);
  const [selectionModalVisible, setSelectionModalVisible] = React.useState(false);
  const [availableAudioFiles, setAvailableAudioFiles] = React.useState<any[]>([]);
  const [selectedFiles, setSelectedFiles] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState('');
  const likedCount = usePlaylistStore(state => state.likedSongIds.size);
  const [hiddenSongsVisible, setHiddenSongsVisible] = React.useState(false);
  const [languagePickerVisible, setLanguagePickerVisible] = React.useState(false);

  // Luvs pulls its feed from whichever languages carry weight, so the row reflects
  // the live store — edits take effect on the next batch the engine requests.
  const preferredLanguages = useLuvsPreferencesStore(s => s.preferredLanguages);
  const activeLanguages = preferredLanguages.filter(l => l.weight > 0).map(l => l.language);
  const luvsLanguageSummary = activeLanguages.length === 0
    ? 'None'
    : activeLanguages.length <= 2
      ? activeLanguages.join(', ')
      : `${activeLanguages.length} selected`;
  const hiddenSongs = useSongsStore(s => s.hiddenSongs);
  const fetchHiddenSongs = useSongsStore(s => s.fetchHiddenSongs);
  const unhideSong = useSongsStore(s => s.hideSong);

  const [notice, setNotice] = React.useState<string | null>(null);
  // Display size lives natively (it must apply before React starts); saving it redraws the screen at that size.
  const [displaySize, setDisplaySize] = React.useState<DisplaySize>(readDisplaySize);
  const changeDisplaySize = React.useCallback((size: DisplaySize) => {
    if (size === displaySize) return;
    setDisplaySize(size);
    if (!saveDisplaySize(size)) { setDisplaySize(readDisplaySize()); setNotice('Could not change the display size'); }
  }, [displaySize]);
  // One question at a time ("Delete all library data", "Reset settings"), asked in a ConfirmSheet.
  const [confirm, setConfirm] = React.useState<{ title: string; body: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void | Promise<void> } | null>(null);

  const handleExport = React.useCallback(async () => {
    try {
      const filePath = await exportAllSongs();
      await shareExportedFile(filePath);
    } catch {
      setNotice('Could not export your library. Try again.');
    }
  }, []);

  const handleImport = React.useCallback(async () => {
    try {
      setIsImporting(true);
      const imported = await importSongsFromJson();
      if (imported > 0) {
        await fetchSongs();
        setNotice(`${imported} ${imported === 1 ? 'song' : 'songs'} imported`);
      }
    } catch {
      setNotice('Could not read that backup. Pick a file exported from LuvLyrics.');
    } finally {
      setIsImporting(false);
    }
  }, [fetchSongs]);

  const handleImportLocalAudio = React.useCallback(async () => {
    try {
      const files = await scanAudioFiles();
      setAvailableAudioFiles(files);
      setSelectedFiles(new Set(files.map((f: any) => f.uri)));
      setSelectionModalVisible(true);
    } catch {
      setNotice('Could not look through this phone for music. Check that LuvLyrics can read your audio.');
    }
  }, []);

  React.useEffect(() => {
    const action = route.params?.action;
    if (!action) return;
    navigation.setParams({ action: undefined });
    if (action === 'import-phone') handleImportLocalAudio();
    if (action === 'hidden-songs') { fetchHiddenSongs(); setHiddenSongsVisible(true); }
  }, [route.params?.action, navigation, handleImportLocalAudio, fetchHiddenSongs]);

  const handleCloseSelectionModal = React.useCallback(() => {
    setSelectionModalVisible(false);
    setSelectedFiles(new Set());
    setSearchQuery('');
  }, []);

  const toggleSelectAll = React.useCallback(() => {
    if (selectedFiles.size === availableAudioFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(availableAudioFiles.map((f: any) => f.uri)));
    }
  }, [selectedFiles.size, availableAudioFiles]);

  const toggleFileSelection = React.useCallback((uri: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri); else next.add(uri);
      return next;
    });
  }, []);

  const filteredAudioFiles = React.useMemo(() =>
    searchQuery.trim() === ''
      ? availableAudioFiles
      : availableAudioFiles.filter((f: any) =>
          (f.filename || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (f.artist || '').toLowerCase().includes(searchQuery.toLowerCase())
        ),
    [availableAudioFiles, searchQuery]
  );

  const handleImportSelected = React.useCallback(async () => {
    const filesToImport = availableAudioFiles.filter((f: any) => selectedFiles.has(f.uri));
    setSelectionModalVisible(false);
    let count = 0;
    for (const file of filesToImport) {
      try {
        const song = await convertAudioFileToSong(file);
        if (song) { await addSong(song); count++; }
      } catch {}
    }
    if (count > 0) {
      await fetchSongs();
      setNotice(`${count} ${count === 1 ? 'song' : 'songs'} added to your library`);
    }
    setSelectedFiles(new Set());
  }, [availableAudioFiles, selectedFiles, addSong, fetchSongs]);

  // A dark room with one glow of the playing cover's colour behind the title
  // (SettingsGlow), dark panels, jump chips that stay under the status bar.
  const hasSong = usePlayerStore(state => !!state.currentSongId);
  const palette = useArtworkPalette(playerCurrentCover);
  const scrollRef = React.useRef<ScrollView>(null);
  const sectionY = React.useRef<Record<string, number>>({});
  const at = (key: string) => (e: LayoutChangeEvent) => { sectionY.current[key] = e.nativeEvent.layout.y; };
  // The page is an accordion: every section is one row showing what it is set to, and one opens at a time.
  // Opening (or jumping to) a section scrolls it to the top once the layout has settled, because the one
  // that was open above it has just closed.
  const [openId, setOpenId] = React.useState<string | null>(null);
  const scrollToSection = React.useCallback((key: string) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY.current[key] ?? 0) - 64), animated: true });
  }, []);
  const toggleSection = React.useCallback((id: string) => {
    setOpenId(current => (current === id ? null : id));
    setTimeout(() => scrollToSection(id), 160);
  }, [scrollToSection]);
  const jump = (key: string) => { setOpenId(key); setTimeout(() => scrollToSection(key), 160); };
  const accordion = React.useMemo(() => ({ openId, toggle: toggleSection }), [openId, toggleSection]);

  // What each closed section says it is set to.
  const BG_NAME: Record<PlayerBackground, string> = { apple: 'Apple Music', blend: 'Apple + glow', youtube: 'YouTube Music', aura: 'Cover glow' };
  const ALIGN_NAME: Record<LyricsAlign, string> = { left: 'left', center: 'centre', right: 'right' };
  const timing = Math.round(settings.lyricsDelay * 10) / 10;
  const summaries = {
    player: `${BG_NAME[settings.playerBackground]} · canvas ${settings.canvasEnabled ? 'on' : 'off'}`,
    playback: `${settings.keepScreenOn ? 'Screen stays on' : 'Screen can sleep'} · haptics ${(settings.hapticsEnabled ?? true) ? 'on' : 'off'}`,
    lyrics: `Size ${settings.lyricsSize} · ${ALIGN_NAME[settings.lyricsAlign]} · ${settings.lyricsHighlight === 'letters' ? 'letter by letter' : 'line by line'} · ${timing === 0 ? 'in sync' : `${timing > 0 ? '+' : ''}${timing.toFixed(1)}s`}`,
    nav: `Library opens on ${settings.libraryStartTab} · widget ${settings.widgetPinnedPlaylistIds.length} pinned`,
    discover: `Languages: ${luvsLanguageSummary.toLowerCase()}`,
    library: `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}${hiddenSongs.length > 0 ? ` · ${hiddenSongs.length} hidden` : ''}`,
    about: `Version ${APP_VERSION}`,
  };

  const bgHint: Record<PlayerBackground, string> = {
    blend: 'The Apple Music room, blending into a soft glow when lyrics are open.',
    apple: 'The cover melting into its own blur, like Apple Music.',
    youtube: 'The cover\u2019s colour washing down into black, with the artwork as a card, like YouTube Music.',
    aura: 'Black through the middle, with two of the cover\u2019s colours glowing in from the top and bottom and drifting slowly.',
  };


  const reduceHint: Record<ReduceEffects, string> = {
    auto: deviceTier() === 'low'
      ? 'This phone gets the lighter effects: glass without live blur and calmer motion, for smoother scrolling.'
      : 'Full effects. The phone switches to lighter ones by itself if it starts dropping frames.',
    on: 'Lighter effects everywhere: glass without live blur and calmer motion, for smoother scrolling.',
    off: 'Full effects, even if this phone struggles with them.',
  };

  return (
    <AppScreen style={styles.container}>
      <SettingsGlow palette={hasSong ? palette : null} />
      <SettingsAccordion.Provider value={accordion}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + Space.xs, paddingBottom: bottom }}
      >
        <View style={styles.hero}>
          <InfoTitleRow><Text style={styles.heroTitle} accessibilityRole="header">Settings</Text><InfoTour label="About Settings" steps={SETTINGS_TOUR} scene={settingsScene} persist={settingsDials} /></InfoTitleRow>
        </View>

        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <JumpChips
              onJump={jump}
              items={[
                { key: 'account', label: 'Account' },
                { key: 'player', label: 'Player' },
                ...(readIslandStatus() ? [{ key: 'island', label: 'Island' }] : []),
                { key: 'playback', label: 'Playback' },
                { key: 'lyrics', label: 'Lyrics' },
                { key: 'nav', label: 'Navigation' },
                { key: 'discover', label: 'Discover' },
                { key: 'together', label: 'LuvLink' },
                { key: 'library', label: 'Library & data' },
                { key: 'about', label: 'About' },
              ]}
            />
          </ScrollView>
        </View>

        <AllegraAccountSettings onLayout={at('account')} onNotice={setNotice} />

        <Section id="player" summary={summaries.player} icon="play-circle-outline" title="Player" lead="How Now Playing and the mini player look." onLayout={at('player')}>
          {displaySizeAvailable() ? (
            <Choice<DisplaySize>
              label="Display size"
              hint="Everything in LuvLyrics at once: text, buttons, covers and the bars. The screen redraws at the new size; music keeps playing."
              value={displaySize}
              options={DISPLAY_SIZES.map(s => ({ value: s.value, label: s.label }))}
              onChange={changeDisplaySize}
            />
          ) : null}
          <Kit.Switch
            label="Apple Music inspired"
            hint="The cover runs full width and melts into its own blur. Off shows a floating artwork card."
            value={settings.appleMusicInspired}
            onChange={settings.setAppleMusicInspired}
          />
          <Kit.Switch
            label="Fluid player (experimental)"
            hint="The player follows your finger from the mini player, and the cover glides between them. Off keeps the classic open."
            value={settings.fluidPlayer}
            onChange={settings.setFluidPlayer}
          />
          {isCardPlayerBackground(settings.playerBackground) ? (
            <Kit.Switch
              label="Full-size cover"
              hint="The cover runs edge to edge at the top, as in YouTube Music. Tapping the cover switches it too."
              value={settings.playerCoverFull}
              onChange={settings.setPlayerCoverFull}
            />
          ) : null}
          <Choice<PlayerBackground>
            label="Player background"
            hint={bgHint[settings.playerBackground]}
            value={settings.playerBackground}
            options={[{ value: 'apple', label: 'Apple Music' }, { value: 'blend', label: 'Apple + glow' }, { value: 'youtube', label: 'YouTube Music' }, { value: 'aura', label: 'Cover glow' }]}
            onChange={settings.setPlayerBackground}
          />
          <Choice<ReduceEffects>
            label="Reduce effects"
            hint={reduceHint[settings.reduceEffects]}
            value={settings.reduceEffects}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
            onChange={settings.setReduceEffects}
          />
          <Kit.Switch
            label="Canvas"
            hint="Looping motion artwork on the cover when a song has one: Echo Canvas, Apple Music, then ArchiveTune."
            value={settings.canvasEnabled}
            onChange={settings.setCanvasEnabled}
          />
          {settings.canvasEnabled ? (
            <Row label="Your own tokens" hint="Optional. Apple Music already works without one. Stored on this phone only." stack>
              {([
                { label: 'Apple MusicKit token', value: settings.appleMusicToken, onChange: settings.setAppleMusicToken, placeholder: 'eyJhbGciOiJFUzI1NiIs\u2026' },
                { label: 'Tidal client token', value: settings.tidalToken, onChange: settings.setTidalToken, placeholder: 'Unlocks Tidal video covers' },
              ] as const).map(field => (
                <View key={field.label} style={styles.tokenField}>
                  <Text style={styles.tokenLabel}>{field.label}{field.value ? ' \u00b7 saved' : ''}</Text>
                  <TextInput
                    style={styles.tokenInput}
                    value={field.value}
                    onChangeText={field.onChange}
                    placeholder={field.placeholder}
                    placeholderTextColor={Signal.inkFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                </View>
              ))}
            </Row>
          ) : null}
        </Section>

        <DynamicIslandSettings onLayout={at('island')} onNotice={setNotice} />

        <Section id="playback" summary={summaries.playback} icon="musical-notes-outline" title="Playback" lead="What happens when you press play." onLayout={at('playback')}>
          <Kit.Switch
            label="Stay on the list when a song starts"
            hint="Off opens Now Playing every time you pick a song."
            value={settings.playInMiniPlayerOnly}
            onChange={settings.setPlayInMiniPlayerOnly}
          />
          <Kit.Switch label="Keep screen on" hint="While Now Playing is open." value={settings.keepScreenOn} onChange={settings.setKeepScreenOn} />
          <Kit.Switch label="Keep playing similar songs" hint="When the queue is about to end, songs like the one playing are added." value={settings.autoQueueRefill ?? true} onChange={settings.setAutoQueueRefill} />
          <Kit.Switch label="Native mini player swipes" hint="Android only. Swiping the mini player to skip runs in Kotlin like the island, so it stays instant while the app is busy. Try it, and turn it off if a swipe feels wrong." value={settings.nativeMiniSwipe ?? false} onChange={settings.setNativeMiniSwipe} />
          <Kit.Switch label="Haptics" hint="Little taps you feel on buttons and swipes." value={settings.hapticsEnabled ?? true} onChange={settings.setHapticsEnabled} />
        </Section>

        <Section id="lyrics" summary={summaries.lyrics} icon="text-outline" title="Lyrics" lead="How lyrics look and keep time." onLayout={at('lyrics')}>
          <LyricsSizeRow size={settings.lyricsSize} align={settings.lyricsAlign} onChange={settings.setLyricsSize} />
          <Choice<LyricsAlign>
            label="Alignment"
            hint="Where lines sit. A song set to centre or right in its lyrics editor keeps that."
            value={settings.lyricsAlign}
            options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}
            onChange={settings.setLyricsAlign}
          />
          <Choice<LyricsHighlight>
            label="Highlight"
            hint={settings.lyricsHighlight === 'letters'
              ? 'Words fill in as they are sung, syllable by syllable when the lyrics are word-timed.'
              : 'The whole sung line lights up at once.'}
            value={settings.lyricsHighlight}
            options={[{ value: 'letters', label: 'Letter by letter' }, { value: 'lines', label: 'Line by line' }]}
            onChange={settings.setLyricsHighlight}
          />
          <Choice<'compact' | 'normal' | 'relaxed'>
            label="Line spacing"
            value={settings.lineSpacing}
            options={[{ value: 'compact', label: 'Tight' }, { value: 'normal', label: 'Normal' }, { value: 'relaxed', label: 'Airy' }]}
            onChange={settings.setLineSpacing}
          />
          <TimingRow value={settings.lyricsDelay} onChange={settings.setLyricsDelay} />
          <Kit.Switch label="Auto-scroll lyrics without timing" hint="Move plain lyrics steadily through the song. Scroll by hand to pause." value={settings.autoScrollPlainLyrics} onChange={settings.setAutoScrollPlainLyrics} />
        </Section>

        <Section id="nav" summary={summaries.nav} icon="navigate-outline" title="Navigation and shortcuts" lead="Voice, Library and your home-screen widget." onLayout={at('nav')}>
          <Kit.Switch label="Voice button" hint="Say a song and it plays." value={settings.micEnabled ?? true} onChange={settings.setMicEnabled} />
          {(settings.micEnabled ?? true) ? (
            <Choice<'hold' | 'tap'>
              label="Voice button works by"
              hint={(settings.voiceMode ?? 'hold') === 'hold'
                ? 'Hold, say a song, let go. A quick tap listens until you stop talking.'
                : 'Tap to start, tap again (or stop talking) to search.'}
              value={settings.voiceMode ?? 'hold'}
              options={[{ value: 'hold', label: 'Hold to talk' }, { value: 'tap', label: 'Tap to talk' }]}
              onChange={settings.setVoiceMode}
            />
          ) : null}
          <ShortcutSettings />
        </Section>

        <Section id="discover" summary={summaries.discover} icon="compass-outline" title="Discover" lead="What Luvs and Stream bring you." onLayout={at('discover')}>
          <Action label="Song languages" hint="Luvs, mood mixes and new songs lean towards these." value={luvsLanguageSummary} onPress={() => setLanguagePickerVisible(true)} />
          <Kit.Switch label="Luvs clips start at the hook" hint="Jump straight to the best part of each song." value={settings.luvsStartAtHook} onChange={settings.setLuvsStartAtHook} />
          <Kit.Switch label="YouTube video preview" hint="Beta. Shows a song's video in the player; needs your own YouTube Data API key." value={settings.ytVideoPreview} onChange={settings.setYtVideoPreview} />
          {settings.ytVideoPreview ? (
            <Row label="YouTube API key" hint="console.cloud.google.com → enable YouTube Data API v3 → Credentials → Create API key." stack>
              <TextInput
                style={styles.tokenInput}
                value={settings.youtubeApiKey}
                onChangeText={settings.setYoutubeApiKey}
                placeholder="AIzaSy\u2026"
                placeholderTextColor={Signal.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Row>
          ) : null}
        </Section>

        <LuvLinkSettings onLayout={at('together')} onNotice={setNotice} />

        <Section id="library" summary={summaries.library} icon="folder-open-outline" title="Library and data" lead="Your songs, backups and clean-up." onLayout={at('library')}>
          <DownloadsFolderRows onNotice={setNotice} />
          <Action label="Add songs from this phone" hint="Find music files already on your device." onPress={handleImportLocalAudio} />
          <Action label="Export library" hint="Songs, lyrics and playlists as one file." onPress={handleExport} />
          <Action label="Import a backup" onPress={handleImport} />
          <Action label="Hidden songs" value={`${hiddenSongs.length}`} onPress={() => { fetchHiddenSongs(); setHiddenSongsVisible(true); }} />
          <Action
            label="Delete all library data"
            hint="Every song and playlist on this phone. This cannot be undone."
            destructive
            onPress={() => setConfirm({
              title: 'Delete all library data?',
              body: 'This permanently deletes every song and playlist on this phone. It cannot be undone.',
              confirmLabel: 'Delete everything',
              destructive: true,
              onConfirm: async () => { await clearAllData(); await fetchSongs(); },
            })}
          />
        </Section>

        <Section id="about" summary={summaries.about} icon="information-circle-outline" title="About" lead="Version, credits and a fresh start." onLayout={at('about')}>
          <Row label="LuvLyrics" hint={`Version ${APP_VERSION}. ${countOf(songs.length, 'song')}, ${likedCount} liked.`} />
          <Row
            label="Credits"
            hint="Music data from YouTube Music, audio from Saavn and Gaana, lyrics from LRCLIB and community providers, canvases from Echo Canvas and Apple Music. Design after Allegra."
          />
          <Kit.Switch label="Show frame rate" hint="For checking smoothness." value={settings.showPerformanceHUD} onChange={settings.setShowPerformanceHUD} />
          <Action
            label="Reset settings"
            hint="Put everything on this page back to how it started. Your songs stay."
            onPress={() => setConfirm({
              title: 'Reset settings?',
              body: 'Every setting goes back to its default. Your library is not touched.',
              confirmLabel: 'Reset',
              onConfirm: () => settings.resetToDefaults(),
            })}
          />
        </Section>
      </ScrollView>
      </SettingsAccordion.Provider>

      {/* ── Alerts & Utility Modals ──────────────────────────────────────────── */}

      <LanguagePickerModal
        visible={languagePickerVisible}
        onClose={() => setLanguagePickerVisible(false)}
      />

      <Toast visible={notice !== null} message={notice ?? ''} type="info" onDismiss={() => setNotice(null)} />
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body}
        confirmLabel={confirm?.confirmLabel ?? ''}
        destructive={confirm?.destructive}
        onConfirm={() => { const run = confirm?.onConfirm; setConfirm(null); void run?.(); }}
        onClose={() => setConfirm(null)}
      />


      <Sheet visible={selectionModalVisible} onClose={handleCloseSelectionModal} title={`Select songs (${selectedFiles.size}/${availableAudioFiles.length})`} tall keyboard>
        <View style={styles.searchBarContainer}>
          <Ionicons name="search" size={18} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchBarInput} placeholder="Search songs…" placeholderTextColor={Colors.textMuted}
            value={searchQuery} onChangeText={setSearchQuery} autoCapitalize="none" autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <IconButton icon="close-circle" size="sm" variant="plain" label="Clear search" onPress={() => setSearchQuery('')} />
          )}
        </View>
        <TactileRow
          style={styles.selectAllButton}
          onPress={toggleSelectAll}
          accessibilityRole="checkbox"
          accessibilityLabel="Select all"
          accessibilityState={{ checked: selectedFiles.size === availableAudioFiles.length }}
        >
          <Ionicons name={selectedFiles.size === availableAudioFiles.length ? 'checkbox' : 'square-outline'} size={24} color={Signal.ink} />
          <Text style={styles.selectAllText}>Select all</Text>
        </TactileRow>
        <SheetScrollView style={styles.selectionList} keyboardShouldPersistTaps="handled">
          {filteredAudioFiles.length === 0 && searchQuery.trim() !== '' ? (
            <View style={styles.emptySearchContainer}>
              <Ionicons name="search-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptySearchText}>No songs match "{searchQuery}"</Text>
            </View>
          ) : (
            filteredAudioFiles.map(file => (
              <TactileRow
                key={file.uri}
                style={styles.selectionItem}
                onPress={() => toggleFileSelection(file.uri)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selectedFiles.has(file.uri) }}
              >
                <Ionicons name={selectedFiles.has(file.uri) ? 'checkbox' : 'square-outline'} size={24} color={selectedFiles.has(file.uri) ? Signal.ink : Colors.textSecondary} />
                <View style={styles.selectionItemInfo}>
                  <Text style={styles.selectionItemTitle} numberOfLines={1}>{file.filename.replace(/\.[^/.]+$/, '')}</Text>
                  <Text style={styles.selectionItemArtist} numberOfLines={1}>{file.artist || file.album || 'Unknown'}</Text>
                </View>
              </TactileRow>
            ))
          )}
        </SheetScrollView>
        <View style={styles.selectionActions}>
          <View style={styles.selectionSlot}>
            <Button label={SettingsStrings.cancel} variant="glass" block onPress={handleCloseSelectionModal} />
          </View>
          <View style={styles.selectionSlot}>
            <Button label={`Import ${selectedFiles.size}`} variant="primary" block disabled={selectedFiles.size === 0} onPress={handleImportSelected} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={hiddenSongsVisible} onClose={() => setHiddenSongsVisible(false)} title={`Hidden songs (${hiddenSongs.length})`}>
        <SheetScrollView style={[styles.selectionList, { maxHeight: 500 }]} keyboardShouldPersistTaps="handled">
          {hiddenSongs.length === 0 ? (
            <View style={styles.emptySearchContainer}>
              <Ionicons name="eye-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptySearchText}>No hidden songs</Text>
            </View>
          ) : (
            hiddenSongs.map(song => (
              <View key={song.id} style={styles.selectionItem}>
                {song.coverImageUri
                  ? <Image source={{ uri: song.coverImageUri }} style={{ width: 44, height: 44, borderRadius: 8 }} />
                  : <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: Surface.control, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="disc" size={24} color={Signal.inkMuted} />
                    </View>
                }
                <View style={styles.selectionItemInfo}>
                  <Text style={styles.selectionItemTitle} numberOfLines={1}>{song.title}</Text>
                  <Text style={styles.selectionItemArtist} numberOfLines={1}>{song.artist || 'Unknown Artist'}</Text>
                </View>
                <Button label={SettingsStrings.unhide} variant="glass" size="sm" onPress={() => unhideSong(song.id, false)} />
              </View>
            ))
          )}
        </SheetScrollView>
        <View style={styles.selectionActions}>
          <View style={styles.selectionSlot}>
            <Button label={SettingsStrings.close} variant="glass" block onPress={() => setHiddenSongsVisible(false)} />
          </View>
        </View>
      </Sheet>

    </AppScreen>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

/** Lyrics text size: a sample line resizes under the thumb; the size saves on release. */
const LyricsSizeRow: React.FC<{ size: number; align: LyricsAlign; onChange: (size: number) => void }> = ({ size, align, onChange }) => {
  const [live, setLive] = React.useState(size);
  React.useEffect(() => { setLive(size); }, [size]);
  const shown = Math.round(live);
  return (
    <Row label={`Text size  ${shown}`} hint="Slide to size the lines you sing along to." stack>
      <Text style={[styles.lyricsSample, { fontSize: shown, lineHeight: Math.round(shown * 1.22), textAlign: align }]} numberOfLines={2}>
        Sing it back to me
      </Text>
      <Slider
        style={styles.slider}
        minimumValue={LYRICS_SIZE_MIN}
        maximumValue={LYRICS_SIZE_MAX}
        step={1}
        value={size}
        onValueChange={setLive}
        onSlidingComplete={onChange}
        minimumTrackTintColor={Signal.wave}
        maximumTrackTintColor={Glass.hairlineStrong}
        thumbTintColor={Signal.wave}
      />
    </Row>
  );
};

/**
 * Lyrics timing: the readout follows the thumb; the setting saves on release.
 * "Reset to sync" appears only while the offset is off zero, and puts it back
 * to exactly in sync in one tap.
 */
const TimingRow: React.FC<{ value: number; onChange: (seconds: number) => void }> = ({ value, onChange }) => {
  const reduce = useReducedMotion();
  const [live, setLive] = React.useState(value);
  React.useEffect(() => { setLive(value); }, [value]);
  const shown = Math.round(live * 10) / 10;
  const label = shown === 0 ? 'In sync' : `${shown > 0 ? '+' : ''}${shown.toFixed(1)}s`;
  const off = Math.abs(shown) > 0.04;
  return (
    <Row label={`Timing  ${label}`} hint="Lyrics running late? Slide right. Early? Slide left." stack>
      <Slider
        style={styles.slider}
        minimumValue={-5.0}
        maximumValue={5.0}
        step={0.1}
        value={value}
        onValueChange={setLive}
        onSlidingComplete={onChange}
        minimumTrackTintColor={Signal.wave}
        maximumTrackTintColor={Glass.hairlineStrong}
        thumbTintColor={Signal.wave}
      />
      {off ? (
        <Animated.View entering={reduce ? undefined : FadeIn.duration(Motion.duration.base)} exiting={reduce ? undefined : FadeOut.duration(Motion.duration.fast)} style={styles.resetWrap}>
          <Tactile
            onPress={() => { Haptics.selectionAsync().catch(() => {}); setLive(0); onChange(0); }}
            accessibilityRole="button"
            accessibilityLabel="Reset lyrics timing to in sync"
            style={styles.resetPill}
          >
            <Ionicons name="refresh" size={14} color={Signal.waveInk} />
            <Text style={styles.resetText}>Reset to sync</Text>
          </Tactile>
        </Animated.View>
      ) : null}
    </Row>
  );
};

const styles = StyleSheet.create({
  lyricsSample: { color: Signal.ink, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  hero: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  heroTitle: { color: Signal.ink, fontSize: TypeScale.page, fontWeight: '700' },
  slider: { width: '100%', height: 36 },
  resetWrap: { alignItems: 'flex-start', marginTop: 4 },
  resetPill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: Control.target, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: Signal.wave },
  resetText: { color: Signal.waveInk, fontSize: TypeScale.meta, fontWeight: '600' },
  tokenField: { marginBottom: 12 },
  tokenLabel: { color: Signal.inkSoft, fontSize: TypeScale.meta, fontWeight: '600', marginBottom: 6 },
  tokenInput: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 16,
    color: Signal.ink,
    fontSize: TypeScale.body,
    backgroundColor: Glass.fillLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairline,
  },
  container: { flex: 1 },

  // Selection modal
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: Glass.fillLight, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline },
  searchBarInput: { flex: 1, fontSize: TypeScale.body, color: Colors.textPrimary },
  emptySearchContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 },
  emptySearchText: { fontSize: TypeScale.body, color: Colors.textMuted, textAlign: 'center' },
  selectAllButton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Glass.hairline },
  selectAllText: { fontSize: TypeScale.body, fontWeight: '600', color: Signal.ink },
  selectionList: { maxHeight: 400 },
  selectionItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  selectionItemInfo: { flex: 1 },
  selectionItemTitle: { fontSize: TypeScale.body, fontWeight: '600', color: Colors.textPrimary },
  selectionItemArtist: { fontSize: TypeScale.meta, color: Colors.textSecondary, marginTop: 2 },
  selectionActions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 18 },
  selectionSlot: { flex: 1 },
});

export default SettingsScreen;
