import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../../packages/shared', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: '127.0.0.1'
  }
});
