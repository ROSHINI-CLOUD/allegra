'use client';

import dynamic from 'next/dynamic';

// The player touches window, localStorage, WebGL and Web Audio at module scope,
// so the shell is client-only. The URL, metadata and routes are still real.
const App = dynamic(() => import('../src/App'), { ssr: false });

export function ClientShell() {
  return <App />;
}
