# V4-9 Migration Completion & Observability

状态：IMPLEMENTED / VERIFIED（待 PR review/merge）。基线 `develop@d606a098e19c362e924a581b120d9135c68bd566`；V4-8 MERGED / ACCEPTED。

## 冻结范围

显式 legacy profile 绑定/已有 RELOGIN 指引、Friend 绑定、Schedule 导入、统一 Run/SendRecord 读取、UNKNOWN 人工 resolution、安全 audit/runtime/SSE/notification、离线迁移 rehearsal 与恢复文档。无自动身份匹配、自动 Task enable、发送或浏览器启动；生产 scheduler/send gate 继续关闭。无真实 Gate B/C/D/E/F。

## 事务与迁移

- 原 0000–0012 不修改。0013 仅增加 profile binding intent、V4 safe system events，扩展 audit action allowlist、追加只读历史保护；保留所有 legacy 行/字段，绝不 backfill Contact/Task/Resolution。
- Bridge 操作用 bridge UUID + `expectedUpdatedAt`，PENDING CAS；BEGIN IMMEDIATE 中同时发布结果和 audit。绑定必须同 Account、ACTIVE、非 PROVISIONING，显式选择 PERSON/GROUP Contact（不按名称/位置猜测）。
- Schedule conversion 使用存储的 window/retry snapshot；显式 name/template/1–100 Contact。Task/targets/import/audit 单事务，Task 永远 disabled；旧 Schedule 不变。
- DeliveryResolution 只接受原机器 DELIVERY_UNKNOWN。调用者必须提交 `expectedLatestResolutionId`（首次 null）；事务中核对唯一链尾，追加 HUMAN resolution + audit，原 record/run/message 不更新。note ≤500，仅鉴权 detail 可读，不进入日志/SSE/notification/audit。

## 离线 profile 工具

CLI 只接受 DATA_DIR 和 Account UUID，不能接受 profile 路径。通过 native helper 持有与 Docker app/maintenance 相同的 `browser-profile.lock`（nonblocking flock），操作前需要显式 stopped/完整备份确认，检查 gates 关闭、DB 无 runtime ownership、无 worker/browser proof/Singleton lock。多 Account 所有权不明确时拒绝，逐账号使用已有 RELOGIN。

`MIGRATION_REQUIRED → PREPARED intent → native marker + atomic NOREPLACE rename → COMPLETED intent / Account READY+login UNKNOWN`。只允许恰好一个 ACTIVE legacy Account、无 stable identity、固定旧 `browser-profile`；intent 持久化 source dev/inode 和 operation UUID。helper dirfd/O_NOFOLLOW、源 inode/marker 校验、同 filesystem、不覆盖目标。失败保留 intent/marker；重复调用只恢复该 intent，绝不猜测其他目录。PREPARED 在普通 runtime admission 中 fail closed，必须离线恢复后才允许 RELOGIN。无 cookie/token 内容读取；备份不由 schema migration 执行。

## Read model 与安全事件

- Run source `LEGACY_V3|V4`，kind `LEGACY_DAILY|TEST_SEND|SCHEDULED_TASK`，统一 DTO 保留机器状态。原 UUID 保留；跨 source UUID 冲突返回 CONFLICT（无默认优先级）。列表 source/kind/account/task/date/status + bounded cursor/limit；无 message、identity digest/value、profile path、session secret。
- 旧 SystemEvent 投影固定 safeMessage；V4 独立 system-event 表只存 enum/内部 ID/机器状态/time，SQL trigger 与 runtime state 同事务生成 start/terminal/UNKNOWN facts。不重写 V3 CHECK/history。
- SSE 为资源 invalidation 与固定 runtime message；notifications 复用现有 SSRF-safe publisher/配置/cooldown。进程内 relay 从启动时最新事件水位开始，无历史 replay/自动补发；持久 events 才是审计读取依据，relay best effort、不可决定 send 成败。
- Audit GET allowlist 投影，不返回 correlationDigest、note、raw identity、raw exception/URL；缺失/未知 reason 使用安全 null。HTTP 不记录请求 body/响应 secrets；补充 note/name/identity 等 redact。retention：历史/audit/resolution 不自动删除；avatar bytes 沿用30天；profile quarantine 仅30天后离线、备份确认后操作，不在线自动清除。

