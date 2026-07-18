/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@qwen-code/web-shell': new URL(
        './src/test/web-shell.tsx',
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
  },
});
