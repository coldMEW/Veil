/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Cross-origin isolation lets multithreaded WASM run later. The deployed site
// sends the same two headers (see vercel.json), so dev and prod behave alike.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('onnxruntime-web')) return 'runtime-ort';
          if (id.includes('@contentauth/c2pa-web')) return 'runtime-c2pa';
          if (id.includes('@phosphor-icons')) return 'icons';
          if (id.includes('motion')) return 'motion';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
