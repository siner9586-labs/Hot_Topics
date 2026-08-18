import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@hot-topics/core': `${root}packages/core/src/index.ts`,
      '@hot-topics/shared': `${root}packages/shared/src/index.ts`,
      '@hot-topics/config': `${root}packages/config/src/index.ts`,
      '@hot-topics/adapters': `${root}packages/adapters/src/index.ts`,
      '@hot-topics/clustering': `${root}packages/clustering/src/index.ts`,
      '@hot-topics/scoring': `${root}packages/scoring/src/index.ts`,
      '@hot-topics/db': `${root}packages/db/src/index.ts`
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { enabled: false }
  }
});
