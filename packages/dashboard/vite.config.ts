import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dashboardEndpoint = process.env.VITE_DASHBOARD_ENDPOINT || '/api/dashboard';
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3210';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      [dashboardEndpoint]: {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
