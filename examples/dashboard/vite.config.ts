import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      '/dashboard': 'http://localhost:3100',
      '/jobs': 'http://localhost:3100',
      '/dlq': 'http://localhost:3100',
      '/health': 'http://localhost:3100',
    },
  },
});
