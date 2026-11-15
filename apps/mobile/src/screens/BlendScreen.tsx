import { AppScreen } from '../components/AppScreen';
import { TypeScale } from '../constants/allegraTheme';
/**
 * One Blend on the phone: its cover (the first four songs), who is in it, the match, a story you can
 * watch full screen (components/blend/BlendStoryPlayer) and the day's tracks with their covers. Playing
 * goes through the phone's own playback path (StreamService.play) with the Blend as the queue.
 * The hero is the Blend as light (components/blend/BlendStage): the orbs drift together until they
 * overlap by the match. The first visit to each day's build plays that as the reveal, in the hero
 * itself; the lens chips light the chosen person's orb. Transform and opacity only.
 */
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { artistName, BLEND_TEXT, changeText, learningOffText } from '@shared/blendCopy';
import { utcDay } from '@shared/blendLimits';
import type { BlendDetail } from '@shared/blendView';
import type { SongSnapshot } from '@shared/songRef';

import { Artwork } from '../components/allegra/Artwork';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { BLEND_TOUR, blendScene } from '../components/allegra/infoTours';
import { RiseIn } from '../components/allegra/motion';
import { discColour, MemberDiscs, blendStyles as s } from '../components/blend/BlendParts';
import { BlendStage } from '../components/blend/BlendStage';
import { BlendStoryPlayer } from '../components/blend/BlendStoryPlayer';
import { Glass, Motion, Radius, Signal, Space } from '../constants/allegraTheme';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { useAccount } from '../services/account/AccountProvider';
import { blendTrackSong, getBlend, getInvite, inviteUrl, leaveBlend } from '../services/blend/blendApi';
import { watchStaleBlend } from '../services/blend/staleRefresh';
import { StreamService } from '../services/stream/StreamService';
import type { LibraryStackParamList } from '../types/navigation';
import { Button, ConfirmSheet, Tactile } from '../ui';
import { countOf } from '../utils/formatters';
import { shuffled } from '../utils/shuffle';

const revealKey = (detail: BlendDetail): string => `blend-revealed:${detail.members.find(member => member.isYou)?.userId ?? 'guest'}:${detail.id}:${detail.builtFor}:${detail.buildVersion ?? 0}`;

