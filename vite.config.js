import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(HERE, './src'),
      // Keep existing component imports stable while the project uses one
      // consistent Tabler icon family.
      'lucide-react': path.resolve(HERE, './src/components/project-icons.jsx'),
    },
  },
  server: {
    allowedHosts: ['local.freebacktrack.tech', 'app.freebacktrack.tech'],
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
      output: {
        // Use content hashes so unchanged chunks keep stable URLs across deploys.
        entryFileNames: 'react-assets/[name]-[hash].js',
        chunkFileNames: 'react-assets/[name]-[hash].js',
        assetFileNames: 'react-assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('posthog-js')) return 'posthog';
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('/react/')) return 'react';
            if (id.includes('@radix-ui') || id.includes('cmdk')) return 'radix';
            if (id.includes('@tanstack/react-table')) return 'tanstack-table';
          }
          return undefined;
        }
      }
    }
  }
});
