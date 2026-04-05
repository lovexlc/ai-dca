import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': {
        target: process.env.CF_WORKER_DEV_ORIGIN || 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'frontend-dist',
    emptyOutDir: true,
    assetsDir: 'react-assets',
    rollupOptions: {
      input: {
        page: resolve(__dirname, 'frontend/page.html'),
        catalog: resolve(__dirname, 'frontend/catalog.html')
      }
    }
  }
});
