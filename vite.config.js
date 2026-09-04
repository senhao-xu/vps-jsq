import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// 构建版本：优先取环境变量（CI / Docker 构建注入），否则回退本地 git 短 sha
const gitSha = process.env.VITE_GIT_SHA || (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  root: '.',
  define: {
    __GIT_SHA__: JSON.stringify(gitSha),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
