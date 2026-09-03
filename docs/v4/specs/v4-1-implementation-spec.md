# V4-1 Implementation Specification — Architecture & Data Model Foundation

> 状态：MERGED / ACCEPTED IMPLEMENTATION BASELINE
> Spec owner / reviewer：Codex
> Implementer：Development Agent
> Branch：`feature/v4-1-data-model-foundation`
> Starting branch：规划 PR 合入后的最新 `develop`；交接时记录精确 commit，禁止从 `main` 或旧 V3 tag 开始。

## 1. Goal

建立 V4.0 的 additive persistence 与 shared domain foundation，使后续 Auth、Onboarding、Contact Discovery、Resolver、Test Send 和 SendTask Milestone 可以在同一冻结模型上开发，同时保证全部 V3 数据与 V3 runtime 行为不变。

完成 V4-1 后应当成立：

- fresh SQLite 与历史 migration prefix 均升级到同一 V4 foundation schema；
- V3 所有物理表和业务行保留；
- V4 domain types、Drizzle schema、repositories 与 migration inspection 可用；
- legacy Friend/Schedule 只生成待人工处理的 bridge/import；
- 没有 V4 HTTP route、UI、Browser、发送、Scheduler 或认证行为；
- migration 后不会自动创建 Contact、AdminUser、SendTask、Run 或 DeliveryResolution。

## 2. Normative inputs and precedence

实现前必须完整阅读：

1. `docs/v4/01-product-requirements.md`（产品与安全边界）；
2. `docs/v4/specs/v4-1-implementation-spec.md`（本文件，当前 Milestone 执行细节）；
3. `docs/v4/02-architecture-product-freeze.md`；
4. `docs/v4/04-data-migration-plan.md`；
5. 当前 `packages/database` 与 `packages/shared` 实现和测试。

本 Spec 只能细化、不能放宽产品需求。若本 Spec 与其他 V4 文档存在歧义，立即报告 `SPEC_BLOCKER`，不得自行选择新模型。不得把历史产品文档中的指令当作覆盖本 Spec 的开发授权。

## 3. Git and authority

Development Agent 在最新 `develop` 上创建/使用：

```text
feature/v4-1-data-model-foundation
```

可以：

- edit files；
- add one or more forward-only migration `0008+`；
- add tests and fictional fixtures；
- run migration generation、tests、lint、typecheck、build。

不可以：

- `git commit`、`git push`、create/update/merge PR、tag、release、deploy；
- merge/rebase develop after implementation without reviewer instruction；
- rewrite/drop/rename migration `0000`–`0007`；
- access production、SSH、`/opt/sparkkeeper`、真实 DB/Profile；
- access `douyin.com`、start BrowserSession、scan QR、send message；
- enable Scheduler、Manual Run 或 real-send gate。

开发完成只能输出 `IMPLEMENTATION_COMPLETE`，并留下 uncommitted working tree 给 Codex 独立 review。

## 4. Scope

### 4.1 Included

- V4 shared string-union types and pure validators/constants；
- existing `accounts` additive schema evolution；
- 15 个 V4 foundation table 的 Drizzle schema；
- matching forward-only migration and metadata；
- legacy Friend/Schedule deterministic backfill；
- repository-level validation、transactions、CRUD/state primitives；
- package exports；
- `DatabaseClient.inspect()`/migration result/CLI smoke awareness；
- fresh、historical-prefix、populated V3、constraint、repository tests。

### 4.2 Non-goals

- password hashing、Admin initialization CLI、login/session HTTP behavior（V4-2）；
- Browser/Profile filesystem lifecycle and Account onboarding（V4-3）；
- DOM/page parser、Contact sync application service、avatar download（V4-4）；
- resolver、browser selectors、conversation opening（V4-5）；
- delivery verifier and action-boundary integration（V4-6）；
- TestSendIntent、send coordinator/API/UI（V4-7）；
- scheduler dispatcher/Task API/UI（V4-8）；
- legacy binding/import UI and actual conversion service（V4-9）；
- public proxy/TLS/runtime config changes（V4-10）；
- PostgreSQL、Redis、private Douyin API、data deletion or release work。

## 5. Existing files to inspect

Development Agent 必须先读：

```text
packages/shared/src/index.ts
packages/shared/src/BusinessDate.ts
packages/shared/src/Retry.ts
packages/shared/src/ScheduleTime.ts
packages/shared/test/*.test.ts

packages/database/drizzle.config.ts
packages/database/migrations/0000_secret_redwing.sql
packages/database/migrations/0001_fresh_king_cobra.sql
packages/database/migrations/0002_remarkable_fallen_one.sql
packages/database/migrations/0003_petite_junta.sql
packages/database/migrations/0004_shallow_excalibur.sql
packages/database/migrations/0005_ordinary_lucky_pierre.sql
packages/database/migrations/0006_sweet_micromacro.sql
packages/database/migrations/0007_cute_cerebro.sql
packages/database/migrations/meta/_journal.json
packages/database/src/client/DatabaseClient.ts
packages/database/src/schema/*.ts
packages/database/src/repositories/*.ts
packages/database/src/index.ts
packages/database/scripts/database-cli.ts
packages/database/scripts/database-smoke.ts
packages/database/test/testDatabase.ts
packages/database/test/migrations.test.ts
packages/database/test/*Repository.test.ts
```

