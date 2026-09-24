'use client';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { useEffect, useState } from 'react';

import { getSettings } from '../src/lib/settings';

/**
 * Vercel Analytics and Speed Insights, unless the listener turned them off in Settings.
 * Decided once per page load, after mount: the scripts are never injected for someone
 * who opted out, and a change applies from the next load (the Settings copy says so).
 */
export function Telemetry() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(getSettings().analytics);
  }, []);
  if (!enabled) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