export const BlendScreen: React.FC = () => {
  const route = useRoute<RouteProp<LibraryStackParamList, 'Blend'>>();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const account = useAccount();
  const token = account.signedIn ? account.token : null;
  const [detail, setDetail] = useState<BlendDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [leaveConfirmationOpen, setLeaveConfirmationOpen] = useState(false);
  const [pulse, setPulse] = useState(0);
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const reducedMotion = useReducedMotion();
  const closeStory = useCallback(() => setWatching(false), []);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  // Only the newest read may land: a switch of account or Blend, or a slower earlier read, is dropped.
  const request = useRef(0);
  const shown = useRef<BlendDetail | null>(null);
  shown.current = detail;
  useEffect(() => { request.current += 1; setDetail(null); setError(null); setRefreshFailed(false); setRevealing(false); setFilter(null); setWatching(false); setLeaveConfirmationOpen(false); }, [account.profile?.userId, route.params.blendId]);

  /** Resolves true once a fresh (not stale) build is showing. */
  const load = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    const mine = ++request.current;
    const result = await getBlend(token, route.params.blendId);
    if (request.current !== mine) return false;
    if (result.ok === false) {
      // A failed refresh keeps the Blend already on screen; only a first load (or a Blend that is gone) shows the error.
      if (result.status !== 404 && shown.current?.id === route.params.blendId) { setRefreshFailed(true); return false; }
      setError(result.status === 404 ? BLEND_TEXT.notfound : result.error);
      return false;
    }
    // Decide the reveal before the first paint of the hero, so the orbs never jump back apart.
    let reveal = false;
    if (result.data.state === 'ready' && result.data.members.length >= 2) {
      const seen = await AsyncStorage.getItem(revealKey(result.data)).catch(() => null);
      if (request.current !== mine) return false;
      reveal = seen !== '1';
    }
    setDetail(result.data);
    setError(null);
    setRefreshFailed(false);
    setRevealing(reveal);
    setPulse((count) => count + 1);
    return !result.data.stale;
  }, [route.params.blendId, token]);

  useEffect(() => { void load(); }, [load]);

  // Another member's build is in flight (or the last one failed): check back a few times, as the website does.
  const waitingForBuild = !!detail && detail.stale && detail.members.length >= 2;
  // Restarts on coming back to the screen: the watch stops scheduling while the screen is hidden.
  useEffect(() => {
    if (!waitingForBuild || !focused) return undefined;
    return watchStaleBlend(load, () => focusedRef.current);
  }, [waitingForBuild, focused, load]);

  const tracks = useMemo(() => (detail ? (filter ? detail.tracks.filter((track) => track.for.includes(filter)) : detail.tracks) : []), [detail, filter]);
  const songs = useMemo(() => tracks.map(blendTrackSong), [tracks]);

  const finishReveal = (): void => {
    setRevealing(false);
    if (detail) AsyncStorage.setItem(revealKey(detail), '1').catch(() => undefined);
  };

  const invite = async (): Promise<void> => {
    if (!token || !detail) return;
    const result = await getInvite(token, detail.id);
    if (result.ok === true) await Share.share({ message: `Blend with me on Allegra: ${inviteUrl(result.data)}` }).catch(() => undefined);
    else Alert.alert('Invite unavailable', result.error);
  };

  const leave = (): void => {
    if (!token || !detail) return;
    setLeaveConfirmationOpen(true);
  };

  const confirmLeave = (): void => {
    if (!token || !detail) return;
    setLeaveConfirmationOpen(false);
    void leaveBlend(token, detail.id).then((result) => {
      if (result.ok === true) navigation.navigate('Blends');
      else Alert.alert('That did not work', result.error);
    });
  };

  if (error || !detail) {
    return (
      <SafeAreaView style={s.screen} edges={['top']}>
        <View style={s.panel}>
          <Text style={s.panelBody}>{error ?? (!account.loading && !account.signedIn ? 'Sign in to see this Blend.' : 'Loading your Blend…')}</Text>
          {error && token ? <Tactile accessibilityRole="button" accessibilityLabel="Retry loading Blend" onPress={() => { setError(null); void load(); }}><Text style={s.panelBody}>Try again</Text></Tactile> : null}
          {!account.loading && !account.signedIn ? <Tactile accessibilityRole="button" accessibilityLabel="Sign in to see this Blend" onPress={() => { void account.signInWithGoogle(); }}><Text style={s.panelBody}>Sign in</Text></Tactile> : null}
        </View>
      </SafeAreaView>
    );
  }

  const group = detail.members.length > 2;
  const pair = detail.pairs[0];
  const match = group && detail.pairs.length > 0 ? Math.round(detail.pairs.reduce((total, item) => total + item.match, 0) / detail.pairs.length) : pair?.match;
  const ready = detail.state === 'ready' && detail.members.length >= 2;
  const playFromStory = (song: SongSnapshot | null): void => {
    const all = detail.tracks.map(blendTrackSong);
    if (!song) { if (all.length) StreamService.play(all, 0); return; }
    const at = detail.tracks.findIndex((track) => track.song.ref === song.ref);
    if (at >= 0) StreamService.play(all, at);
    else StreamService.play([blendTrackSong({ song, for: [], kind: 'pick' })], 0);
  };
  const meta = [
    match === undefined || detail.members.length < 2 ? 'Waiting for your friend' : null,
    !group && pair?.confidence === 'low' ? BLEND_TEXT.lowconfidence : null,
    ready ? countOf(detail.tracks.length, 'song') : null,
    !detail.stale && detail.builtFor === utcDay(Date.now()) ? 'Updated today' : null,
  ].filter(Boolean).join(' · ');

  return (
    <AppScreen style={s.screen}>
      <FlatList
        data={detail.state === 'ready' ? tracks : []}
        // Keyed by the lens too: switching person re-deals the list (rows rise in, a 40ms stagger).
        keyExtractor={(track) => `${filter ?? 'all'}:${track.song.ref}`}
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + Space.sm }}>
            <RiseIn style={styles.hero}>
              <BlendStage
                key={revealing ? 'reveal' : 'stage'}
                members={detail.members}
                match={detail.members.length >= 2 ? match : undefined}
                group={group}
                intro={revealing}
                onIntroDone={finishReveal}
                focus={filter}
                onInvite={() => void invite()}
                pulse={pulse}
              />
              <InfoTitleRow style={{ justifyContent: 'center', marginTop: Space.sm }}><Text style={[styles.name, { marginTop: 0 }]} numberOfLines={2} accessibilityRole="header">{detail.name}</Text><InfoTour label="How this Blend works" steps={BLEND_TOUR} scene={blendScene} /></InfoTitleRow>
              {match !== undefined && detail.members.length >= 2 ? (
                <View style={styles.matchRow} accessible accessibilityLabel={`${match} percent ${group ? 'group' : 'taste'} match`}>
                  <Text style={styles.matchFigure}>{match}%</Text>
                  <Text style={styles.matchLabel}>{group ? 'group match' : 'taste match'}</Text>
                </View>
              ) : null}
              <Text style={styles.meta}>{meta}</Text>
              <View style={styles.primary}>
                {ready ? (
                  <Button label="Play Blend" icon="play" variant="primary" block disabled={songs.length === 0} onPress={() => { if (songs.length) StreamService.play(songs, 0); }} accessibilityLabel={`Play ${detail.name}`} />
                ) : (
                  <Button label="Invite a friend" icon="person-add-outline" variant="primary" block onPress={() => void invite()} />
                )}
              </View>
              {ready ? (
                <View style={styles.secondary}>
                  <Button label="Shuffle" icon="shuffle" variant="glass" size="compact" disabled={songs.length === 0} onPress={() => { if (songs.length) StreamService.play(shuffled(songs), 0); }} />
                  <Button label="Invite" icon="person-add-outline" variant="glass" size="compact" onPress={() => void invite()} accessibilityLabel="Invite someone to this Blend" />
                </View>
              ) : null}
            </RiseIn>
            {detail.change ? <Text style={styles.note}>{changeText(detail.change, artistName(detail.change.artist, detail.tracks))}</Text> : null}
            {refreshFailed ? <Tactile accessibilityRole="button" onPress={() => void load()}><Text style={styles.note}>Couldn’t refresh just now. Tap to try again.</Text></Tactile>
              : detail.stale && detail.members.length >= 2 ? <Tactile accessibilityRole="button" onPress={() => void load()}><Text style={styles.note}>Your Blend is waiting to refresh. Tap to refresh.</Text></Tactile> : null}
            {detail.members.filter((member) => !member.learning).map((member) => (
              <Text key={member.userId} style={styles.note}>{member.isYou ? 'Your picks come from likes and playlists.' : learningOffText(member.displayName)}</Text>
            ))}
            {detail.state === 'not_enough' ? <View style={s.panel}><Text style={s.panelBody}>{BLEND_TEXT.notenough}</Text></View> : null}
            {ready ? (
              <RiseIn index={1}>
                <Tactile onPress={() => setWatching(true)} pressScale={0.98} haptic="select" accessibilityRole="button" accessibilityLabel="Watch your Blend story" style={styles.storyTile}>
                  <View style={styles.storyStack}>
                    {detail.tracks.slice(0, 3).map((track, i) => (
                      <Artwork key={track.song.ref} uri={track.song.artwork} title={track.song.title} artist={track.song.artist} size={40} style={[styles.storyThumb, { marginLeft: i === 0 ? 0 : -18, transform: [{ rotate: `${(i - 1) * 8}deg` }] }]} />
                    ))}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.storyTitle}>Your Blend story</Text>
                    <Text style={styles.storySub} numberOfLines={1}>Your match, shared songs and who brought what</Text>
                  </View>
                  <Ionicons name="play-circle" size={34} color={Signal.wave} />
                </Tactile>
              </RiseIn>
            ) : null}
            {detail.state === 'ready' ? (
              <View style={styles.chips} accessibilityRole="radiogroup">
                {[{ userId: null, label: 'Everyone' }, ...detail.members.map((member) => ({ userId: member.userId, label: member.isYou ? 'You' : member.displayName }))].map((chip) => {
                  const on = filter === chip.userId;
                  return (
                    <Tactile key={chip.userId ?? 'all'} onPress={() => setFilter(chip.userId)} hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }} pressScale={0.96} haptic="select" accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.chip, on && styles.chipOn]}>
                      {chip.userId ? <View style={[styles.chipDot, { backgroundColor: discColour(chip.userId) }]} /> : null}
                      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{chip.label}</Text>
                    </Tactile>
                  );
                })}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const holders = detail.members.filter((member) => item.for.includes(member.userId));
          return (
            <Animated.View entering={reducedMotion ? FadeIn.duration(Motion.duration.fast) : FadeInDown.duration(Motion.duration.base).delay(Math.min(index, 6) * 40)}>
            <Tactile onPress={() => StreamService.play(songs, index)} pressScale={0.98} accessibilityRole="button" accessibilityLabel={`Play ${item.song.title} by ${item.song.artist}`} style={styles.track}>
              <Artwork uri={item.song.artwork} title={item.song.title} artist={item.song.artist} size={TRACK_ART} style={styles.trackArt} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.trackTitle} numberOfLines={1}>{item.song.title}</Text>
                <Text style={styles.trackArtist} numberOfLines={1}>{item.song.artist}</Text>
              </View>
              {item.kind === 'discovery' ? <Text style={styles.newTag}>{BLEND_TEXT.newForYou}</Text> : <MemberDiscs members={holders} size={22} />}
            </Tactile>
            </Animated.View>
          );
        }}
        ListFooterComponent={<View style={styles.footer}><Button label="Leave this Blend" icon="exit-outline" variant="plain" size="sm" onPress={leave} /></View>}
        contentContainerStyle={{ paddingBottom: bottom }}
      />
      <BlendStoryPlayer detail={detail} visible={watching} onClose={closeStory} onPlay={playFromStory} />
      <ConfirmSheet
        visible={leaveConfirmationOpen}
        title={`Leave ${detail.name}?`}
        body="You'll stop seeing it, and it refreshes without your songs."
        confirmLabel="Leave"
        cancelLabel="Stay"
        destructive
        onConfirm={confirmLeave}
        onClose={() => setLeaveConfirmationOpen(false)}
      />
    </AppScreen>
  );
};

