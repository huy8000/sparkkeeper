import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDatabase } from '@sparkkeeper/database';

import { runV1GateSmoke } from '../src/readiness/V1GateSmoke.js';

test('V1 Gate smoke verifies release preparation entirely offline with safe output', () => {
  const output = runV1GateSmoke();

  assert.match(output, /Engineering preflight: VERIFIED/);
  assert.match(output, /CLI maintenance: VERIFIED/);
  assert.match(output, /Multi-friend readiness: VERIFIED/);
  assert.match(output, /Scheduler safety: VERIFIED/);
  assert.match(output, /Audit read-only: VERIFIED/);
  assert.match(output, /Idempotency audit: VERIFIED/);
  assert.match(output, /Observability audit: VERIFIED/);
  assert.match(output, /Sensitive output: 0/);
  assert.match(output, /V1 Gate preparation: VERIFIED/);
  assert.equal(output.includes('Alice'), false);
  assert.equal(output.includes('Bob'), false);
  assert.equal(output.includes('Hello'), false);
});

test('V1 Gate smoke migration inventory covers 0000–0013 (14 migrations)', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-v1-migration-'));
  const client = createDatabase({ databasePath: path.join(directory, 'test.db') });
  try {
    assert.equal(client.migrate().appliedMigrationCount, 14);
  } finally {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