Also inspect current callers of `AccountRepository` before changing its result/input types. Existing public API compatibility is mandatory.

## 6. Expected file changes

### 6.1 Existing files expected to change

```text
packages/shared/src/index.ts
packages/shared/test/V4Domain.test.ts

packages/database/migrations/meta/_journal.json
packages/database/src/client/DatabaseClient.ts
packages/database/src/schema/accounts.ts
packages/database/src/schema/index.ts
packages/database/src/repositories/AccountRepository.ts
packages/database/src/repositories/index.ts
packages/database/src/index.ts
packages/database/scripts/database-cli.ts              # only if inspection output is explicit per table
packages/database/scripts/database-smoke.ts            # foundation assertions only
packages/database/test/testDatabase.ts
packages/database/test/migrations.test.ts
```

Generated migration name/hash suffix is tool-owned. Expect:

```text
packages/database/migrations/0008_<generated-name>.sql
packages/database/migrations/meta/0008_snapshot.json
```

If Drizzle requires more than one new migration, report why before proceeding; V4-1 normally uses exactly one atomic next migration.

### 6.2 New shared source files

Use these module boundaries (minor split by cohesive domain is allowed; names/types are not):

```text
packages/shared/src/Admin.ts
packages/shared/src/Account.ts
packages/shared/src/Contact.ts
packages/shared/src/SendTask.ts
packages/shared/src/Execution.ts
packages/shared/src/Audit.ts
```

### 6.3 New database schema files

```text
packages/database/src/schema/adminUsers.ts
packages/database/src/schema/adminSessions.ts
packages/database/src/schema/accountLoginSessions.ts
packages/database/src/schema/avatarAssets.ts
packages/database/src/schema/contactSyncRuns.ts
packages/database/src/schema/contacts.ts
packages/database/src/schema/contactIdentities.ts
packages/database/src/schema/sendTasks.ts
packages/database/src/schema/sendTaskTargets.ts
packages/database/src/schema/executionRuns.ts
packages/database/src/schema/targetSendRecords.ts
packages/database/src/schema/deliveryResolutions.ts
packages/database/src/schema/auditEvents.ts
packages/database/src/schema/legacyFriendBindings.ts
packages/database/src/schema/legacyScheduleImports.ts
```

### 6.4 New repositories and tests

Use one repository per aggregate/transaction boundary, not necessarily one class per table:

```text
packages/database/src/repositories/AdminUserRepository.ts
packages/database/src/repositories/AdminSessionRepository.ts
packages/database/src/repositories/AccountLoginSessionRepository.ts
packages/database/src/repositories/ContactRepository.ts
packages/database/src/repositories/ContactSyncRepository.ts
packages/database/src/repositories/AvatarAssetRepository.ts
packages/database/src/repositories/SendTaskRepository.ts
packages/database/src/repositories/ExecutionRunRepository.ts
packages/database/src/repositories/DeliveryResolutionRepository.ts
packages/database/src/repositories/AuditEventRepository.ts
packages/database/src/repositories/LegacyMigrationRepository.ts

packages/database/test/V4Migration.test.ts
packages/database/test/V4Constraint.test.ts
packages/database/test/V4Repositories.test.ts
packages/database/test/V4LegacyBridge.test.ts
```

Smaller focused test files are allowed. Do not create generic `V4Service` or a repository that exposes raw `DatabaseClient.orm` to callers.

## 7. Shared types and validation

All persisted enums are readonly constants plus derived string-union types. Pure validators throw typed validation errors; repositories translate validation/constraint failures to repository-specific safe error codes.

Required exported types/constants:

