import { defineConfig } from 'vitest/config';
export default defineConfig({
  define: { __MOCK__: 'true', __DEMO__: 'false' },
  test: { include: ['tests/**/*.test.ts'], maxWorkers: 1, fileParallelism: false },
});
