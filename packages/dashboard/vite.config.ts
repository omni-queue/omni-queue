import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dashboardEndpoint = process.env.VITE_DASHBOARD_ENDPOINT || '/api/dashboard';
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3210';
const dashboardBase = process.env.VITE_DASHBOARD_BASE || './';

export default defineConfig({
  // Use relative asset URLs in production output so published files work under any uiBase mount path.
  base: dashboardBase,
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