```text
AdminUserStatus: ACTIVE | DISABLED
AccountProfileState: PROVISIONING | READY | MIGRATION_REQUIRED | MISSING | QUARANTINED
AccountLifecycleStatus: ACTIVE | UNBOUND
AccountLoginPurpose: ADD_ACCOUNT | RELOGIN
AccountLoginSessionStatus:
  PENDING | STARTING | AWAITING_USER | READY_DETECTED | COMPLETING |
  COMPLETED | EXPIRED | CANCELLED | FAILED
AccountLoginFailureCode:
  START_FAILED | PROFILE_LEASE_CONFLICT | PROFILE_PREPARE_FAILED |
  CONSOLE_START_FAILED | AUTH_NOT_READY | PROFILE_IDENTITY_UNAVAILABLE |
  PROFILE_IDENTITY_CONFLICT | READY_TIMEOUT | PROCESS_EXITED |
  FINALIZE_FAILED | INTEGRITY_ERROR

ContactType: PERSON | GROUP | SYSTEM | UNKNOWN
ContactAvailabilityStatus: AVAILABLE | STALE | UNAVAILABLE
ContactIdentityStatus: READY | UNAVAILABLE | CHANGED | AMBIGUOUS | LEGACY_UNBOUND
ContactIdentityKind:
  SEC_UID | UNIQUE_ID | SHORT_ID | REMARK_NAME | DISPLAY_NAME | CONVERSATION_ID
ContactIdentitySource: DOM | PAGE_DATA | RESPONSE_PARSER | LEGACY_MANUAL | HUMAN_REBIND
ContactIdentityState: ACTIVE | SUPERSEDED
ContactSyncRunStatus: PENDING | RUNNING | COMPLETE | PARTIAL | FAILED | AUTH_EXPIRED
ContactSyncFailureCode:
  PROFILE_UNAVAILABLE | PROFILE_BUSY | AUTH_EXPIRED | AUTH_UNKNOWN |
  CHAT_NOT_READY | DISCOVERY_TIMEOUT | CANDIDATE_LIMIT_REACHED |
  PARSER_CONTRACT_FAILURE | BROWSER_FAILURE | PERSISTENCE_FAILURE

SendTaskScheduleType: DAILY_WINDOW
ExecutionRunKind: TEST_SEND | SCHEDULED_TASK
ExecutionRunStatus:
  PENDING | RUNNING | SUCCESS | PARTIAL_FAILED | FAILED |
  DELIVERY_UNKNOWN | AUTH_EXPIRED | CANCELLED
TargetSendMachineStatus:
  READY | RUNNING | RETRY_WAIT | SUCCESS | FAILED | DELIVERY_UNKNOWN | SKIPPED
TargetSendFailureCode:
  NAVIGATION_FAILED | PAGE_LOAD_TIMEOUT | CONTACT_LIST_NOT_READY |
  TARGET_NOT_FOUND | TARGET_AMBIGUOUS | TARGET_IDENTITY_UNAVAILABLE |
  IDENTITY_CHANGED | CONVERSATION_VERIFICATION_FAILED | COMPOSER_NOT_READY |
  MESSAGE_INPUT_FAILED | SEND_ACTION_NOT_TRIGGERED | AUTH_EXPIRED |
  AUTH_UNKNOWN | CAPTCHA_OR_RISK_CONTROL | BROWSER_FAILURE |
  PROFILE_UNAVAILABLE | TEMPLATE_INVALID | CONFIG_INVALID |
  PROCESS_INTERRUPTED_BEFORE_SEND | RETRY_WINDOW_EXPIRED |
  MAX_ATTEMPTS_EXHAUSTED | BATCH_ABORTED | DELIVERY_VERIFICATION_TIMEOUT |
  DELIVERY_EVIDENCE_INSUFFICIENT | PAGE_CLOSED_AFTER_ACTION |
  NAVIGATION_AFTER_ACTION | AUTH_STATE_CHANGED_AFTER_ACTION |
  PROCESS_INTERRUPTED_AFTER_ACTION
DeliveryResolutionValue:
  CONFIRMED_DELIVERED | CONFIRMED_NOT_DELIVERED | INCONCLUSIVE
DeliveryResolutionSource: HUMAN
LegacyBindingStatus: PENDING | BOUND | DISMISSED
LegacyScheduleImportStatus: PENDING | CONVERTED | DISMISSED
AuditOutcome: SUCCESS | REJECTED | FAILED
AuditAction:
  ADMIN_INITIALIZED | LOGIN_SUCCEEDED | LOGIN_FAILED | LOGOUT |
  SESSION_REVOKED | PASSWORD_CHANGED | ACCOUNT_LOGIN_STARTED |
  ACCOUNT_LOGIN_CANCELLED | ACCOUNT_CREATED | ACCOUNT_RELOGIN_COMPLETED |
  ACCOUNT_UNBOUND | CONTACT_SYNC_STARTED | CONTACT_SYNC_FINISHED |
  PREFERRED_IDENTITY_CHANGED | LEGACY_FRIEND_BOUND |
  LEGACY_FRIEND_DISMISSED | TEMPLATE_CREATED | TEMPLATE_UPDATED |
  TASK_CREATED | TASK_UPDATED | TASK_ENABLED | TASK_DISABLED | TASK_ARCHIVED |
  TEST_SEND_CONFIRMED | DELIVERY_RESOLVED | NOTIFICATION_CONFIG_UPDATED |
  NOTIFICATION_TEST_CONFIRMED | SESSION_CLEANUP | PROFILE_QUARANTINED
AuditEntityType:
  ADMIN_USER | ADMIN_SESSION | ACCOUNT_LOGIN_SESSION | DOUYIN_ACCOUNT |
  CONTACT_SYNC_RUN | CONTACT | CONTACT_IDENTITY | TEMPLATE | SEND_TASK |
  EXECUTION_RUN | TARGET_SEND_RECORD | DELIVERY_RESOLUTION |
  NOTIFICATION_CONFIG | LEGACY_FRIEND_BINDING | LEGACY_SCHEDULE_IMPORT | SYSTEM
```

Validation requirements:

- IDs accepted by repository inputs are non-empty trimmed opaque strings; repository-generated IDs use `crypto.randomUUID()`；
- optional Douyin/identity values normalize with `trim()` only; empty becomes validation error, never silently stored as empty；
- display/task/user names must be non-empty after trim；
- `streakDays` is integer `>= 0` or null；
- time window uses existing `ScheduleTime` and `[startTime,endTime)` with `startTime < endTime`；
- timezone validation uses existing IANA validation path, not a hard-coded allowlist；
- maxAttempts `1..5`; retryIntervalSeconds `1..86400`；
- resolution note is null or `1..500` Unicode code points after trim；
- do not export raw secret/token/password types through DTO-like records; persistence hash/digest strings stay database package concerns。

