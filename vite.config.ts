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
  build: { sourcemap: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
