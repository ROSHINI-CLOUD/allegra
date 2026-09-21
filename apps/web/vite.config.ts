import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../packages/shared', import.meta.url))
    }
  },
  server: {
    port: 5173,
    // Listen on IPv4 loopback AND localhost spelling so Windows `localhost` → ::1
    // does not leave the UI talking to a dead socket while the API is fine.
    host: true,
    proxy: {
      // Same-origin /api in local dev — avoids CORS / 127.0.0.1 vs localhost fights.
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  }
});