const TRACK_ART = 48;

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: Space.md, paddingBottom: Space.sm },
  name: { color: Signal.ink, fontSize: TypeScale.detail, fontWeight: '700', textAlign: 'center', marginTop: Space.sm },
  meta: { color: Signal.inkMuted, fontSize: TypeScale.meta, textAlign: 'center', marginTop: 4 },
  matchRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: Space.xs, marginTop: Space.sm },
  matchFigure: { color: Signal.ink, fontSize: TypeScale.display, fontWeight: '700' },
  matchLabel: { color: Signal.inkSoft, fontSize: TypeScale.body, fontWeight: '600' },
  primary: { alignSelf: 'stretch', marginTop: Space.md },
  secondary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.sm, marginTop: Space.sm },
  footer: { alignItems: 'center', paddingTop: Space.lg },
  note: { color: Signal.inkMuted, fontSize: TypeScale.meta, paddingHorizontal: Space.md, textAlign: 'center', marginTop: 4 },
  storyTile: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginHorizontal: Space.md, marginTop: Space.md, padding: Space.sm, paddingLeft: Space.md, borderRadius: Radius.panel, backgroundColor: Glass.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  storyStack: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  storyThumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 1.5, borderColor: Signal.bg },
  storyTitle: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '700' },
  storySub: { color: Signal.inkMuted, fontSize: TypeScale.caption, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.xs, rowGap: Space.sm, paddingHorizontal: Space.md, marginTop: Space.md, marginBottom: Space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline, maxWidth: 180 },
  chipOn: { backgroundColor: Signal.ink, borderColor: Signal.ink },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: Signal.inkSoft, fontSize: TypeScale.meta, fontWeight: '600' },
  chipTextOn: { color: Signal.bg },
  track: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 64, paddingHorizontal: Space.md, paddingVertical: 8 },
  trackArt: { width: TRACK_ART, height: TRACK_ART, borderRadius: Radius.thumb },
  trackTitle: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '600' },
  trackArtist: { color: Signal.inkMuted, fontSize: TypeScale.meta, marginTop: 2 },
  newTag: { color: Signal.wave, fontSize: TypeScale.caption, fontWeight: '700' },
});

export default BlendScreen;
