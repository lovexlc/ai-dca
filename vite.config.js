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
      output: {
        // 去掉默认的 [hash]，让 GitHub 上的文件名更可读。
        // 缓存破坏改由 publish 脚本在 index.html 中注入 ?v= 查询参数。
        entryFileNames: 'react-assets/[name].js',
        chunkFileNames: 'react-assets/[name].js',
        assetFileNames: 'react-assets/[name][extname]',
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
