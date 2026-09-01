import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_LIFECYCLE_STATUSES,
  ACCOUNT_LOGIN_FAILURE_CODES,
  ACCOUNT_LOGIN_PURPOSES,
  ACCOUNT_LOGIN_SESSION_STATUSES,
  ACCOUNT_PROFILE_STATES,
  AccountValidationError,
  ADMIN_USER_STATUSES,
  AdminValidationError,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUDIT_OUTCOMES,
  AuditValidationError,
  CONTACT_AVAILABILITY_STATUSES,
  CONTACT_IDENTITY_KINDS,
  CONTACT_IDENTITY_SOURCES,
  CONTACT_IDENTITY_STATES,
  CONTACT_IDENTITY_STATUSES,
  CONTACT_SYNC_FAILURE_CODES,
  CONTACT_SYNC_RUN_STATUSES,
  CONTACT_TYPES,
  ContactValidationError,
  DELIVERY_RESOLUTION_SOURCES,
  DELIVERY_RESOLUTION_VALUES,
  EXECUTION_RUN_KINDS,
  EXECUTION_RUN_STATUSES,
  ExecutionValidationError,
  isAccountLifecycleStatus,
  isAccountLoginFailureCode,
  isAccountLoginPurpose,
  isAccountLoginSessionStatus,
  isAccountProfileState,
  isAdminUserStatus,
  isAuditAction,
  isAuditEntityType,
  isAuditOutcome,
  isContactAvailabilityStatus,
  isContactIdentityKind,
  isContactIdentitySource,
  isContactIdentityState,
  isContactIdentityStatus,
  isContactSyncFailureCode,
  isContactSyncRunStatus,
  isContactType,
  isDeliveryResolutionSource,
  isDeliveryResolutionValue,
  isExecutionRunKind,
  isExecutionRunStatus,
  isLegacyBindingStatus,
  isLegacyScheduleImportStatus,
  isSendTaskScheduleType,
  isTargetSendFailureCode,
  isTargetSendMachineStatus,
  LEGACY_BINDING_STATUSES,
  LEGACY_SCHEDULE_IMPORT_STATUSES,
  normalizeAdminUsername,
  normalizeOptionalIdentifier,
  SEND_TASK_SCHEDULE_TYPES,
  SendTaskValidationError,
  TARGET_SEND_FAILURE_CODES,
  TARGET_SEND_MACHINE_STATUSES,
  validateAccountName,
  validateAdminUsername,
  validateAuditReasonCode,
  validateContactDisplayName,
  validateCorrelationDigest,
  validateIdempotencyKey,
  validateIdentityValue,
  validateOptionalContactString,
  validateResolutionNote,
  validateSendTaskMaxAttempts,
  validateSendTaskName,
  validateSendTaskRetryIntervalSeconds,
  validateSendTaskScheduleWindow,
  validateSendTaskTimeZone,
  validateStreakDays,
} from '../src/index.js';

test('Admin domain enums, type guards, and validators', () => {
  assert.deepEqual(ADMIN_USER_STATUSES, ['ACTIVE', 'DISABLED']);
  assert.equal(isAdminUserStatus('ACTIVE'), true);
  assert.equal(isAdminUserStatus('DISABLED'), true);
  assert.equal(isAdminUserStatus('active'), false);
  assert.equal(isAdminUserStatus('UNKNOWN'), false);
  assert.equal(isAdminUserStatus(null), false);

  assert.equal(validateAdminUsername('  admin_1  '), 'admin_1');
  assert.equal(normalizeAdminUsername('  Admin_User_1  '), 'admin_user_1');

  assert.throws(
    () => validateAdminUsername('   '),
    (error: unknown) => {
      assert.ok(error instanceof AdminValidationError);
      assert.equal(error.code, 'INVALID_USERNAME');
      return true;
    },
  );
});

