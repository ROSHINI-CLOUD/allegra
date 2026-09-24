import {
  Guitar,
  Info,
  Keyboard,
  Mic,
  Music2,
  Palette as PaletteIcon,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Type,
  UserRound
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';

import { TactileButton } from './ui';
import { useSettings } from '../hooks/useSettings';
import { fetchHealth } from '../lib/api';
import { DEFAULT_KARAOKE_MIX, type KaraokeMix } from '../lib/karaokeMix';
import { clearRoformerCache, detectLiveKaraokeCapabilities, roformerCacheBytes, type LiveKaraokeBackend } from '../lib/liveKaraoke';
import { resetSettings, type KaraokeMode, type LyricsSize, type ThemePreference } from '../lib/settings';
import { itemVariants, motionTokens, pageVariants } from '../motion';

interface SettingsPageProps {
  /** Null while the account is still loading. */
  readonly account: { readonly isGuest: boolean; readonly name: string | null; readonly email: string | null } | null;
  readonly signInAvailable: boolean;
  readonly onOpenAccount: () => void;
  readonly karaokeBackend: LiveKaraokeBackend | null;
  readonly karaokeActive: boolean;
}

/* ── Small controls ─────────────────────────────────────────────────────── */

function Section({ id, icon, title, lead, children }: { readonly id: string; readonly icon: ReactNode; readonly title: string; readonly lead: string; readonly children: ReactNode }) {
  return (
    <motion.section className="settings-section" aria-labelledby={id} variants={itemVariants}>
      <header className="settings-section__head">
        <span className="settings-section__icon" aria-hidden="true">{icon}</span>
        <div>
          <h2 id={id}>{title}</h2>
          <p>{lead}</p>
        </div>
      </header>
      <div className="settings-section__rows">{children}</div>
    </motion.section>
  );
}

function Row({ label, hint, labelId, children }: { readonly label: string; readonly hint?: ReactNode; readonly labelId?: string; readonly children?: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <span id={labelId} className="settings-row__label">{label}</span>
        {hint ? <span className="settings-row__hint">{hint}</span> : null}
      </div>
      {children ? <div className="settings-row__control">{children}</div> : null}
    </div>
  );
}

function Switch({ label, hint, checked, onChange }: { readonly label: string; readonly hint?: ReactNode; readonly checked: boolean; readonly onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <Row label={label} hint={hint} labelId={id}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="settings-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch__thumb" aria-hidden="true" />
      </button>
    </Row>
  );
}

function Choice<T extends string>({ label, hint, value, options, onChange }: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (next: T) => void;
}) {
  const name = useId();
  return (
    <Row label={label} hint={hint}>
      <fieldset className="settings-choice">
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label key={option.value} className="settings-choice__option">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    </Row>
  );
}

