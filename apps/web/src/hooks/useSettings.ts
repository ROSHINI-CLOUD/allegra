import { useSyncExternalStore } from 'react';

import { getServerSettings, getSettings, subscribeSettings, updateSettings, type Settings, type SettingsPatch } from '../lib/settings';

/** The device's settings, live. Every reader re-renders when any one of them changes. */
export function useSettings(): readonly [Settings, (patch: SettingsPatch) => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getServerSettings);
  return [settings, updateSettings] as const;
}
