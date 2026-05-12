import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Yui-Drop frontend Vite config.
//
// - dev server on :5173, proxies /api → http://localhost:8000
// - alias @/* → src/* (mirrors tsconfig paths)
// - base '/' so the SPA can sit at the root of the deployed origin
export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // keep the /api prefix as-is — backend mounts its router at /api.
        rewrite: (p) => p,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
