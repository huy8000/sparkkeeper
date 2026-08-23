import { renderV1Audit, runV1Audit } from '../src/readiness/V1Audit.js';

try {
  const result = runV1Audit({ args: process.argv.slice(2) });
  process.stdout.write(`${renderV1Audit(result)}\n`);
  if (!result.passed) process.exitCode = 1;
} catch {
  process.stderr.write('V1 audit failed safely.\n');
  process.exitCode = 1;
}
