import * as fs from 'fs';
import * as path from 'path';

import { removeNonContentBlocks } from './utils/htmlText';

/**
 * Least-privilege guard for the Android build (security audit,
 * .planning/mobile-security/ANDROID-PERMISSIONS-AUDIT-2026-11-13.md).
 *
 * Play Protect blocks an internet-sideloaded app that declares an accessibility service, a notification listener or
 * SMS access (developers.google.com/android/play-protect/warning-dev-guidance#app-blocked), and Google Pay pauses
 * payments while a non-Play app holds an enabled accessibility service (support.google.com/pay/india/answer/17165523).
 * A music app needs none of them. These checks keep them, and the broad media and overlay access libraries merge in,
 * from coming back. The merged release APK is checked in CI by .github/scripts/apk-permission-check.sh.
 */
const mobile = path.join(__dirname, '..');
const main = path.join(mobile, 'android', 'app', 'src', 'main');
const manifest = removeNonContentBlocks(fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8'));
const appJson = JSON.parse(fs.readFileSync(path.join(mobile, 'app.json'), 'utf8')) as {
  expo: { android: { permissions: string[]; blockedPermissions?: string[] } };
};

const permissionTags = manifest.match(/<uses-permission\b[^>]*>/g) ?? [];
const nameOf = (tag: string) => tag.match(/android:name="([^"]+)"/)?.[1] ?? '';
const isRemoval = (tag: string) => tag.includes('tools:node="remove"');
const declared = permissionTags.filter(t => !isRemoval(t)).map(nameOf).sort();
const removed = permissionTags.filter(isRemoval).map(nameOf).sort();

/** What LuvLyrics asks for, each tied to a feature in the audit. Anything new needs an audit entry first. */
const ALLOWED = [
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CAMERA', // Search → scan a LuvLyrics code; asked when the scanner opens.
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.INTERNET',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.READ_EXTERNAL_STORAGE', // Android 12 and older: local audio import and cover picker.
  'android.permission.READ_MEDIA_AUDIO', // Settings → import songs on this phone; asked on that tap.
  'android.permission.RECORD_AUDIO', // Voice search; asked on the first mic tap.
  'android.permission.REQUEST_INSTALL_PACKAGES', // About → Update app; Android asks the listener per install.
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.WRITE_EXTERNAL_STORAGE', // Android 12 and older only (maxSdkVersion 32): expo-media-library.
  'android.permission.WRITE_SETTINGS', // Player menu → Set as ringtone; the listener grants it on Android's page.
].sort();

/** The access Play Protect treats as financial-fraud risk for sideloaded apps, and other access a player never needs. */
const NEVER = [
  'android.permission.BIND_ACCESSIBILITY_SERVICE',
  'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
  'android.permission.RECEIVE_SMS',
  'android.permission.READ_SMS',
  'android.permission.SEND_SMS',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_CALL_LOG',
  'android.permission.READ_PHONE_STATE',
  'android.permission.QUERY_ALL_PACKAGES',
  'android.permission.BIND_DEVICE_ADMIN',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
];

/** Merged in by libraries (expo-image-picker, expo-media-library) and stripped: the photo picker needs none. */
const STRIPPED = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.SYSTEM_ALERT_WINDOW',
].sort();

describe('the Android build asks for the least it needs', () => {
  it('declares exactly the audited permissions', () => {
    expect(declared).toEqual(ALLOWED);
  });

  it('strips the broad photo, video and overlay access libraries merge in', () => {
    expect(removed).toEqual(STRIPPED);
  });

  it('declares no accessibility service, notification listener, SMS or other fraud-risk access', () => {
    for (const p of NEVER) expect(declared).not.toContain(p);
    expect(manifest).not.toMatch(/BIND_ACCESSIBILITY_SERVICE|android\.accessibilityservice/);
    expect(manifest).not.toMatch(/BIND_NOTIFICATION_LISTENER_SERVICE|NotificationListenerService/);
  });

  it('keeps legacy storage write to Android 12 and older', () => {
    const write = permissionTags.find(t => nameOf(t) === 'android.permission.WRITE_EXTERNAL_STORAGE') ?? '';
    expect(write).toMatch(/android:maxSdkVersion="32"/);
  });

  it('ships no accessibility service config or service class', () => {
    expect(fs.existsSync(path.join(main, 'res', 'xml', 'island_accessibility.xml'))).toBe(false);
    const kotlin: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.kt')) kotlin.push(fs.readFileSync(full, 'utf8'));
      }
    };
    walk(path.join(main, 'java'));
    expect(kotlin.length).toBeGreaterThan(0);
    for (const source of kotlin) {
      expect(source).not.toMatch(/:\s*(AccessibilityService|NotificationListenerService)\(\)/);
      expect(source).not.toMatch(/TYPE_ACCESSIBILITY_OVERLAY|ACTION_ACCESSIBILITY_SETTINGS|ACTION_NOTIFICATION_LISTENER/);
    }
  });

  it('app.json asks for the same and blocks what libraries would add on a prebuild', () => {
    const asked = [...appJson.expo.android.permissions].sort();
    for (const p of asked) expect(ALLOWED).toContain(p);
    for (const p of [...NEVER, ...STRIPPED]) expect(asked).not.toContain(p);
    expect(appJson.expo.android.blockedPermissions ?? []).toEqual(expect.arrayContaining(STRIPPED));
  });
});

describe('a phone updating from a build with the island', () => {
  it('drops the island switches the old build saved', () => {
    const app = fs.readFileSync(path.join(main, 'java', 'com', 'lyricflow', 'app', 'MainApplication.kt'), 'utf8');
    expect(app).toMatch(/deleteSharedPreferences\("dynamic_island"\)/);
  });

  it('asks for audio only when it scans the phone for songs', () => {
    const scanner = fs.readFileSync(path.join(__dirname, 'services', 'mediaScanner.ts'), 'utf8');
    expect(scanner).toMatch(/requestPermissionsAsync\(false, \['audio'\]\)/);
  });
});
