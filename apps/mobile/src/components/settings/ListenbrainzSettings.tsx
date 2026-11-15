import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, TextInput } from 'react-native';
import { Radius, Signal, Surface, TypeScale, Control } from '../../constants/allegraTheme';
import {
  connectListenbrainz,
  disconnectListenbrainz,
  setListenbrainzEnabled,
  useListenbrainzStore,
} from '../../services/listenbrainz/listenbrainzSync';
import * as Haptics from '../../utils/haptics';
import { Action, Row, Section, Switch } from './SettingsKit';

/**
 * Optional copy of the listening history to the listener's own ListenBrainz profile (open source, no Allegra server).
 * The phone keeps the full history either way; this only sends finished listens to ListenBrainz.
 */
const ListenbrainzSettings: React.FC<{ onLayout?: (event: LayoutChangeEvent) => void; onNotice: (text: string) => void }> = ({ onLayout, onNotice }) => {
  const connected = useListenbrainzStore(s => s.connected);
  const username = useListenbrainzStore(s => s.username);
  const enabled = useListenbrainzStore(s => s.enabled);
  const needsToken = useListenbrainzStore(s => s.needsToken);
  const pending = useListenbrainzStore(s => s.pending);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    const result = await connectListenbrainz(token);
    setBusy(false);
    if ('reason' in result) {
      onNotice(result.reason);
      return;
    }
    setToken('');
    Haptics.selectionAsync().catch(() => undefined);
    onNotice('ListenBrainz connected.');
  };

  const disconnect = async () => {
    await disconnectListenbrainz();
    onNotice('ListenBrainz disconnected. Listens already sent stay on your profile.');
  };

  const summary = connected ? (needsToken ? 'Needs a new token' : enabled ? `Sending to ${username}` : 'Paused') : 'Off';
  const showTokenField = !connected || needsToken;

  return (
    <Section id="listenbrainz" summary={summary} icon="musical-notes-outline" title="ListenBrainz" lead="Keep a copy of your listening history on your own ListenBrainz profile." onLayout={onLayout}>
      {connected && !needsToken ? (
        <>
          <Switch label="Send my listens" hint={`Signed in as ${username}. A listen counts after half the song or 4 minutes.`} value={enabled} onChange={next => { setListenbrainzEnabled(next).catch(() => undefined); }} />
          {pending > 0 ? <Row label="Waiting to send" hint={`${pending} ${pending === 1 ? 'listen' : 'listens'}. They send when you are online.`} /> : null}
          <Action label="Disconnect" hint="Forget the token and anything not yet sent." destructive onPress={() => { disconnect().catch(() => undefined); }} />
        </>
      ) : null}
      {showTokenField ? (
        <>
          <Row label={needsToken ? 'Paste a new token' : 'Your ListenBrainz token'} hint="Copy it from your ListenBrainz settings page. It stays on this phone and goes only to ListenBrainz." stack>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Paste token"
              placeholderTextColor={Signal.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              selectionColor={Signal.wave}
              style={styles.input}
              accessibilityLabel="ListenBrainz token"
            />
          </Row>
          <Action label={busy ? 'Checking…' : 'Connect'} hint="Allegra checks the token with ListenBrainz first." onPress={() => { connect().catch(() => undefined); }} />
        </>
      ) : null}
    </Section>
  );
};

const styles = StyleSheet.create({
  input: {
    minHeight: Control.target,
    paddingHorizontal: 14,
    borderRadius: Radius.control,
    color: Signal.ink,
    fontSize: TypeScale.body,
    backgroundColor: Surface.control,
  },
});

export default ListenbrainzSettings;
