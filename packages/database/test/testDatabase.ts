import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import { createDatabase, type DatabaseClient } from '../src/index.js';

export interface TemporaryDatabase {
  readonly client: DatabaseClient;
  readonly databasePath: string;
  readonly directory: string;
}

export function createTemporaryDatabase(
  context: TestContext,
  options: { readonly migrate?: boolean } = {},
): TemporaryDatabase {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-database-test-'));
  const databasePath = path.join(directory, 'sparkkeeper.db');
  const client = createDatabase({ databasePath });

  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });

  if (options.migrate ?? true) {
    client.migrate();
  }

  return { client, databasePath, directory };
}
