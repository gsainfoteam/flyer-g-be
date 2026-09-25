import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // vitest는 NODE_ENV=test를 넣는데 env 검증(local|dev|prod)이 이를 거절한다.
    env: { NODE_ENV: 'local' },
  },
});
