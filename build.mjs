import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

function run(script, args) {
  const bin = resolve(root, 'node_modules', script);
  const res = spawnSync(node, [bin, ...args], { stdio: 'inherit', shell: false, cwd: root });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

run('typescript/bin/tsc', ['-b']);
run('vite/bin/vite.js', ['build']);
