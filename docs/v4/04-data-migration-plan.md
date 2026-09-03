# SparkKeeper V3 → V4 Data Migration Plan

> 状态：FROZEN
> 数据库决定：V4.0.0 继续 SQLite + WAL + Drizzle + forward-only versioned migrations。
> 已执行 migration `0000`–`0007` immutable；只能新增 `0008+`。
> 政策：V4 是第一个真实生产基线；V3 是未实际生产使用的开发原型。本文保留已接受的开发/历史 preservation baseline，不代表当前存在真实生产数据迁移义务，也不授权新增 V3 compatibility bridge。

## 1. 目标与不变量

Migration 必须：

- fresh DB 与任一历史 migration prefix 都能升级到同一 schema；
- 保存 Account、Friend、Template、Schedule、DailyRun、SendRecord、SystemEvent、NotificationConfig 每一行；
- 不把 Friend 按 displayName 自动绑定 Contact；
- 不把 V3 Schedule 直接启用为 V4 Task；
- 不改变历史 machine status、message snapshot、timestamps 或 ids；
- 不移动/复制/删除 Browser Profile；
- 可重复执行而不重复 backfill bridge row；
- 失败时事务回滚，应用 fail closed；
- 不承诺 SQL rollback；回退只能停服并恢复完整备份。

这些不变量约束已经接受的 V4-1 legacy structures 与显式历史 fixture 升级路径。Compatibility 为 `BEST_EFFORT_ONLY`；V4 architecture/security correctness 优先。除非未来明确 Spec 要求，不扩展 Friend/Schedule compatibility，不为假设的 V3 部署新增迁移负担，也不在本次政策对齐中删除已接受结构。

## 2. Physical compatibility strategy

### 2.1 原表保留

以下物理表不 rename/drop：

```text
accounts
friends
message_templates
schedules
daily_runs
send_records
system_events
notification_configs
```

`accounts` 只做 additive columns。其余 V3 表在 V4-1 不做 table rebuild，降低 history/FK/CHECK 风险。

### 2.2 新表

V4 foundation 新增：

```text
admin_users
admin_sessions
account_login_sessions
avatar_assets
contact_sync_runs
contacts
contact_identities
send_tasks
send_task_targets
execution_runs
target_send_records
delivery_resolutions
audit_events
legacy_friend_bindings
legacy_schedule_imports
```

TestSendIntent 等 execution-specific transient 表在其 Milestone 以更高 migration 新增，不塞入 V4-1 foundation，除非 V4-1 Spec 明确列出。

## 3. `accounts` additive evolution

新增 nullable/checked columns：

```text
avatar_remote_url
avatar_cache_key
douyin_unique_id
douyin_short_id
douyin_sec_uid
profile_state NOT NULL DEFAULT 'MIGRATION_REQUIRED'
lifecycle_status NOT NULL DEFAULT 'ACTIVE'
last_auth_check_at
last_contact_sync_at
unbound_at
```

约束/index：

- `profile_state IN ('PROVISIONING','READY','MIGRATION_REQUIRED','MISSING','QUARANTINED')`；
- `lifecycle_status IN ('ACTIVE','UNBOUND')`；
- partial unique `douyin_sec_uid` where non-null；
- optional IDs trim-normalized by repository；migration 不从 Account name 推断任何 ID；
- `name` 保留并作为 V4 displayName compatibility field。

现有 Account 全部得到：

```text
profile_state = MIGRATION_REQUIRED
lifecycle_status = ACTIVE
new Douyin/profile/avatar fields = null
```

即使 V3 global profile 存在，SQL migration 也不宣称它属于某 Account。

## 4. Legacy Friend

### 4.1 原数据

`friends` 原行、identity candidates、matchField/matchKey、enabled、timestamps 不改。

### 4.2 Bridge backfill

每个 Friend 创建一行：

```text
legacy_friend_bindings
- id
- friend_id UNIQUE
- account_id
- contact_id NULL
- status = PENDING
- bound_by_admin_user_id NULL
- bound_at NULL
- dismissed_at NULL
- created_at / updated_at
```

