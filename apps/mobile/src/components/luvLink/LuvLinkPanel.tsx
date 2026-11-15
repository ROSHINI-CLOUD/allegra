import { Ionicons } from '@expo/vector-icons';
import { fromMobileId, type SongSnapshot } from '@shared/songRef';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Glass, Radius, Signal } from '../../constants/allegraTheme';
import { useAccount } from '../../services/account/AccountProvider';
import { ALLEGRA_API_URL } from '../../services/account/config';
import {
  addOwnedLuvLinkQueueItem,
  createOwnedLuvLink,
  joinOwnedLuvLink,
  leaveOwnedLuvLink,
  moveOwnedLuvLinkQueueItem,
  refreshOwnedLuvLinkGroupPicks,
  removeOwnedLuvLinkQueueItem,
  setOwnedLuvLinkController,
  setOwnedLuvLinkMode,
  setOwnedLuvLinkSpeaker,
  setOwnedLuvLinkSuggestionsConsent,
  watchOwnedLuvLinkGroupPicks,
  type OwnedLuvLinkGroupPicks
} from '../../services/luvLink/client';
import { handleOwnedLuvLinkToggle, playOwnedLuvLinkQueueEntry } from '../../services/luvLink/sync';
import { plainErrorMessage } from '../../utils/plainError';
import { useLuvLinkStore } from '../../store/luvLinkStore';
import { usePlayerStore } from '../../store/playerStore';
import { Tactile, TactileRow, Text as UIText } from '../../ui';
import { SheetScrollView } from '../player/PlayerSheet';
import LegacyLuvLinkPanel from './LuvLinkLegacyPanel';

const Button: React.FC<{ label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }> = ({ label, onPress, secondary, disabled }) => (
  <Tactile accessibilityRole="button" disabled={disabled} onPress={onPress} wrapperStyle={styles.buttonWrap} style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Tactile>
);