## 8. Exact database schema

Conventions for every new table:

- snake_case SQL names, camelCase Drizzle fields；
- UUID-like IDs are `TEXT PRIMARY KEY` but database does not use SQLite random generation；
- timestamps are `INTEGER` `timestamp_ms`；
- boolean uses integer boolean mode and database CHECK/default where meaningful；
- foreign keys are explicit；history-bearing rows use `NO ACTION`/`SET NULL`, not destructive cascade；
- every enum has a database CHECK；every required name/value has non-empty CHECK；
- add indexes for all FK/list/status/time lookup paths specified below。

### 8.1 `accounts` additive columns

Keep every existing column and CHECK. Add:

| Column                 | SQL type/null/default                      |
| ---------------------- | ------------------------------------------ |
| `avatar_remote_url`    | TEXT NULL                                  |
| `avatar_cache_key`     | TEXT NULL                                  |
| `douyin_unique_id`     | TEXT NULL                                  |
| `douyin_short_id`      | TEXT NULL                                  |
| `douyin_sec_uid`       | TEXT NULL                                  |
| `profile_state`        | TEXT NOT NULL DEFAULT `MIGRATION_REQUIRED` |
| `lifecycle_status`     | TEXT NOT NULL DEFAULT `ACTIVE`             |
| `last_auth_check_at`   | INTEGER NULL                               |
| `last_contact_sync_at` | INTEGER NULL                               |
| `unbound_at`           | INTEGER NULL                               |

Checks/indexes:

- profile/lifecycle enum CHECKs；
- each optional ID/cache key/remote URL is null or non-empty after trim；
- partial unique index on `douyin_sec_uid` where non-null；
- repository enforces `UNBOUND` requires `unbound_at` non-null and `ACTIVE` requires it null；this cross-column invariant must not trigger a SQLite table rebuild；
- existing rows resolve exactly to `MIGRATION_REQUIRED`, `ACTIVE`, new nullable fields null；
- `AccountRepository` existing create/update/callers continue compiling; V3 create defaults to `MIGRATION_REQUIRED` unless an explicit V4 profile state is passed。

### 8.2 Auth/onboarding tables

`admin_users`:

```text
id PK; username; username_normalized UNIQUE; password_hash;
status DEFAULT ACTIVE; session_version DEFAULT 1;
failed_login_count DEFAULT 0; locked_until?; last_failed_login_at?;
last_login_at?; password_changed_at; created_at; updated_at
```

Checks: non-empty username/normalized/password hash; status enum; `session_version >= 1`; failed count `>=0`. A partial unique singleton index permits at most one `ACTIVE` row.

`admin_sessions`:

```text
id PK; admin_user_id FK NO ACTION; token_digest UNIQUE; csrf_token_digest;
session_version; reauthenticated_at?; created_at; last_seen_at; idle_expires_at;
absolute_expires_at; revoked_at?; revoke_reason?
```

Checks: digest fields non-empty; version >=1; created <= lastSeen <= idle expiry; created < absolute expiry; idle expiry <= absolute expiry; optional reauthenticatedAt is within session lifetime; revoke reason null iff not revoked. Index `(admin_user_id, revoked_at)` and expiry indexes.

`account_login_sessions`:

```text
id PK; purpose; account_id? FK NO ACTION; pending_account_id?;
created_by_admin_user_id FK NO ACTION; status DEFAULT PENDING; expires_at;
started_at?; ready_detected_at?; completed_at?; cancelled_at?;
failure_code?; created_at; updated_at
```

Checks: purpose/status/failure-code enums; ADD_ACCOUNT = `account_id IS NULL AND pending_account_id IS NOT NULL`; RELOGIN is inverse; expiry > created; completed/cancelled/failed terminal metadata is structurally consistent. Partial unique index allows one active RELOGIN (`PENDING` through `COMPLETING`) per account. Global concurrency=1 is application/repository transaction policy, not a misleading database singleton across terminal history.

Legal transitions are exact:

```text
PENDING → STARTING | CANCELLED | EXPIRED | FAILED
STARTING → AWAITING_USER | CANCELLED | EXPIRED | FAILED
AWAITING_USER → READY_DETECTED | CANCELLED | EXPIRED | FAILED
READY_DETECTED → COMPLETING | FAILED
COMPLETING → COMPLETED | FAILED
terminal → no transition
```

`startedAt` is set from STARTING onward, `readyDetectedAt` from READY_DETECTED onward, `completedAt` only for COMPLETED, `cancelledAt` only for CANCELLED, and `failureCode` only/always for FAILED.

### 8.3 Contact tables

`avatar_assets`:

```text
id PK; account_id FK NO ACTION; cache_key UNIQUE; media_type; byte_size;
content_digest; fetched_at; last_referenced_at; expires_at?; created_at; updated_at
```

Checks: safe non-empty relative cache key/digest; media type in `image/jpeg|image/png|image/webp|image/gif`; byteSize `1..5242880`; no filesystem bytes/remote URL in this table. Index account and expiry.

