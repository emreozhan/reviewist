import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Arayüz kodundaki derleme sabiti (bkz. vite.config.ts); testler yerel uygulama olarak koşar.
  define: { __EDITION__: JSON.stringify('local') },
  test: {
    include: ['shared/src/**/*.test.ts', 'shared/web/src/**/*.test.{ts,tsx}', 'local/src/**/*.test.ts', 'github/src/**/*.test.ts'],
    testTimeout: 30000,
    // git yalıtımı + fikstür üretimi (bkz. scripts/vitest-global-setup.mjs)
    globalSetup: ['scripts/vitest-global-setup.mjs'],
  },
});