## API / 最小 UI

S：`GET /accounts/:accountId/legacy-friend-bindings`、`/legacy-schedule-imports`、`/runs`、`/runs/:id`、`/runs/:id/send-records`、`/runs/:id/events`、`/send-records/:id`、`/send-records/:id/resolutions`、`/system/audit-events`、`/system/migration-status`。

R + explicit `confirmationText` + CAS：`POST /legacy-friend-bindings/:id/{bind,dismiss}`、`/legacy-schedule-imports/:id/{convert,dismiss}`、`/send-records/:id/resolutions`。原 Account POST 保持关闭。所有 POST 保持 Origin/Fetch/JSON/CSRF/recent auth；无自动请求 retry。

混合 Run list 保持既有 array envelope 兼容，增加安全 source/kind/task 字段，分页 cursor 通过 `X-SparkKeeper-Next-Cursor`；旧客户端明确请求 LEGACY_V3。新增迁移操作页和统一历史页/详情，危险动作人工确认、CAS冲突需刷新；无 profile path 输入、无 Task enable 按钮。已有 RELOGIN 路由复用。

## 实施与验证顺序

contract/schema → migration/DB aggregates → offline profile tooling/rehearsal → unified reads/API → safe event relay → minimal UI/docs → self-review/fix → affected workspace tests/typecheck/build → diff/security check → commit/push/PR。

Focused tests：同 Account/CAS/import rollback、UNKNOWN chain concurrency/append-only、source collision/redaction/pagination、native inode/symlink/NOREPLACE 与 crash intent恢复、populated V3 fixture exact preservation/reopen/完整备份还原、S/R/CSRF安全、relay不可泄露/不可阻断业务、最小 UI不自动绑定/enable。Linux-only runtime fixture 跳过需明确记录；不执行真实 Douyin/生产网络/生产迁移，既有 browser fixture 仅使用受控本地合成页面。不堆 proof matrix。

## 最终离线验证

- shared 33/33、database 301/301、admin-web 401/401；server 486 cases：483 PASS、3 Linux-only skipped on macOS、0 failures。
- Linux Docker fixtures（与部署一致的 `--init`）：28/28 PASS，包括 detached group、late launch/recovery、profile dirfd/NOREPLACE 与迁移 API/rehearsal；仅 Node browser-shaped child，不启动 Chromium/Douyin。
- `v4:migration:smoke` 5/5 PASS：合成 populated V3、read-only preflight、schema upgrade/reopen、完整 root backup/restore、intent crash recovery、真实进程 flock。
- affected shared/database/server/admin-web typecheck、server/admin-web production build、native helpers、Docker compose config、app-runtime image 与 runtime/native migration packaging PASS。
- 本次变更 ESLint/Prettier、git diff --check PASS。全仓 `pnpm lint` 的 Prettier 阶段仍命中 3 个既有 onboarding 文件和 9 个本地忽略文件；未格式化这些既有/用户文件。三个既有 fixture ESLint 小问题已无语义变化地修正。

Self-review：P0=0、P1=0。已知非阻断 P2：既有 `SupervisorContract.start()` 的 void 类型未反映生产 async implementation（调用已 await）；全仓既有 formatting debt。最小 UI 完整中英/IA/可访问性整合属于 V4-10。分页是有界 offset cursor，不承诺并发写入下的 snapshot；CAS mutation 始终重新核对版本。SSE/notification best effort、不 replay；durable events/read API 为事实源。未执行生产迁移、Gate A 整体 release 验收或任何 live Gate。