`contact_sync_runs`:

```text
id PK; account_id FK NO ACTION; requested_by_admin_user_id FK NO ACTION;
status DEFAULT PENDING; is_complete DEFAULT false;
candidate_count DEFAULT 0; created_count DEFAULT 0; updated_count DEFAULT 0;
stale_count DEFAULT 0; unavailable_count DEFAULT 0; issue_count DEFAULT 0;
failure_code?; started_at?; finished_at?; created_at; updated_at
```

All counters `0..500`; status/failure-code enums；COMPLETE requires `is_complete=true` and no failureCode; PARTIAL/FAILED/AUTH_EXPIRED require false and a failureCode; terminal states require finishedAt. Legal transitions: `PENDING → RUNNING | FAILED`, `RUNNING → COMPLETE | PARTIAL | FAILED | AUTH_EXPIRED`; terminal states have no outgoing transition. Index account+created and status.

`contacts`:

```text
id PK; account_id FK NO ACTION; type; display_name; remark_name?;
avatar_remote_url?; avatar_asset_id? FK SET NULL;
streak_days?; streak_updated_at?; availability_status DEFAULT AVAILABLE;
identity_status DEFAULT UNAVAILABLE; discovered_at; last_seen_at;
last_full_sync_id? FK SET NULL; missed_full_sync_count DEFAULT 0;
created_at; updated_at
```

Checks: all enums; display non-empty; optional remark/URL non-empty; streak integer >=0 and timestamp present iff streak exists; miss count >=0; `lastSeenAt >= discoveredAt`. Index account+type+availability and account+display name. No unique displayName index.

`contact_identities`:

```text
id PK; account_id FK NO ACTION; contact_id FK NO ACTION; kind;
value; normalized_value; source; state DEFAULT ACTIVE;
is_preferred DEFAULT false; first_observed_at; last_observed_at;
superseded_at?; created_at; updated_at
```

Checks: enums; non-empty value/normalized; firstObserved <= lastObserved; ACTIVE iff supersededAt null; SUPERSEDED iff non-null; preferred implies ACTIVE. Index contact+state, account+kind+normalized, and observation time.

Uniqueness rules are exact:

- one partial unique preferred ACTIVE identity per Contact；
- one partial unique ACTIVE `(account_id,kind,normalized_value)` only for stable kinds `SEC_UID`, `UNIQUE_ID`, `SHORT_ID`, `CONVERSATION_ID`；
- `DISPLAY_NAME` and `REMARK_NAME` are deliberately non-unique so duplicate names remain representable and resolver ambiguity can STOP safely；
- repository transaction proves identity.accountId equals Contact.accountId。

Contact creation never lets the repository guess from an unordered identity set: the caller supplies the initial preferred identity selected by the frozen rule `PERSON: SEC_UID → UNIQUE_ID → SHORT_ID`, `GROUP: CONVERSATION_ID`. Later observations never replace preferred automatically.

### 8.4 Task/run tables

`send_tasks`:

```text
id PK; name; account_id FK NO ACTION; template_id FK NO ACTION;
schedule_type DEFAULT DAILY_WINDOW; start_time; end_time; timezone;
max_attempts DEFAULT 3; retry_interval_seconds DEFAULT 60;
enabled DEFAULT false; archived_at?; created_at; updated_at
```

Checks: non-empty name/timezone; schedule enum; existing time/window/retry invariants; archived Task cannot be enabled. Index account, enabled, template.

`send_task_targets`:

```text
task_id FK NO ACTION; contact_id FK NO ACTION; created_at;
PRIMARY KEY(task_id,contact_id)
```

Repository enforces Task.accountId == Contact.accountId and refuses SYSTEM/UNKNOWN. Database indexes contactId. A Task may temporarily have zero targets while disabled; enable validation is later application work. V4-1 repository must never default `enabled=true`.

`execution_runs`:

```text
id PK; kind; account_id FK NO ACTION; task_id? FK NO ACTION;
template_id FK NO ACTION; requested_by_admin_user_id? FK NO ACTION;
business_date?; idempotency_key UNIQUE; status DEFAULT PENDING;
confirmed_at?; started_at?; finished_at?; created_at; updated_at
```

Checks:

- scheduled: taskId and businessDate required, requestedBy/confirmed null；
- test: taskId/businessDate null, requestedBy and confirmedAt required；
- ISO business date invariant via existing pattern；
- non-empty namespaced idempotency key；
- status enum and terminal finishedAt consistency。

Indexes: account+created, task+businessDate, status+created.

`target_send_records`:

```text
id PK; run_id FK NO ACTION; task_id? FK NO ACTION; contact_id FK NO ACTION;
business_date?; template_id? FK SET NULL; message_text; machine_status DEFAULT READY;
attempt_count DEFAULT 0; next_retry_at?; failure_code?;
target_identity_kind_snapshot; target_identity_value_digest;
send_action_started_at?; sent_at?; started_at?; finished_at?;
created_at; updated_at
```

