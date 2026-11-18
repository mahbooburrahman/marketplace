import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/uploads': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true, changeOrigin: false },
      '/sitemap.xml': { target: api },
      '/robots.txt': { target: api },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'], realtime: ['socket.io-client'] },
      },
    },
  },
});
