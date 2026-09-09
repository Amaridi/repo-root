import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Plage de ports assignee : 22400-22499, ecoute locale uniquement.
    host: '127.0.0.1',
    port: 22470,
    // Le front appelle /api en relatif, exactement comme en production.
    // Le proxy evite donc toute difference de comportement entre dev et prod
    // (cookies, CORS, chemins).
    proxy: {
      '/api': { target: 'http://127.0.0.1:22409', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