Checks: non-empty message/digest; identity kind/machine status/failure code enums; attempts `0..5`; RETRY_WAIT iff nextRetryAt non-null; scheduled identity tuple is all present or all absent; READY/RUNNING/SUCCESS have no failureCode; RETRY_WAIT/FAILED/DELIVERY_UNKNOWN/SKIPPED require one; SUCCESS requires `sendActionStartedAt` and `sentAt`; DELIVERY_UNKNOWN requires `sendActionStartedAt` and an after-action failure code; FAILED/SKIPPED must not have sentAt. Unique `(run_id,contact_id)` plus partial unique `(task_id,contact_id,business_date)` where all non-null. Index contact+created and status.

V4-1 repository stores machine truth only. It does not implement retry classification, verifier or coordinator. Legal persistence transitions are exact:

```text
ExecutionRun:
  PENDING → RUNNING | CANCELLED | FAILED | AUTH_EXPIRED
  RUNNING → SUCCESS | PARTIAL_FAILED | FAILED | DELIVERY_UNKNOWN |
            AUTH_EXPIRED | CANCELLED
  terminal → no transition

TargetSendRecord:
  READY → RUNNING | SKIPPED
  RUNNING → RETRY_WAIT | SUCCESS | FAILED | DELIVERY_UNKNOWN
  RETRY_WAIT → RUNNING | FAILED | SKIPPED
  terminal → no transition
```

`delivery_resolutions`:

```text
id PK; target_send_record_id? FK NO ACTION;
legacy_send_record_id? FK NO ACTION; original_machine_status;
resolution; source DEFAULT HUMAN; resolved_by_admin_user_id FK NO ACTION;
note?; supersedes_resolution_id? FK NO ACTION UNIQUE;
resolved_at; created_at
```

Checks: exactly one record FK is non-null; original status exactly DELIVERY_UNKNOWN; resolution/source enum; note length <=500 after trim. Repository verifies referenced record currently/historically has machine status DELIVERY_UNKNOWN, verifies supersedes belongs to same record, and append-only creates a linear chain. No update/delete methods.

### 8.5 Audit and legacy bridge tables

`audit_events`:

```text
id PK; actor_admin_user_id? FK SET NULL; action; entity_type;
entity_id?; outcome; reason_code?; correlation_digest?; created_at
```

All strings non-empty when present; action/entity/outcome use the frozen shared constants. `reasonCode` is an uppercase safe code matching `^[A-Z][A-Z0-9_]{0,63}$`, not arbitrary prose. No generic metadata JSON column in V4-1 because it invites secret/PII dumping. Index createdAt, actor+created, entityType+entityId+created. Repository only exposes a typed allowlist create input and no update/delete.

`legacy_friend_bindings`:

```text
id PK; friend_id FK NO ACTION UNIQUE; account_id FK NO ACTION;
contact_id? FK NO ACTION; status DEFAULT PENDING;
bound_by_admin_user_id? FK NO ACTION; bound_at?; dismissed_at?;
created_at; updated_at
```

Checks enforce exact PENDING/BOUND/DISMISSED field combinations. Repository binding transaction verifies Friend, Contact and stored account IDs are identical; no name/identity matching.

`legacy_schedule_imports`:

```text
id PK; schedule_id FK NO ACTION UNIQUE; account_id FK NO ACTION;
status DEFAULT PENDING; start_time; end_time; timezone;
max_attempts; retry_interval_seconds; legacy_enabled_snapshot;
converted_task_id? FK NO ACTION; converted_by_admin_user_id? FK NO ACTION;
converted_at?; dismissed_at?; created_at; updated_at
```

Checks preserve schedule/time/retry invariants and exact PENDING/CONVERTED/DISMISSED field combinations.

## 9. Migration behavior

### 9.1 Immutable history

Do not edit bytes, metadata or timestamps of migrations `0000`–`0007`. After schema changes, use Drizzle Kit's custom migration mode so the new snapshot/journal describe the target schema while SQL is written as the exact additive operations in this Spec:

```bash
pnpm --filter @sparkkeeper/database exec drizzle-kit generate \
  --config drizzle.config.ts --custom --name v4-foundation
```

Fill the generated empty `0008` SQL with reviewed `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX` and deterministic backfill statements only. This is required because a normal SQLite diff may propose rebuilding `accounts` merely to add checks; V4-1 forbids that rebuild. No `DROP TABLE`, `DROP COLUMN`, `RENAME`, table rebuild, destructive copy, `db push`, data deletion or status rewrite is permitted.

### 9.2 Backfill

The migration inserts exactly:

- one `legacy_friend_bindings(PENDING)` per existing Friend；
- one `legacy_schedule_imports(PENDING)` per existing Schedule, copying schedule snapshot and `enabled` snapshot；
- Account additive defaults described in §8.1.

Backfill IDs are exact deterministic strings: `v4:legacy-friend-binding:` + Friend ID and `v4:legacy-schedule-import:` + Schedule ID. Do not use `random()` in SQL. `INSERT ... SELECT ... WHERE NOT EXISTS` plus UNIQUE constraints must make it idempotent.

The migration inserts zero:

```text
AdminUser / AdminSession / AccountLoginSession / AvatarAsset / ContactSyncRun /
Contact / ContactIdentity / SendTask / SendTaskTarget / ExecutionRun /
TargetSendRecord / DeliveryResolution / AuditEvent
```

Do not infer Contact from displayName/matchKey or infer Template/targets from environment/config.