test('Account domain enums, type guards, and validators', () => {
  assert.deepEqual(ACCOUNT_PROFILE_STATES, [
    'PROVISIONING',
    'READY',
    'MIGRATION_REQUIRED',
    'MISSING',
    'QUARANTINED',
  ]);
  for (const state of ACCOUNT_PROFILE_STATES) {
    assert.equal(isAccountProfileState(state), true);
    assert.equal(isAccountProfileState(state.toLowerCase()), false);
  }
  assert.equal(isAccountProfileState('INVALID'), false);

  assert.deepEqual(ACCOUNT_LIFECYCLE_STATUSES, ['ACTIVE', 'UNBOUND']);
  for (const status of ACCOUNT_LIFECYCLE_STATUSES) {
    assert.equal(isAccountLifecycleStatus(status), true);
  }

  assert.deepEqual(ACCOUNT_LOGIN_PURPOSES, ['ADD_ACCOUNT', 'RELOGIN']);
  for (const purpose of ACCOUNT_LOGIN_PURPOSES) {
    assert.equal(isAccountLoginPurpose(purpose), true);
  }

  assert.deepEqual(ACCOUNT_LOGIN_SESSION_STATUSES, [
    'PENDING',
    'STARTING',
    'AWAITING_USER',
    'READY_DETECTED',
    'COMPLETING',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
    'FAILED',
  ]);
  for (const status of ACCOUNT_LOGIN_SESSION_STATUSES) {
    assert.equal(isAccountLoginSessionStatus(status), true);
  }

  assert.deepEqual(ACCOUNT_LOGIN_FAILURE_CODES, [
    'START_FAILED',
    'PROFILE_LEASE_CONFLICT',
    'PROFILE_PREPARE_FAILED',
    'CONSOLE_START_FAILED',
    'AUTH_NOT_READY',
    'PROFILE_IDENTITY_UNAVAILABLE',
    'PROFILE_IDENTITY_CONFLICT',
    'READY_TIMEOUT',
    'PROCESS_EXITED',
    'FINALIZE_FAILED',
    'INTEGRITY_ERROR',
  ]);
  for (const code of ACCOUNT_LOGIN_FAILURE_CODES) {
    assert.equal(isAccountLoginFailureCode(code), true);
  }

  assert.equal(validateAccountName('  Main Account  '), 'Main Account');
  assert.throws(() => validateAccountName('   '), AccountValidationError);

  assert.equal(normalizeOptionalIdentifier('  sec_uid_123  '), 'sec_uid_123');
  assert.equal(normalizeOptionalIdentifier(null), null);
  assert.equal(normalizeOptionalIdentifier(undefined), null);
  assert.throws(() => normalizeOptionalIdentifier('   '), AccountValidationError);
});

test('Contact domain enums, type guards, and validators', () => {
  assert.deepEqual(CONTACT_TYPES, ['PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN']);
  for (const type of CONTACT_TYPES) {
    assert.equal(isContactType(type), true);
    assert.equal(isContactType(type.toLowerCase()), false);
  }

  assert.deepEqual(CONTACT_AVAILABILITY_STATUSES, ['AVAILABLE', 'STALE', 'UNAVAILABLE']);
  for (const status of CONTACT_AVAILABILITY_STATUSES) {
    assert.equal(isContactAvailabilityStatus(status), true);
  }

  assert.deepEqual(CONTACT_IDENTITY_STATUSES, [
    'READY',
    'UNAVAILABLE',
    'CHANGED',
    'AMBIGUOUS',
    'LEGACY_UNBOUND',
  ]);
  for (const status of CONTACT_IDENTITY_STATUSES) {
    assert.equal(isContactIdentityStatus(status), true);
  }

  assert.deepEqual(CONTACT_IDENTITY_KINDS, [
    'SEC_UID',
    'UNIQUE_ID',
    'SHORT_ID',
    'REMARK_NAME',
    'DISPLAY_NAME',
    'CONVERSATION_ID',
  ]);
  for (const kind of CONTACT_IDENTITY_KINDS) {
    assert.equal(isContactIdentityKind(kind), true);
  }

  assert.deepEqual(CONTACT_IDENTITY_SOURCES, [
    'DOM',
    'PAGE_DATA',
    'RESPONSE_PARSER',
    'LEGACY_MANUAL',
    'HUMAN_REBIND',
  ]);
  for (const source of CONTACT_IDENTITY_SOURCES) {
    assert.equal(isContactIdentitySource(source), true);
  }

  assert.deepEqual(CONTACT_IDENTITY_STATES, ['ACTIVE', 'SUPERSEDED']);
  for (const state of CONTACT_IDENTITY_STATES) {
    assert.equal(isContactIdentityState(state), true);
  }

  assert.deepEqual(CONTACT_SYNC_RUN_STATUSES, [
    'PENDING',
    'RUNNING',
    'COMPLETE',
    'PARTIAL',
    'FAILED',
    'AUTH_EXPIRED',
  ]);
  for (const status of CONTACT_SYNC_RUN_STATUSES) {
    assert.equal(isContactSyncRunStatus(status), true);
  }

  assert.deepEqual(CONTACT_SYNC_FAILURE_CODES, [
    'PROFILE_UNAVAILABLE',
    'PROFILE_BUSY',
    'AUTH_EXPIRED',
    'AUTH_UNKNOWN',
    'CHAT_NOT_READY',
    'DISCOVERY_TIMEOUT',
    'CANDIDATE_LIMIT_REACHED',
    'PARSER_CONTRACT_FAILURE',
    'BROWSER_FAILURE',
    'PERSISTENCE_FAILURE',
  ]);
  for (const code of CONTACT_SYNC_FAILURE_CODES) {
    assert.equal(isContactSyncFailureCode(code), true);
  }

  assert.equal(validateContactDisplayName('  Bob Friend  '), 'Bob Friend');
  assert.throws(() => validateContactDisplayName('  '), ContactValidationError);

  assert.equal(validateOptionalContactString('  Best Friend  ', 'remarkName'), 'Best Friend');
  assert.equal(validateOptionalContactString(null, 'remarkName'), null);
  assert.equal(validateOptionalContactString(undefined, 'remarkName'), null);
  assert.throws(() => validateOptionalContactString('  ', 'remarkName'), ContactValidationError);
  assert.throws(
    () => validateOptionalContactString('  ', 'avatarRemoteUrl'),
    ContactValidationError,
  );

  assert.equal(validateIdentityValue('  MS4wLjABAAAA...  '), 'MS4wLjABAAAA...');
  assert.throws(() => validateIdentityValue('   '), ContactValidationError);

  assert.equal(validateStreakDays(0), 0);
  assert.equal(validateStreakDays(15), 15);
  assert.equal(validateStreakDays(null), null);
  assert.equal(validateStreakDays(undefined), null);
  assert.throws(() => validateStreakDays(-1), ContactValidationError);
  assert.throws(() => validateStreakDays(1.5), ContactValidationError);
});

