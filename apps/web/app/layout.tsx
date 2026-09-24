import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import '../src/styles/tailwind.css';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/styles/components.css';
import '../src/styles/app.css';
import '../src/styles/coverflow.css';

import { ClientShell } from './ClientShell';

export const metadata: Metadata = {
  title: 'Allegra — good music, ready when you are',
  description: 'Allegra is a music player for finding good music fast. Search a song, press play, and keep listening.',
  icons: { icon: '/allegra-logo.png', apple: '/allegra-logo.png' }
};

export const viewport: Viewport = {
  themeColor: '#101114',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1
};

/**
 * The layout owns the app shell so the single <audio> element, player and
 * shaders survive every route change. Pages render nothing: the URL only
 * decides which view the shell shows.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&family=DM+Sans:ital,opsz,wght@0,9..40,400..600;1,9..40,400..600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ClientShell />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
