/**
 * About (Stream → the button at the top right): who made LuvLyrics and how
 * to reach them, a coffee, a place to report bugs (straight into Convex,
 * services/feedback), a check for a newer build (services/appUpdate) and
 * what the app does with your data. Dark glass panels, like Settings.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import appConfig from '../../../app.json';
import { Radius, Signal, Space, Surface } from '../../constants/allegraTheme';
import { FEEDBACK_MAX, feedbackProblem, sendFeedback } from '../../services/feedback';
import { Button, Sheet, SheetScrollView, TactileRow } from '../../ui';
import * as Haptics from '../../utils/haptics';
import { plainErrorMessage } from '../../utils/plainError';
import UpdatePanel from './UpdatePanel';

const WEBSITE = 'https://prathick.vercel.app';
const INSTAGRAM = 'yourboy_prats';
/** Your UPI id (name@bank). The coffee row stays hidden until it is set. */
const UPI_ID = '';
const ALLEGRA = 'allegravibe.vercel.app';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const Panel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.panel}>{children}</View>
);

const LinkRow: React.FC<{ icon: IconName; label: string; value: string; onPress: () => void; last?: boolean }> = ({ icon, label, value, onPress, last }) => (
  <TactileRow onPress={onPress} style={[styles.row, !last && styles.rowDivider]} accessibilityRole="link" accessibilityLabel={`${label}: ${value}`}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={Signal.wave} /></View>
    <View style={styles.flex}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
    <Ionicons name="arrow-forward" size={16} color={Signal.inkMuted} />
  </TactileRow>
);

type SendState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

const AboutSheet: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const open = useCallback((url: string) => {
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(url).catch(() => {});
  }, []);

  const openInstagram = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    // The app when it is installed, the website otherwise.
    Linking.openURL(`instagram://user?username=${INSTAGRAM}`).catch(() => Linking.openURL(`https://instagram.com/${INSTAGRAM}`).catch(() => {}));
  }, []);

  const coffee = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    Clipboard.setStringAsync(UPI_ID).catch(() => {});
    setCopied(true);
    // Opens a UPI app with the id filled in; the id is on the clipboard either way.
    Linking.openURL(`upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent('LuvLyrics')}&tn=${encodeURIComponent('A coffee for LuvLyrics')}`).catch(() => {});
  }, []);

  const submit = useCallback(async () => {
    const problem = feedbackProblem({ message, contact });
    if (problem) {
      setSend({ kind: 'error', message: problem });
      return;
    }
    setSend({ kind: 'sending' });
    try {
      await sendFeedback({ message, contact });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSend({ kind: 'sent' });
      setMessage('');
      setContact('');
    } catch (e) {
      setSend({ kind: 'error', message: plainErrorMessage(e, 'Could not send it. Try again in a bit.') });
    }
  }, [message, contact]);

  return (
    <Sheet visible={visible} onClose={onClose} title="LuvLyrics" tall keyboard>
          <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Panel>
              <UpdatePanel visible={visible} />
            </Panel>

            <Panel>
              <Text style={styles.story}>Made for your music.</Text>
              <Text style={styles.body}>Every screen and detail went through many iterations until it landed here. It is free, and it always will be.</Text>
              <Text style={styles.signature}>Prathick · version {appConfig.expo.version}</Text>
            </Panel>

            <Panel>
              <LinkRow icon="globe-outline" label="Website" value="prathick.vercel.app" onPress={() => open(WEBSITE)} />
              <LinkRow icon="logo-instagram" label="Instagram" value={`@${INSTAGRAM}`} onPress={openInstagram} last={!UPI_ID} />
              {UPI_ID ? (
                <LinkRow icon="cafe-outline" label="Buy me a coffee" value={copied ? `${UPI_ID} · copied` : `UPI · ${UPI_ID}`} onPress={coffee} last />
              ) : null}
            </Panel>

            <Panel>
              <Text style={styles.panelTitle}>Found a bug?</Text>
              <Text style={styles.body}>Tell me what happened and what you were doing. I read every one.</Text>
              <TextInput
                value={message}
                onChangeText={t => { setMessage(t); if (send.kind !== 'sending') setSend({ kind: 'idle' }); }}
                placeholder="What went wrong?"
                placeholderTextColor={Signal.inkFaint}
                multiline
                maxLength={FEEDBACK_MAX}
                style={[styles.input, styles.inputTall]}
                selectionColor={Signal.wave}
                accessibilityLabel="What went wrong"
              />
              <TextInput
                value={contact}
                onChangeText={setContact}
                placeholder="Email or Instagram, if you want a reply (optional)"
                placeholderTextColor={Signal.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                selectionColor={Signal.wave}
                accessibilityLabel="How to reach you, optional"
              />
              <View style={styles.sendRow}>
                <Text style={[styles.status, send.kind === 'error' && styles.statusError]} numberOfLines={2}>
                  {send.kind === 'sent' ? 'Sent. Thank you.' : send.kind === 'error' ? send.message : ''}
                </Text>
                <Button
                  label={send.kind === 'sending' ? 'Sending' : 'Send'}
                  icon="paper-plane"
                  variant="primary"
                  busy={send.kind === 'sending'}
                  accessibilityLabel="Send the report"
                  onPress={submit}
                />
              </View>
            </Panel>


            <Panel>
              <Text style={styles.panelTitle}>Privacy</Text>
              <Text style={styles.body}>
                Free, with no ads and no sale of personal data. Downloads and local lyrics stay on this phone.
                Signed in, your account, likes, playlists and listening preferences sync through Allegra and Convex.
                Playback providers receive the requests they need, Sentry receives crash and performance reports (session replay is off), and bug reports you send are stored so I can answer.
                On {ALLEGRA} you can stop learning from listening, download your data or delete your account.
              </Text>
            </Panel>
          </SheetScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: Radius.sheet,
    backgroundColor: Surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },
  story: { color: Signal.ink, fontSize: 24, fontWeight: '700' },
  body: { color: Signal.inkSoft, fontSize: 15, lineHeight: 23, marginTop: 6 },
  signature: { color: Signal.inkMuted, fontSize: 13, marginTop: 10 },
  panelTitle: { color: Signal.ink, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderRadius: Space.sm },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.07)' },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Surface.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Surface.divider,
  },
  rowLabel: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  rowValue: { color: Signal.inkMuted, fontSize: 13, marginTop: 2 },
  input: {
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.control,
    color: Signal.ink,
    fontSize: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  inputTall: { minHeight: 110, textAlignVertical: 'top' },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  status: { flex: 1, color: Signal.wave, fontSize: 13, fontWeight: '600' },
  statusError: { color: Signal.accentBright },
});

export default AboutSheet;