Backfill 使用 `INSERT ... SELECT ... WHERE NOT EXISTS` 或唯一冲突 no-op，保证重复 migrate/fixture 不重复。

禁止：

- 创建同名 Contact；
- 使用 friend.matchKey 自动选择新 Contact；
- 把 Friend enabled 解释为 V4 target authorization；
- 删除/disable Friend 以“清理”数据。

首次 V4 Contact Sync 后，Admin 在专用 UI 搜索并明确选择同 Account Contact。Binding 只创建桥接，不自动创建/enable Task。

## 5. Legacy Schedule

V3 Schedule 没有持久化 Template ID 或 target set；环境变量中的 Template/Account 不是可迁移业务关系。因此不创建 schema-invalid 或可能误启用的 SendTask。

每个 Schedule backfill：

```text
legacy_schedule_imports
- id
- schedule_id UNIQUE
- account_id
- status = PENDING
- start_time / end_time / timezone
- max_attempts / retry_interval_seconds
- legacy_enabled_snapshot
- converted_task_id NULL
- converted_by_admin_user_id NULL
- converted_at NULL
- dismissed_at NULL
- created_at / updated_at
```

用户选择 Template 与 1..N Contacts 后，conversion transaction 创建 `enabled=false` 的完整 SendTask，并标记 import `CONVERTED`。原 Schedule 永远保留历史兼容；V4 Scheduler 不读取它。

## 6. Legacy Runs / SendRecords

- `daily_runs` 与 `send_records` 原表不改；
- `(account,businessDate)` 与 `(friend,businessDate)` unique constraint 保持；
- status、`send_action_started_at`、messageText、attempt/error/timestamps 原值保持；
- 现有 `DELIVERY_UNKNOWN` 不转 SUCCESS/FAILED；
- V4 `execution_runs/target_send_records` 不写 legacy tables；
- unified read model/API 增加 `source: LEGACY_V3 | V4`；
- legacy SendRecord 的 DeliveryResolution 通过 `legacy_send_record_id` 与 modern `target_send_record_id` 二选一引用，或统一稳定 reference table；实现必须保证 exactly-one source CHECK。

冻结的 DeliveryResolution source columns：

```text
target_send_record_id NULL FK target_send_records(id)
legacy_send_record_id NULL FK send_records(id)
CHECK exactly one is non-null
```

这样无需复制/改写 legacy SendRecord。

## 7. Template / Notification / SystemEvent

- `message_templates` 直接复用；不复制、不重序 messages；
- `notification_configs` singleton 直接复用，包括 delivery unknown preference；
- `system_events` 直接保留，不改 eventType/error/path/history；
- 新 human/security mutation 写 `audit_events`，避免为了新增 auth event 重建 CHECK-limited legacy SystemEvent；
- 后续如要统一 event table，只能通过单独 migration + read model，不属于 V4-1。

## 8. Browser Profile migration

SQL migration 永不触碰 filesystem。V4 profile root：

```text
old: <DATA_DIR>/browser-profile/
new: <DATA_DIR>/browser-profiles/<accountId>/
```

### 8.1 只有一个 legacy Account

operator 可在停服、完整备份后运行未来专用 CLI：

1. 确认 normal/maintenance/browser 全部停止；
2. 备份整个 data root（DB+WAL/SHM+Profile）；
3. 确认 DB 恰好一个 `MIGRATION_REQUIRED` Account；
4. 检查 old profile 存在且 target path 不存在；
5. 同 filesystem atomic rename 到 `<accountId>` path；
6. transaction 更新 `profileState=READY`；
7. offline auth check 不自动执行；启动后 Account loginStatus 先保持 UNKNOWN/原值，必须显式 auth check；
8. Audit safe result。

CLI 不读取/输出 cookie/token/profile contents。

### 8.2 多个或归属不明

