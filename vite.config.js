import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client-side only build. No server, no upload endpoint, ever.
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
  },
});
