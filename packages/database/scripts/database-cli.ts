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
      notificationConfigsSchemaCompatible: inspection.notificationConfigsSchemaCompatible,
      sendRecordsSchemaCompatible: inspection.sendRecordsSchemaCompatible,
      schedulesSchemaCompatible: inspection.schedulesSchemaCompatible,
      systemEventsSchemaCompatible: inspection.systemEventsSchemaCompatible,
      adminUsersSchemaCompatible: inspection.adminUsersSchemaCompatible,
      adminSessionsSchemaCompatible: inspection.adminSessionsSchemaCompatible,
      accountLoginSessionsSchemaCompatible: inspection.accountLoginSessionsSchemaCompatible,
      avatarAssetsSchemaCompatible: inspection.avatarAssetsSchemaCompatible,
      contactSyncRunsSchemaCompatible: inspection.contactSyncRunsSchemaCompatible,
      contactsSchemaCompatible: inspection.contactsSchemaCompatible,
      contactIdentitiesSchemaCompatible: inspection.contactIdentitiesSchemaCompatible,
      sendTasksSchemaCompatible: inspection.sendTasksSchemaCompatible,
      sendTaskTargetsSchemaCompatible: inspection.sendTaskTargetsSchemaCompatible,
      executionRunsSchemaCompatible: inspection.executionRunsSchemaCompatible,
      targetSendRecordsSchemaCompatible: inspection.targetSendRecordsSchemaCompatible,
      deliveryResolutionsSchemaCompatible: inspection.deliveryResolutionsSchemaCompatible,
      auditEventsSchemaCompatible: inspection.auditEventsSchemaCompatible,
      legacyFriendBindingsSchemaCompatible: inspection.legacyFriendBindingsSchemaCompatible,
      legacyScheduleImportsSchemaCompatible: inspection.legacyScheduleImportsSchemaCompatible,
    }),
  );

  if (
    !inspection.accountsSchemaCompatible ||
    !inspection.dailyRunsSchemaCompatible ||
    !inspection.friendsSchemaCompatible ||
    !inspection.messageTemplatesSchemaCompatible ||
    !inspection.notificationConfigsSchemaCompatible ||
    !inspection.sendRecordsSchemaCompatible ||
    !inspection.schedulesSchemaCompatible ||
    !inspection.systemEventsSchemaCompatible ||
    !inspection.adminUsersSchemaCompatible ||
    !inspection.adminSessionsSchemaCompatible ||
    !inspection.accountLoginSessionsSchemaCompatible ||
    !inspection.avatarAssetsSchemaCompatible ||
    !inspection.contactSyncRunsSchemaCompatible ||
    !inspection.contactsSchemaCompatible ||
    !inspection.contactIdentitiesSchemaCompatible ||
    !inspection.sendTasksSchemaCompatible ||
    !inspection.sendTaskTargetsSchemaCompatible ||
    !inspection.executionRunsSchemaCompatible ||
    !inspection.targetSendRecordsSchemaCompatible ||
    !inspection.deliveryResolutionsSchemaCompatible ||
    !inspection.auditEventsSchemaCompatible ||
    !inspection.legacyFriendBindingsSchemaCompatible ||
    !inspection.legacyScheduleImportsSchemaCompatible
  ) {
    process.exitCode = 1;
  }
} finally {
  client.close();
}
