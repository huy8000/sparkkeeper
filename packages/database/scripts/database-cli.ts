import { createDatabase } from '../src/index.js';

type DatabaseCommand = 'check' | 'migrate';

const command = process.argv[2] as DatabaseCommand | undefined;

if (command !== 'check' && command !== 'migrate') {
  throw new Error('Usage: database-cli.ts <check|migrate>');
}

const client = createDatabase();

try {
  if (command === 'migrate') {
    client.migrate();
  }

  const inspection = client.inspect();
  console.log(
    JSON.stringify({
      databasePath: inspection.databasePath,
      journalMode: inspection.pragmas.journalMode,
      foreignKeys: inspection.pragmas.foreignKeys,
      busyTimeoutMs: inspection.pragmas.busyTimeoutMs,
      synchronous: inspection.pragmas.synchronous,
      appliedMigrationCount: inspection.appliedMigrationCount,
      accountsSchemaCompatible: inspection.accountsSchemaCompatible,
      dailyRunsSchemaCompatible: inspection.dailyRunsSchemaCompatible,
      friendsSchemaCompatible: inspection.friendsSchemaCompatible,
      messageTemplatesSchemaCompatible: inspection.messageTemplatesSchemaCompatible,
      sendRecordsSchemaCompatible: inspection.sendRecordsSchemaCompatible,
    }),
  );

  if (
    !inspection.accountsSchemaCompatible ||
    !inspection.dailyRunsSchemaCompatible ||
    !inspection.friendsSchemaCompatible ||
    !inspection.messageTemplatesSchemaCompatible ||
    !inspection.sendRecordsSchemaCompatible
  ) {
    process.exitCode = 1;
  }
} finally {
  client.close();
}