### 9.3 V3 preservation proof

The populated V3 fixture must snapshot every column of all rows in:

```text
accounts friends message_templates schedules daily_runs send_records
system_events notification_configs
```

After migration, compare those legacy columns field-for-field, including SUCCESS/FAILED/DELIVERY_UNKNOWN, message text, action boundary and timestamps. Account comparison excludes only new additive columns, which are asserted separately.

## 10. Repository contracts

Repository methods return domain copies, never mutable Drizzle rows. Every write sets timestamps in one transaction and returns a safe typed error code for NOT_FOUND/CONFLICT/INVALID_STATE/VALIDATION/INTEGRITY.

Required minimum behavior:

- `AdminUserRepository`: create initial user, find by normalized username/id, record login success/failure/lock state, change hash+increment sessionVersion, disable; no password hashing；
- `AdminSessionRepository`: create from caller-supplied digests/expiry, find active by token digest, touch without exceeding absolute expiry, revoke one/all user sessions, delete only expired/revoked cleanup rows；
- `AccountLoginSessionRepository`: create ADD/RELOGIN, find active, compare-and-transition legal state, expire/cancel; no processes/filesystem；
- `ContactRepository`: create/update metadata, add/observe/supersede identity, explicitly set preferred, list identities, apply complete-sync stale transition; all identity/account invariants transactional；
- `ContactSyncRepository`: create, start and finish safe-count sync run; no parser/browser；
- `AvatarAssetRepository`: metadata create/reference/find/expiry candidates; no network/filesystem reads/writes；
- `SendTaskRepository`: create disabled, replace targets transactionally, update disabled Task, disable/archive; **do not expose enable in V4-1**—V4-8 adds enable only with full application validation/release gates；
- `ExecutionRunRepository`: create structurally valid TEST/SCHEDULED runs and target snapshots, get by idempotency key, guarded machine state transitions; no send/retry decisions；
- `DeliveryResolutionRepository`: append and list immutable chain, enforce unknown source/exact record；
- `AuditEventRepository`: append/list bounded safe event fields；
- `LegacyMigrationRepository`: list pending bridge/import and explicit bind/dismiss/mark-converted primitives; it never searches by name or creates Task automatically。

If an operation would require application-level policy not present yet, expose the smallest persistence primitive with an explicit precondition name or omit it. Do not hide policy guesses inside repositories.

## 11. DatabaseClient and exports

- Add every table to the schema object/export so Drizzle relational references and generated types work；
- add typed row/new-row exports and repository/domain exports from package indexes；
- extend `DatabaseInspection` with explicit V4 table columns/compatibility, not one opaque `v4Compatible` boolean only；
- `migrate()` fails closed if any legacy or V4 table is incompatible；
- expected applied migration count becomes 9 if exactly one `0008` is generated；
- read-only open/inspection behavior remains read-only；
- CLI `check`/smoke prints safe schema/migration status only, never row content, identity, message, password hash/digest, URL or note。

Do not edit committed `dist/` output manually. Repository convention determines whether build artifacts are intentionally tracked; inspect Git tracking first and report rather than guessing.

## 12. API and frontend impact

Required impact: **none**.

- no route/schema/service/controller changes under `apps/server/src/http`；
- no auth behavior or mutation guard changes；
- no Vue route/page/component/API type changes；
- existing V3 endpoint responses remain byte/shape compatible except internal TypeScript Account objects may gain fields that serializers explicitly ignore；
- no Docker/Nginx/Caddy/Compose/environment changes。

If compile compatibility requires a non-runtime import/type adjustment outside `packages/shared` or `packages/database`, report it as a deviation before editing.

## 13. Compatibility requirements

- Account/Friend/Template/Schedule/DailyRun/SendRecord/SystemEvent/NotificationConfig repositories and tests remain PASS；
- existing `AccountRepository.create({name})` and update calls retain their behavior；
- V3 Scheduler/Manual Run continue using V3 tables only; V4 tables do not change selection or idempotency；
- old Friend rows remain editable/readable by compatibility code；
- old Schedule remains readable and is not disabled/modified by migration；
- existing DELIVERY_UNKNOWN is untouched；
- SQLite WAL, busy timeout, synchronous mode and read-only client behavior remain unchanged；
- no runtime code references a V4 repository in this Milestone。

## 14. Required tests

### 14.1 Shared domain

- every enum constant and validator accepts exact valid values and rejects unknown/case variants；
- time/retry/streak/note/name normalization boundaries；
- no validator silently falls back identity kind/value。

### 14.2 Migration matrix

1. fresh DB: exact 9 journal entries, all legacy+V4 tables/columns/indexes；
2. migrations run twice: no new journal/bridge/import rows；
3. close/reopen/remigrate: identical inspection；
4. each supported historical prefix 0000–0007 upgrades；
5. fully populated 0007 fixture preserves all eight V3 domains field-for-field；
6. two same-displayName Friends produce two PENDING bridges and zero Contacts；
7. enabled legacy Schedule produces PENDING import with snapshot and zero SendTasks；
8. existing DELIVERY_UNKNOWN remains exact, no Resolution created；
9. Account new defaults and partial secUid uniqueness；
10. `PRAGMA foreign_key_check` empty and `integrity_check` ok。