function Level({ label, icon, value, onChange }: { readonly label: string; readonly icon: ReactNode; readonly value: number; readonly onChange: (next: number) => void }) {
  const percent = Math.round(value * 100);
  return (
    <label className="settings-level">
      <span className="settings-level__label">{icon}<span>{label}</span><output>{percent}%</output></span>
      <input
        type="range"
        className="karaoke-mix__range settings-level__range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-valuetext={`${percent} percent`}
        style={{ '--level': `${percent}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const SHORTCUTS: readonly { readonly keys: readonly string[]; readonly action: string }[] = [
  { keys: ['Space'], action: 'Play or pause' },
  { keys: ['←', '→'], action: 'Seek back or forward 5 seconds' },
  { keys: ['Ctrl', 'K'], action: 'Open search (⌘ K on a Mac)' },
  { keys: ['Esc'], action: 'Close the player, a sheet or a dialog' },
  { keys: ['↑', '↓', 'Enter'], action: 'Move through and pick search results' }
];

/* ── Page ───────────────────────────────────────────────────────────────── */

/**
 * Everything the listener can set, grouped the way they think about it. Settings are
 * saved on this device (see lib/settings.ts); account data stays where it always was.
 * Only controls that change something are here — no placeholders.
 */
export function SettingsPage({ account, signInAvailable, onOpenAccount, karaokeBackend, karaokeActive }: SettingsPageProps) {
  const reduced = useReducedMotion();
  const [settings, update] = useSettings();
  const [capabilities] = useState(() => detectLiveKaraokeCapabilities());
  const [modelBytes, setModelBytes] = useState<number | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [health, setHealth] = useState<{ state: 'loading' } | { state: 'ok'; version: string } | { state: 'down' }>({ state: 'loading' });
  const [confirmReset, setConfirmReset] = useState(false);
  const savedTimings = Object.keys(settings.lyricsOffsets).length;

  useEffect(() => {
    let live = true;
    void roformerCacheBytes().then((bytes) => {
      if (live) setModelBytes(bytes);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setHealth(result?.ok ? { state: 'ok', version: result.version } : { state: 'down' });
    });
    return () => controller.abort();
  }, []);

  const setMix = (patch: Partial<KaraokeMix>): void => update((current) => ({ karaokeMix: { ...current.karaokeMix, ...patch } }));

  const deleteModel = async (): Promise<void> => {
    setModelNote(null);
    const ok = await clearRoformerCache();
    setModelBytes(ok ? 0 : modelBytes);
    setModelNote(ok ? 'Deleted. It downloads again the next time Karaoke uses the AI model.' : 'Couldn’t delete the model. Close other Allegra tabs and try again.');
  };

  const karaokeInUse = !karaokeActive
    ? 'Not running'
    : karaokeBackend === 'roformer'
      ? 'On-device AI model'
      : karaokeBackend === 'midside'
        ? 'Basic vocal remover'
        : 'Starting…';

  return (
    <motion.div
      className="settings-page"
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      transition={reduced ? { duration: motionTokens.duration.instant } : undefined}
    >
      <motion.section className="inner-hero settings-hero" variants={itemVariants}>
        <div>
          <span className="eyebrow eyebrow-accent"><SettingsIcon size={13} aria-hidden="true" /> Settings</span>
          <h1>Make it <em>sound like yours.</em></h1>
          <p>These choices are saved on this device and apply straight away.</p>
        </div>
      </motion.section>

      <nav className="settings-jump" aria-label="Settings sections">
        {[
          ['settings-playback', 'Playback'],
          ['settings-lyrics', 'Lyrics'],
          ['settings-karaoke', 'Karaoke'],
          ['settings-appearance', 'Appearance'],
          ['settings-account', 'Account & privacy'],
          ['settings-about', 'About']
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="settings-jump__link" onClick={(event) => {
            event.preventDefault();
            document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
          }}>{label}</a>
        ))}
      </nav>

      <Section id="settings-playback" icon={<Music2 size={18} />} title="Playback" lead="What happens after the song you picked.">
        <Switch
          label="Autoplay similar songs"
          hint="After a search or a short list, keep going with songs like it. Off plays only the list you started from."
          checked={settings.autoplaySimilar}
          onChange={(autoplaySimilar) => update({ autoplaySimilar })}
        />
      </Section>

      <Section id="settings-lyrics" icon={<Type size={18} />} title="Lyrics" lead="How lyrics look and keep time.">
        <Choice<LyricsSize>
          label="Text size"
          value={settings.lyricsSize}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' }
          ]}
          onChange={(lyricsSize) => update({ lyricsSize })}
        />
        <Switch
          label="Show where lyrics came from"
          hint="The provider and how well it matched this recording, above the lyrics."
          checked={settings.showLyricsSource}
          onChange={(showLyricsSource) => update({ showLyricsSource })}
        />
        <Switch
          label="Remember timing per song"
          hint="Your +/− sync nudge comes back the next time you play that song."
          checked={settings.rememberLyricsOffset}
          onChange={(rememberLyricsOffset) => update({ rememberLyricsOffset })}
        />
        <Row
          label="Saved timings"
          hint={savedTimings > 0 ? `${savedTimings} ${savedTimings === 1 ? 'song has' : 'songs have'} a saved nudge.` : 'No song has a saved nudge.'}
        >
          <TactileButton variant="ghost" icon={Trash2} disabled={savedTimings === 0} onClick={() => update({ lyricsOffsets: {} })}>
            Forget all
          </TactileButton>
        </Row>
      </Section>

      <Section id="settings-karaoke" icon={<Mic size={18} />} title="Karaoke" lead="Vocal removal runs on this device. Nothing is uploaded.">
        <Choice<KaraokeMode>
          label="Vocal remover"
          hint={settings.karaokeMode === 'auto'
            ? 'Uses the on-device AI model when this device can run it, otherwise the basic remover.'
            : 'Always the basic remover: starts fast and downloads nothing, but leaves some vocals and has no mix.'}
          value={settings.karaokeMode}
          options={[
            { value: 'auto', label: 'Auto (AI)' },
            { value: 'basic', label: 'Basic only' }
          ]}
          onChange={(karaokeMode) => update({ karaokeMode })}
        />
        <div className="settings-row settings-row--stack">
          <div className="settings-row__copy">
            <span className="settings-row__label">Mix</span>
            <span className="settings-row__hint">
              How loud the separated vocals and music play. Also on the player: double-tap Karaoke. Needs the AI model.
            </span>
          </div>
          <div className="settings-levels">
            <Level label="Vocals" icon={<Mic size={15} aria-hidden="true" />} value={settings.karaokeMix.vocals} onChange={(vocals) => setMix({ vocals })} />
            <Level label="Bass & instruments" icon={<Guitar size={15} aria-hidden="true" />} value={settings.karaokeMix.instruments} onChange={(instruments) => setMix({ instruments })} />
            <TactileButton
              variant="ghost"
              icon={RotateCcw}
              disabled={settings.karaokeMix.vocals === DEFAULT_KARAOKE_MIX.vocals && settings.karaokeMix.instruments === DEFAULT_KARAOKE_MIX.instruments}
              onClick={() => update({ karaokeMix: DEFAULT_KARAOKE_MIX })}
            >
              Back to karaoke
            </TactileButton>
          </div>
        </div>
        <Row label="This device" hint={`GPU acceleration (WebGPU): ${capabilities.webgpu ? 'available' : 'not available — the AI model runs slower or falls back'}. Right now: ${karaokeInUse}.`}>
          <span className={`settings-pill${capabilities.webgpu ? ' is-good' : ''}`}>{capabilities.webgpu ? 'WebGPU' : 'CPU only'}</span>
        </Row>
        <Row
          label="Downloaded AI model"
          hint={modelNote ?? (modelBytes === null ? 'Checking…' : modelBytes > 0 ? `${formatBytes(modelBytes)} stored in this browser.` : 'Not downloaded. It downloads (about 750 MB) the first time Karaoke uses it.')}
        >
          <TactileButton variant="ghost" icon={Trash2} disabled={!modelBytes} onClick={() => void deleteModel()}>
            Delete
          </TactileButton>
        </Row>
      </Section>

      <Section id="settings-appearance" icon={<PaletteIcon size={18} />} title="Appearance" lead="Light, dark and moving parts.">
        <Choice<ThemePreference>
          label="Theme"
          value={settings.theme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Match device' }
          ]}
          onChange={(theme) => update({ theme })}
        />
        <Switch
          label="Animated background"
          hint="The flowing light behind the app. Off saves battery on older devices. Your device’s reduce-motion setting is always respected."
          checked={settings.animatedBackground}
          onChange={(animatedBackground) => update({ animatedBackground })}
        />
      </Section>

      <Section id="settings-account" icon={<ShieldCheck size={18} />} title="Account & privacy" lead="Who you are here, and what is measured.">
        <Row
          label={account === null ? 'Loading account…' : account.isGuest ? 'Listening as a guest' : `Signed in${account.name ? ` as ${account.name}` : ''}`}
          hint={account === null
            ? undefined
            : account.isGuest
              ? signInAvailable
                ? 'Sign in with Google to keep likes and playlists across devices.'
                : 'Likes and playlists are kept for this session.'
              : account.email ?? 'Your likes and playlists follow your account.'}
        >
          <TactileButton variant="secondary" icon={UserRound} onClick={onOpenAccount}>
            {account && !account.isGuest ? 'Manage account' : 'Sign in'}
          </TactileButton>
        </Row>
        <Switch
          label="Share anonymous usage data"
          hint="Page views and speed measurements (Vercel Analytics, no cookies) help us fix slow screens. Takes effect the next time Allegra loads."
          checked={settings.analytics}
          onChange={(analytics) => update({ analytics })}
        />
        <Row label="Where settings live" hint="Everything on this page is saved in this browser only. Clearing site data resets it." />
      </Section>

      <Section id="settings-about" icon={<Info size={18} />} title="About" lead="Version, shortcuts and credits.">
        <Row
          label="Server"
          hint={health.state === 'loading' ? 'Checking…' : health.state === 'ok' ? `Online · version ${health.version}` : 'Can’t reach the server right now. Playback and search may not work.'}
        >
          <span className={`settings-pill${health.state === 'ok' ? ' is-good' : health.state === 'down' ? ' is-bad' : ''}`} role="status">
            {health.state === 'loading' ? '…' : health.state === 'ok' ? 'Online' : 'Offline'}
          </span>
        </Row>
        <div className="settings-row settings-row--stack">
          <div className="settings-row__copy">
            <span className="settings-row__label"><Keyboard size={15} aria-hidden="true" /> Keyboard shortcuts</span>
          </div>
          <dl className="settings-shortcuts">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.action} className="settings-shortcuts__row">
                <dt>{shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
                <dd>{shortcut.action}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Row
          label="Credits"
          hint="Karaoke separation: Mel-Band RoFormer (MIT licence), run with ONNX Runtime Web. Lyrics from LRCLIB and other community providers."
        />
        <Row label="Reset settings" hint={confirmReset ? 'This restores every setting on this page and forgets saved lyric timings.' : 'Put everything on this page back to how it started.'}>
          {confirmReset ? (
            <span className="settings-confirm">
              <TactileButton variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</TactileButton>
              <TactileButton variant="primary" icon={RotateCcw} onClick={() => { resetSettings(); setConfirmReset(false); }}>Reset</TactileButton>
            </span>
          ) : (
            <TactileButton variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>Reset…</TactileButton>
          )}
        </Row>
      </Section>
    </motion.div>
  );
}
