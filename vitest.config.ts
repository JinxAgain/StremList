import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['AIOStreams/**', 'stremthru/**', 'node_modules/**', 'dist/**']
  }
});
