// Vite ayarları. base: './' sayesinde GitHub Pages'te alt klasörde (/miknatis-savasi/) de çalışır.
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500, // Rapier (fizik) tek başına ~2 MB, gzip ile ~700 KB
    rollupOptions: {
      output: {
        // Three.js ve Rapier'i ayrı dosyalara böl: tarayıcı önbelleği daha iyi çalışır,
        // Rapier menü açılırken arka planda ayrıca indirilir.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('rapier3d')) return 'rapier';
          if (id.includes('colyseus') || id.includes('msgpackr') || id.includes('@colyseus')) return 'colyseus';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
});
