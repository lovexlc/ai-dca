import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = process.env.VITE_ASSET_DIR || 'react-assets';
const ASSET_URL_VERSION = process.env.VITE_ASSET_URL_VERSION || '';

function renderVersionedAssetUrl(filename, { hostId, hostType, type }) {
  if (type !== 'asset') return undefined;
  // CSS is emitted inside the asset directory. Returning the full output
  // filename there would make `react-assets-v2/foo.woff2` resolve as
  // `/react-assets-v2/react-assets-v2/foo.woff2` in the browser.
  const relativePath =
    hostType === 'css'
      ? path.posix.basename(filename)
      : path.posix.relative(path.posix.dirname(hostId), filename) || path.posix.basename(filename);
  return `${relativePath}?v=${encodeURIComponent(ASSET_URL_VERSION)}`;
}

export default defineConfig({
  plugins: [react()],
  base: './',
  experimental: ASSET_URL_VERSION ? { renderBuiltUrl: renderVersionedAssetUrl } : undefined,
  resolve: {
    alias: {
      '@': path.resolve(HERE, './src'),
      // Keep existing component imports stable while the project uses one
      // consistent Tabler icon family.
      'lucide-react': path.resolve(HERE, './src/components/project-icons.jsx')
    }
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
    assetsDir: ASSET_DIR,
    rollupOptions: {
      output: {
        // Use content hashes so unchanged chunks keep stable URLs across deploys.
        entryFileNames: `${ASSET_DIR}/[name]-[hash].js`,
        chunkFileNames: `${ASSET_DIR}/[name]-[hash].js`,
        assetFileNames: `${ASSET_DIR}/[name]-[hash][extname]`,
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