禁止猜测 global profile 归属。所有 Account 保持 `MIGRATION_REQUIRED`；用户逐 Account 使用 RELOGIN/重新绑定创建独立 profile。旧 profile 只 quarantine，不自动复制给多个 Account。

### 8.3 Failure

任何 source/target/ownership/backup 条件不满足立即 STOP；不得删除 lock、覆盖 target 或递归清理 data root。

## 9. Migration execution phases

### Phase A — Preflight（只读）

- verify supported source migration count/schema；
- `PRAGMA integrity_check`；
- `PRAGMA foreign_key_check`；
- record row counts/status distributions for all V3 tables；
- confirm free disk space and complete backup；
- confirm application/Scheduler/maintenance stopped；
- confirm `SCHEDULER_ENABLED=false`。

### Phase B — Schema transaction

- apply next immutable Drizzle migration(s) `0008+`；
- add Account columns/indexes；
- create V4 tables/checks/FKs/indexes；
- backfill only legacy bridge/import rows；
- do not create AdminUser, Contact, Task, Run or Resolution business rows except explicit bridge/import rows。

### Phase C — Verification（只读）

- old/new migration count；
- exact old table row counts unchanged；
- exact status/message/timestamp samples unchanged；
- one bridge per Friend；
- one import per Schedule；
- zero auto Contact bindings；
- zero enabled SendTasks from migration；
- zero DeliveryResolution from migration；
- Account new columns as expected；
- `foreign_key_check` empty；
- close/reopen/repeat migrate has no changes。

### Phase D — Application bootstrap

- service starts with Scheduler/real-send/Manual Run false；
- no AdminUser means fail-closed Admin and minimal health only；
- operator initializes Admin through hidden-stdin CLI；
- legacy Account remains blocked until explicit profile binding/relogin；
- Contact Sync/Test Send/Scheduler remain unavailable until their Milestones/Gates。

## 10. Required migration tests

1. fresh database creates all V3+V4 tables and exact indexes/checks；
2. fixture at migration 0000 through current upgrades without data loss；
3. full populated V3 `0007` fixture preserves every domain row and field；
4. same displayName across two Friends creates two independent PENDING bindings and zero Contacts；
5. legacy Schedule with enabled=true creates PENDING import and zero enabled Tasks；
6. SUCCESS/FAILED/DELIVERY_UNKNOWN records remain byte/field equivalent；
7. NotificationConfig/Webhook URL remains stored but never appears in test output/log；
8. reopen/repeat migrate idempotence；
9. FK/check/unique violations fail；
10. Account secUid/profile lifecycle repository validation；
11. exactly-one legacy/modern reference for DeliveryResolution；
12. DatabaseClient `inspect()` recognizes all expected tables/columns and updated migration count。

所有 fixtures 使用虚构 identity/message/URL，不复制生产 DB 或联系人。

## 11. Backup / rollback

V4 migration 是 forward-only。若未来显式授权从历史 V3 data root 执行升级，升级前必须备份完整 data root，并在 DB/Browser 均停止时完成。若 migration/app verification 失败：

1. 停止新版本；
2. 保存失败日志（不得包含 secret/data dump）；
3. 不手工 reverse SQL；
4. 将失败 data root 整体隔离；
5. 从升级前完整备份恢复到空 data root；
6. 启动原 V3 image/version 并只读验证；
7. 修复 migration 后重新走 review/release。

禁止 `db push`、destructive sync、删除 DB、`git reset --hard`、`git clean` 或只复制 `.db` 而遗漏活动 WAL/SHM/Profile。

## 12. Data retention/privacy

- Profile、DB、avatar cache、logs/evidence 始终 untracked data root；
- migration log 只输出版本、表/row count 与 safe status count，不输出 Friend/Contact identity、messageText、Webhook URL；
- legacy bridge UI 只在 authenticated detail 中按最小需要显示旧 displayName；
- Avatar bytes 默认 stale/unbound 后 30 天清理，Profile quarantine 默认 30 天；
- history rows 与 DeliveryResolution 由用户明确 retention policy 后才可能归档，V4.0 不自动删除。
