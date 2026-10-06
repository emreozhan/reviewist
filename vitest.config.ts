import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    // git yalıtımı + fikstür üretimi (bkz. scripts/vitest-global-setup.mjs)
    globalSetup: ['scripts/vitest-global-setup.mjs'],
  },
});
