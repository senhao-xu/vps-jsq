import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shellPath = fileURLToPath(new URL('./index.html', import.meta.url));
const exchangeViewPath = fileURLToPath(new URL('./src/views/exchange.html', import.meta.url));
const isWindowsMount = process.platform === 'linux' && /^\/mnt\/[a-z]\//i.test(shellPath);

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
  plugins: [{
    name: 'toolbox-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const exchangeEntry = context.path.endsWith('/exchange.html');
        const shell = exchangeEntry ? readFileSync(shellPath, 'utf8') : html;
        const page = shell.replace('<!-- exchange-tool-content -->', readFileSync(exchangeViewPath, 'utf8'));
        return exchangeEntry ? page.replace('<title>剩余价值 · VPS 工具箱</title>', '<title>汇率换算 · VPS 工具箱</title>') : page;
      },
    },
    configureServer(server) {
      server.watcher.add(exchangeViewPath);
      server.watcher.on('change', path => {
        if (path === exchangeViewPath) server.ws.send({ type: 'full-reload' });
      });
    },
  }],
  define: {
    __GIT_SHA__: JSON.stringify(gitSha),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Windows drive edits can miss filesystem events in WSL, leaving imported CSS cached.
    watch: isWindowsMount ? { usePolling: true, interval: 200 } : undefined,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        exchange: 'exchange.html',
      },
    },
  }
});
