import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'frontend-dist',
    emptyOutDir: true,
    assetsDir: 'react-assets',
    rollupOptions: {
      input: {
        'pages/81fee20edb5542f08bb363ac837b327c': resolve(__dirname, 'frontend/81fee20edb5542f08bb363ac837b327c.html'),
        'pages/65aaf3e700d3443c9810f6c727b045e8': resolve(__dirname, 'frontend/65aaf3e700d3443c9810f6c727b045e8.html')
      }
    }
  }
});
