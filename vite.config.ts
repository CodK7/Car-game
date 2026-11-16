import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: false, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 60000 },
} as any);