Historical helper functions must remain capable of constructing old prefixes without copying the new journal entry into their temporary source state.

### 14.3 Constraint/repository matrix

- each enum/required/check/FK/unique constraint has at least one negative test；
- duplicate Contact display/remark allowed; duplicate active stable identity rejected；
- preferred identity uniqueness, supersede rules and account match；
- SYSTEM/UNKNOWN rejected as Task target；cross-account target rejected；
- SendTask defaults disabled and archived cannot enable；
- scheduled/test Run structural CHECKs and idempotency conflict；
- Target record uniqueness and action-boundary status invariants；
- DeliveryResolution exactly-one source, unknown-only, append-only linear chain；
- bridge/import exact state fields and no name-based binding；
- audit create input cannot accept arbitrary metadata/message/identity fields；
- Admin active singleton and session expiry/revocation primitives；
- legal and illegal AccountLoginSession transitions；
- read-only DB write attempts still fail。

All fixtures use obvious fictional identifiers/messages/URLs. Never copy local `data/`, `.secrets`, logs, screenshots or production rows into tests.

## 15. Commands

Run from repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @sparkkeeper/shared test
pnpm --filter @sparkkeeper/database exec drizzle-kit generate --config drizzle.config.ts --custom --name v4-foundation
git diff -- packages/database/migrations packages/database/migrations/meta
pnpm --filter @sparkkeeper/database test
pnpm --filter @sparkkeeper/database db:smoke
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git status --short
git diff --check
```

Do not run Docker production smoke, BrowserSession, admin Manual Run or any command requiring real profile/Douyin. If migration generation is nondeterministic or proposes destructive SQL, STOP with `SPEC_BLOCKER`.

## 16. Acceptance Criteria

V4-1 is ready for Codex review only when all are true:

1. only allowed foundation files changed；
2. migrations `0000`–`0007` byte-identical；
3. exactly reviewed additive `0008+` exists；
4. SQLite/WAL/Drizzle remain；
5. all schema/type/repository contracts above implemented；
6. populated V3 fixture proves all legacy fields preserved；
7. one pending bridge/import per legacy row and no duplicates；
8. zero automatically created Contact/Task/Admin/Run/Resolution；
9. zero enabled V4 Task after migration；
10. displayName duplicates remain representable；
11. stable identity/preferred/account constraints pass；
12. modern scheduled idempotency uniqueness is Task+Contact+BusinessDate；
13. machine DELIVERY_UNKNOWN and human resolution remain separate；
14. no HTTP/frontend/runtime/deployment behavior change；
15. complete required command suite PASS；
16. no secret/profile/PII/message fixture or artifact appears in diff；
17. working tree remains uncommitted；
18. implementation report uses §19 exactly。

## 17. Security and privacy checks

- passwordHash/tokenDigest/csrfDigest are opaque persistence fields; never log or return them；
- no default password, setup user, seed Admin, auth bypass or Web setup endpoint；
- AuditEvent has no arbitrary payload/JSON blob；
- raw Contact identity/message/remote avatar URL never appears in test names, logs or CLI output；
- migration output contains table/version/count only；
- no absolute profile/cache/evidence path is stored by new repository APIs；
- FK deletion behavior preserves history；
- repository queries are parameterized through Drizzle/SQLite bindings；
- state changes that touch multiple tables are atomic transactions；
- all list methods have a bounded limit and deterministic order；
- no production database or fixture derived from production is used。

## 18. Forbidden changes

The following automatically require `CHANGES_REQUESTED` unless Codex approved a deviation in advance:

- any file under `packages/automation`、`packages/message-engine`、`packages/notifier`；
- any runtime/application/http/frontend/Docker/Nginx/config behavior；
- any edit to migration `0000`–`0007` or their snapshots；
- table rename/drop/rebuild or legacy data/status rewrite；
- auto Friend→Contact binding or displayName uniqueness；
- auto Schedule→enabled Task conversion；
- PostgreSQL/Redis/new external service；
- auth implementation/default credentials；
- Browser/Profile filesystem operations；
- resolver/verifier/send/scheduler implementation；
- adding real identity/message/token/cookie/URL/profile files；
- commit/push/PR/merge/tag/deploy。

## 19. Required implementation report

Development Agent final response must be exactly structured as follows:

```text
IMPLEMENTATION_COMPLETE

1. Starting commit
2. Branch
3. Files changed
4. Migration added
5. Migration SQL summary
6. Schema implemented
7. Repositories implemented
8. Compatibility behavior
9. Tests added
10. Commands run and exact results
11. Runtime source changes (must be 0)
12. Frontend changes (must be 0)
13. Production changes (must be 0)
14. Real Douyin accesses (must be 0)
15. Real sends (must be 0)
16. Git commits (must be 0)
17. Deviations (must be NONE, or list each pre-approved deviation)
18. Known limitations / blockers
19. Uncommitted git status
```

Do not claim review PASS. Only Codex may later produce `CODE_REVIEW_PASS` or `CHANGES_REQUESTED` after independently rereading this Spec, inspecting the full diff/migration/security/privacy surface and rerunning tests/lint/typecheck/build.