const LuvLinkPanel: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const account = useAccount();
  const room = useLuvLinkStore(s => s.ownedRoom);
  const queue = useLuvLinkStore(s => s.ownedQueue);
  const anchor = useLuvLinkStore(s => s.ownedPlayback);
  const members = useLuvLinkStore(s => s.ownedMembers);
  const code = useLuvLinkStore(s => s.ownedCode);
  const inviteCode = useLuvLinkStore(s => s.pendingOwnedInviteCode);
  const connection = useLuvLinkStore(s => s.ownedConnection);
  const legacySession = useLuvLinkStore(s => s.session);
  const profile = account.profile;
  const name = profile?.displayName || profile?.email?.split('@')[0] || useLuvLinkStore.getState().username || 'Listener';
  const song = usePlayerStore(s => s.currentSong);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [groupPicks, setGroupPicks] = useState<OwnedLuvLinkGroupPicks | null>(null);
  useEffect(() => { if (inviteCode) setJoinCode(inviteCode); }, [inviteCode]);
  useEffect(() => {
    if (!visible || !room || legacySession) { setGroupPicks(null); return; }
    try { return watchOwnedLuvLinkGroupPicks(setGroupPicks); }
    catch (error) { setMessage(plainErrorMessage(error, 'Room picks are unavailable.')); return; }
  }, [visible, room?.roomId, legacySession]);

  const inviteUrl = useMemo(() => code ? `${ALLEGRA_API_URL}/luvlink/join/${encodeURIComponent(code)}` : '', [code]);
  const showError = (error: unknown) => setMessage(plainErrorMessage(error, 'That didn’t work. Try again.'));
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  const shareInvite = async () => {
    if (!inviteUrl) return;
    await Share.share({ message: `Join my LuvLink: ${inviteUrl}`, url: inviteUrl });
  };
  const copyInvite = async () => {
    if (!inviteUrl) return;
    await Clipboard.setStringAsync(inviteUrl);
    setMessage('Invite link copied.');
  };
  const currentSnapshot = (): SongSnapshot | null => {
    if (!song) return null;
    const ref = fromMobileId(song.id) ?? (song.originId?.includes(':') ? song.originId as SongSnapshot['ref'] : null);
    if (!ref) return null;
    return { ref, title: song.title, artist: song.artist ?? '', album: song.album, artwork: song.coverRemoteUri ?? song.coverImageUri ?? '', duration: Math.max(0, song.duration) };
  };

  if (legacySession) return <LegacyLuvLinkPanel />;
  if (!account.signedIn) return (
    <SheetScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}><Ionicons name="heart" size={30} color={Signal.wave} /><Text style={styles.title}>LuvLink</Text><Text style={styles.copy}>Make a room, share a song, stay in sync.</Text></View>
      <Button label={account.loading ? 'Checking account…' : 'Sign in to start a LuvLink'} onPress={() => { void account.signInWithGoogle(); }} disabled={account.loading || busy} />
      {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
    </SheetScrollView>
  );

  if (!room) return (
    <SheetScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}><Ionicons name="heart" size={30} color={Signal.wave} /><Text style={styles.title}>LuvLink</Text><Text style={styles.copy}>Your people, your music, in sync.</Text></View>
      <Button label="Start a LuvLink" onPress={() => { void run(async () => { if (!profile?.userId) throw new Error('Your account is still loading. Try again in a moment.'); await createOwnedLuvLink(name, profile.userId); }); }} disabled={busy || !profile?.userId} />
      <Text style={styles.sectionTitle}>Join with an invite code</Text>
      <TextInput value={joinCode} onChangeText={value => setJoinCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} placeholder="Enter room code" placeholderTextColor={Signal.inkFaint} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="LuvLink invite code" style={styles.input} />
      <Button label="Join room" secondary onPress={() => { void run(async () => { await joinOwnedLuvLink(joinCode, name); useLuvLinkStore.setState({ pendingOwnedInviteCode: null }); }); }} disabled={busy || !profile?.userId || joinCode.trim().length < 4} />
      {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
      {busy && <ActivityIndicator color={Signal.wave} style={styles.spinner} />}
    </SheetScrollView>
  );

  const me = members.find(member => member.userId === account.profile?.userId);
  const isHost = room.hostUserId === account.profile?.userId;
  const current = currentSnapshot();
  return (
    <SheetScrollView contentContainerStyle={styles.content}>
      <View style={styles.roomHeader}>
        <View><UIText variant="caption" tone="muted">{connection === 'connected' ? 'Connected' : 'Reconnecting'}</UIText><Text style={styles.title}>Your LuvLink</Text></View>
        <Text style={styles.count}>{room.memberCount}/8</Text>
      </View>
      <View style={styles.card}>
        <UIText variant="caption" tone="muted">Invite code</UIText>
        <Text style={styles.code}>{code ?? '••••••'}</Text>
        {inviteUrl ? <View style={styles.qr}><QRCode value={inviteUrl} size={148} color="#17121b" backgroundColor="#ffffff" quietZone={8} /></View> : null}
        <View style={styles.row}><Button label="Share link" onPress={() => { void shareInvite(); }} disabled={!inviteUrl} /><Button label="Copy" secondary onPress={() => { void copyInvite(); }} disabled={!inviteUrl} /></View>
      </View>

      <Text style={styles.sectionTitle}>Listening together · {room.mode === 'listen' ? 'on your own devices' : 'through one speaker'}</Text>
      <View style={styles.row}><Button label="Own device" secondary={room.mode !== 'listen'} onPress={() => { void run(() => setOwnedLuvLinkMode('listen')); }} disabled={!isHost || busy} /><Button label="One speaker" secondary={room.mode !== 'speaker'} onPress={() => { void run(() => setOwnedLuvLinkMode('speaker')); }} disabled={!isHost || busy} /></View>
      {room.mode === 'speaker' && !isHost ? <Button label={anchor?.playing ? 'Pause shared speaker' : 'Play shared speaker'} onPress={() => { void run(handleOwnedLuvLinkToggle); }} disabled={!me?.canControl || busy} /> : null}
      {anchor?.song ? <View style={styles.nowPlaying}><Text numberOfLines={1} style={styles.memberName}>{anchor.song.title}</Text><Text numberOfLines={1} style={styles.hint}>{anchor.song.artist} · {anchor.playing ? 'Playing' : 'Paused'}</Text></View> : null}
      {room.mode === 'speaker' && isHost ? <Text style={styles.hint}>Choose one member’s device as the room output. Everyone else controls without loading audio.</Text> : null}

      <Text style={styles.sectionTitle}>People · {members.length}</Text>
      {members.map(member => (
        <View key={member.userId} style={styles.member}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{member.displayName.slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.memberInfo}><Text style={styles.memberName}>{member.displayName}{member.userId === account.profile?.userId ? ' · you' : ''}</Text><Text style={styles.hint}>{member.role === 'host' ? 'Host' : member.userId === room.leaderUserId ? 'Speaker' : member.mode === 'listen' ? 'Listening' : 'Controller'}</Text></View>
          {isHost && room.mode === 'speaker' && member.userId !== room.leaderUserId ? <Button label="Make speaker" secondary onPress={() => { void run(() => setOwnedLuvLinkSpeaker(member.userId)); }} disabled={busy} /> : null}
          {isHost && member.role !== 'host' ? <Tactile wrapperStyle={styles.permissionTarget} accessibilityRole="switch" accessibilityLabel={`${member.canControl ? 'Disable' : 'Allow'} controls for ${member.displayName}`} accessibilityState={{ checked: member.canControl }} onPress={() => { void run(() => setOwnedLuvLinkController(member.userId, !member.canControl)); }}><Text style={styles.permission}>{member.canControl ? 'Controls on' : 'Controls off'}</Text></Tactile> : null}
          {!isHost && member.userId === account.profile?.userId ? <Text style={styles.permission}>{me?.canControl ? 'Controls on' : 'Controls off'}</Text> : null}
        </View>
      ))}

      <View style={styles.queueHeading}><Text style={styles.sectionTitle}>Up next · {queue.entries.length}</Text><Text style={styles.hint}>Picks are shared with everyone</Text></View>
      {current ? <View style={styles.row}><Button label="Add to queue" secondary onPress={() => { void run(() => addOwnedLuvLinkQueueItem(current)); }} disabled={busy} /><Button label="Play next" secondary onPress={() => { void run(() => addOwnedLuvLinkQueueItem(current, true)); }} disabled={busy} /></View> : <Text style={styles.hint}>Play a catalog song to add it to the room queue.</Text>}
      {queue.entries.map((entry, index) => (
        <View key={entry.entryId} style={styles.queueItem}>
          <Text style={styles.order}>{index + 1}</Text>
          <View style={styles.memberInfo}><Text numberOfLines={1} style={styles.memberName}>{entry.song.title}</Text><Text numberOfLines={1} style={styles.hint}>{entry.song.artist} · added by {entry.addedByName}</Text></View>
          <View style={styles.queueActions}>
            <Tactile wrapperStyle={styles.queueActionTarget} accessibilityRole="button" accessibilityLabel={`Play ${entry.song.title} in LuvLink`} disabled={busy || !me?.canControl && !isHost} onPress={() => { void run(() => playOwnedLuvLinkQueueEntry(entry.entryId)); }}><Ionicons name="play" size={18} color={Signal.wave} /></Tactile>
            <Tactile wrapperStyle={styles.queueActionTarget} accessibilityRole="button" accessibilityLabel={`Move ${entry.song.title} up`} disabled={index === 0 || busy || !me?.canControl && !isHost} onPress={() => { void run(() => moveOwnedLuvLinkQueueItem(entry.entryId, queue.entries[index - 1]?.entryId ?? null)); }}><Ionicons name="chevron-up" size={20} color={Signal.ink} /></Tactile>
            <Tactile wrapperStyle={styles.queueActionTarget} accessibilityRole="button" accessibilityLabel={`Remove ${entry.song.title}`} disabled={busy || !me?.canControl && !isHost} onPress={() => { void run(() => removeOwnedLuvLinkQueueItem(entry.entryId)); }}><Ionicons name="close" size={20} color={Signal.inkFaint} /></Tactile>
          </View>
        </View>
      ))}
      {queue.entries.length === 0 ? <Text style={styles.hint}>The room queue is ready for your first pick.</Text> : null}

      <View style={styles.queueHeading}><Text style={styles.sectionTitle}>Room picks</Text><Text style={styles.hint}>Optional suggestions from opted-in listeners</Text></View>
      {me ? <TactileRow accessibilityRole="switch" accessibilityLabel="Share my listening taste for LuvLink picks" accessibilityState={{ checked: me.canSuggest }} onPress={() => { void run(() => setOwnedLuvLinkSuggestionsConsent(!me.canSuggest)); }} style={styles.consent}>
        <View style={styles.memberInfo}><Text style={styles.memberName}>Share my listening taste</Text><Text style={styles.hint}>You can turn this off whenever you like.</Text></View>
        <Text style={styles.permission}>{me.canSuggest ? 'On' : 'Off'}</Text>
      </TactileRow> : null}
      <Button label="Refresh room picks" secondary onPress={() => { void run(refreshOwnedLuvLinkGroupPicks); }} disabled={busy} />
      {groupPicks?.picks.map((pick, index) => (
        <View key={`${groupPicks.revision}:${pick.song.ref}:${index}`} style={styles.queueItem}>
          <View style={styles.memberInfo}><Text numberOfLines={1} style={styles.memberName}>{pick.song.title}</Text><Text numberOfLines={1} style={styles.hint}>{pick.song.artist} · {pick.kind === 'shared' ? 'Loved by the room' : pick.forUserIds.includes(account.profile?.userId ?? '') ? 'Picked for you' : 'Room pick'}</Text></View>
          <Button label="Add" secondary onPress={() => { void run(() => addOwnedLuvLinkQueueItem(pick.song as SongSnapshot)); }} disabled={busy || !me?.canControl && !isHost} />
        </View>
      ))}
      {groupPicks && groupPicks.picks.length === 0 ? <Text style={styles.hint}>No room picks yet. Listeners can opt in, then refresh for a fresh blend.</Text> : null}
      {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
      {busy && <ActivityIndicator color={Signal.wave} style={styles.spinner} />}
      <Button label={isHost ? 'End LuvLink' : 'Leave LuvLink'} secondary onPress={() => { void run(leaveOwnedLuvLink); }} disabled={busy} />
    </SheetScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36, gap: 12 },
  hero: { alignItems: 'center', paddingVertical: 12, gap: 7 },
  title: { color: Signal.ink, fontSize: 22, fontWeight: '700' },
  copy: { color: Signal.inkMuted, fontSize: 14, textAlign: 'center' },
  sectionTitle: { color: Signal.ink, fontSize: 15, fontWeight: '600', marginTop: 8 },
  hint: { color: Signal.inkMuted, fontSize: 12 },
  input: { backgroundColor: Glass.fillLight, borderColor: Glass.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.well, minHeight: 48, paddingHorizontal: 14, color: Signal.ink, fontSize: 16 },
  buttonWrap: { flex: 1 },
  button: { minHeight: 48, paddingHorizontal: 15, borderRadius: Radius.pill, backgroundColor: Signal.wave, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: Glass.fillLight, borderColor: Glass.hairline, borderWidth: StyleSheet.hairlineWidth },
  buttonText: { color: Signal.waveInk, fontSize: 13, fontWeight: '700' },
  secondaryText: { color: Signal.ink },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  card: { padding: 16, borderRadius: 20, backgroundColor: Glass.fillLight, gap: 10 },
  // Room invite codes use wider tracking to help listeners scan and read them accurately.
  code: { color: Signal.ink, fontSize: 27, fontWeight: '700', letterSpacing: 5 },
  qr: { alignSelf: 'flex-start', padding: 8, borderRadius: 14, backgroundColor: '#fff' },
  roomHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: Signal.wave, fontWeight: '700' },
  member: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Glass.fillLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Signal.wave, fontWeight: '700' },
  memberInfo: { flex: 1 },
  memberName: { color: Signal.ink, fontSize: 14, fontWeight: '600' },
  permission: { color: Signal.wave, fontSize: 11, fontWeight: '600' },
  permissionTarget: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  queueActionTarget: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  queueHeading: { gap: 3 },
  consent: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: Glass.fillLight },
  nowPlaying: { padding: 12, borderRadius: 14, backgroundColor: Glass.fillLight },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  order: { color: Signal.inkFaint, width: 20, textAlign: 'center' },
  queueActions: { flexDirection: 'row', gap: 12 },
  error: { color: '#ff9b9b', fontSize: 13 },
  spinner: { paddingVertical: 7 },
});

export default LuvLinkPanel;