test('SendTask domain enums, type guards, and validators', () => {
  assert.deepEqual(SEND_TASK_SCHEDULE_TYPES, ['DAILY_WINDOW']);
  assert.equal(isSendTaskScheduleType('DAILY_WINDOW'), true);
  assert.equal(isSendTaskScheduleType('CRON'), false);

  assert.equal(validateSendTaskName('  Daily Morning Task  '), 'Daily Morning Task');
  assert.throws(() => validateSendTaskName('   '), SendTaskValidationError);

  const window = validateSendTaskScheduleWindow('09:00', '10:00');
  assert.equal(window.startTime, '09:00');
  assert.equal(window.endTime, '10:00');
  assert.throws(() => validateSendTaskScheduleWindow('10:00', '09:00'), SendTaskValidationError);
  assert.throws(() => validateSendTaskScheduleWindow('09:00', '09:00'), SendTaskValidationError);

  assert.equal(validateSendTaskTimeZone('Asia/Shanghai'), 'Asia/Shanghai');
  assert.equal(validateSendTaskTimeZone('UTC'), 'UTC');
  assert.throws(() => validateSendTaskTimeZone('Invalid/Timezone'), SendTaskValidationError);
  assert.throws(() => validateSendTaskTimeZone('  '), SendTaskValidationError);

  assert.equal(validateSendTaskMaxAttempts(1), 1);
  assert.equal(validateSendTaskMaxAttempts(3), 3);
  assert.equal(validateSendTaskMaxAttempts(5), 5);
  assert.throws(() => validateSendTaskMaxAttempts(0), SendTaskValidationError);
  assert.throws(() => validateSendTaskMaxAttempts(6), SendTaskValidationError);
  assert.throws(() => validateSendTaskMaxAttempts(2.5), SendTaskValidationError);

  assert.equal(validateSendTaskRetryIntervalSeconds(1), 1);
  assert.equal(validateSendTaskRetryIntervalSeconds(60), 60);
  assert.equal(validateSendTaskRetryIntervalSeconds(86400), 86400);
  assert.throws(() => validateSendTaskRetryIntervalSeconds(0), SendTaskValidationError);
  assert.throws(() => validateSendTaskRetryIntervalSeconds(86401), SendTaskValidationError);
});

