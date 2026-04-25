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
    outDir: process.env.VITE_OUT_DIR || 'frontend-dist',
    emptyOutDir: true,
    assetsDir: 'react-assets',
    rollupOptions: {
      input: {
        page: resolve(__dirname, 'frontend/page.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('/react/')) return 'react';
          }
          return undefined;
        }
      }
    }
  }
});
