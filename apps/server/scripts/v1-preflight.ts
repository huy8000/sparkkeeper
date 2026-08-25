import { renderV1Preflight, runV1Preflight } from '../src/readiness/V1Preflight.js';

try {
  const result = runV1Preflight();
  process.stdout.write(`${renderV1Preflight(result)}\n`);
  if (!result.ready) process.exitCode = 1;
} catch {
  process.stderr.write('V1 preflight failed safely.\n');
  process.exitCode = 1;
}