test('Execution domain enums, type guards, and validators', () => {
  assert.deepEqual(EXECUTION_RUN_KINDS, ['TEST_SEND', 'SCHEDULED_TASK']);
  for (const kind of EXECUTION_RUN_KINDS) {
    assert.equal(isExecutionRunKind(kind), true);
  }

  assert.deepEqual(EXECUTION_RUN_STATUSES, [
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'PARTIAL_FAILED',
    'FAILED',
    'DELIVERY_UNKNOWN',
    'AUTH_EXPIRED',
    'CANCELLED',
  ]);
  for (const status of EXECUTION_RUN_STATUSES) {
    assert.equal(isExecutionRunStatus(status), true);
  }

  assert.deepEqual(TARGET_SEND_MACHINE_STATUSES, [
    'READY',
    'RUNNING',
    'RETRY_WAIT',
    'SUCCESS',
    'FAILED',
    'DELIVERY_UNKNOWN',
    'SKIPPED',
  ]);
  for (const status of TARGET_SEND_MACHINE_STATUSES) {
    assert.equal(isTargetSendMachineStatus(status), true);
  }

  assert.ok(TARGET_SEND_FAILURE_CODES.length > 0);
  for (const code of TARGET_SEND_FAILURE_CODES) {
    assert.equal(isTargetSendFailureCode(code), true);
  }

  assert.deepEqual(DELIVERY_RESOLUTION_VALUES, [
    'CONFIRMED_DELIVERED',
    'CONFIRMED_NOT_DELIVERED',
    'INCONCLUSIVE',
  ]);
  for (const val of DELIVERY_RESOLUTION_VALUES) {
    assert.equal(isDeliveryResolutionValue(val), true);
  }

  assert.deepEqual(DELIVERY_RESOLUTION_SOURCES, ['HUMAN']);
  assert.equal(isDeliveryResolutionSource('HUMAN'), true);

  assert.deepEqual(LEGACY_BINDING_STATUSES, ['PENDING', 'BOUND', 'DISMISSED']);
  for (const status of LEGACY_BINDING_STATUSES) {
    assert.equal(isLegacyBindingStatus(status), true);
  }

  assert.deepEqual(LEGACY_SCHEDULE_IMPORT_STATUSES, ['PENDING', 'CONVERTED', 'DISMISSED']);
  for (const status of LEGACY_SCHEDULE_IMPORT_STATUSES) {
    assert.equal(isLegacyScheduleImportStatus(status), true);
  }

  assert.equal(
    validateIdempotencyKey('  scheduled:task-1:2026-08-31  '),
    'scheduled:task-1:2026-08-31',
  );
  assert.throws(() => validateIdempotencyKey('   '), ExecutionValidationError);

  assert.equal(
    validateResolutionNote('  User checked physical device.  '),
    'User checked physical device.',
  );
  assert.equal(validateResolutionNote(null), null);
  assert.equal(validateResolutionNote(undefined), null);
  assert.throws(() => validateResolutionNote('   '), ExecutionValidationError);
  assert.throws(() => validateResolutionNote('a'.repeat(501)), ExecutionValidationError);
  assert.equal(validateResolutionNote('a'.repeat(500)), 'a'.repeat(500));
});

test('Audit domain enums, type guards, and validators', () => {
  assert.deepEqual(AUDIT_OUTCOMES, ['SUCCESS', 'REJECTED', 'FAILED']);
  for (const outcome of AUDIT_OUTCOMES) {
    assert.equal(isAuditOutcome(outcome), true);
  }

  for (const action of AUDIT_ACTIONS) {
    assert.equal(isAuditAction(action), true);
    assert.equal(isAuditAction(action.toLowerCase()), false);
  }

  for (const entity of AUDIT_ENTITY_TYPES) {
    assert.equal(isAuditEntityType(entity), true);
  }

  assert.equal(validateAuditReasonCode('INVALID_PASSWORD'), 'INVALID_PASSWORD');
  assert.equal(validateAuditReasonCode('A'), 'A');
  assert.equal(validateAuditReasonCode(null), null);
  assert.equal(validateAuditReasonCode(undefined), null);
  assert.throws(() => validateAuditReasonCode('invalid_reason'), AuditValidationError);
  assert.throws(() => validateAuditReasonCode('123_INVALID'), AuditValidationError);
  assert.throws(() => validateAuditReasonCode(''), AuditValidationError);

  assert.equal(validateCorrelationDigest('  sha256-abc123  '), 'sha256-abc123');
  assert.equal(validateCorrelationDigest(null), null);
  assert.throws(() => validateCorrelationDigest('   '), AuditValidationError);
});
