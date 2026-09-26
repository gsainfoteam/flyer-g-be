import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // vitest는 NODE_ENV=test를 넣는데 env 검증(local|dev|prod)이 이를 거절한다.
    // 주기 작업이 테스트가 만든 상태를 바꾸지 않게 끈다. 작업 자체는 메서드를 직접 불러 검증한다.
    env: { NODE_ENV: 'local', SCHEDULER_ENABLED: 'false' },
    // e2e 파일들이 같은 DB를 쓴다. 동시에 돌리면 한 파일이 만든 승인 게시물(대상 그룹 없음)이
    // 다른 파일의 편성에 끼어들어 ETag·304 검증이 흔들린다. 파일은 하나씩 돌린다.
    fileParallelism: false,
  },
});
