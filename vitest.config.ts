import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitest.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Unit tests only — Playwright e2e lives in tests/e2e and is run separately.
    include: ['tests/unit/**/*.spec.ts'],
    environment: 'node',
  },
});