import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(serverRoot, 'dist', 'native');
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
for (const name of ['rename-noreplace', 'chromium-launcher', 'contact-files']) {
  const output = path.join(outputDirectory, name);
  const source = path.join(serverRoot, 'native', `${name}.c`);
  const compilation = spawnSync(
    process.env.CC ?? 'cc',
    ['-O2', '-Wall', '-Wextra', '-o', output, source],
    { stdio: 'inherit' },
  );
  if (compilation.error !== undefined) throw compilation.error;
  if (compilation.status !== 0) {
    throw new Error(`Failed to build ${name} helper (exit ${String(compilation.status)}).`);
  }
}
