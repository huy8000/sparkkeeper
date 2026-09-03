# SparkKeeper V4 API Draft

> 状态：FROZEN DRAFT（endpoint/side-effect contract 冻结；实现可拆文件但不得改变语义）
> Base path：`/api`
> Transport：same-origin JSON；production 为 HTTPS，显式 loopback development 可为 HTTP；SSE/console 例外在本文单列。

## 1. 共同协议

### 1.1 Envelope

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "error": { "code": "STABLE_CODE", "message": "Safe message" } }
```

错误响应不包含 stack、SQL、absolute path、identity value、message text、cookie/token 或原始 browser error。

### 1.2 Auth/Mutation guard 等级

| Code | 要求                                                                                          |
| ---- | --------------------------------------------------------------------------------------------- |
| P    | Public；仅最小 health 或 login                                                                |
| L    | Public login guard：configured canonical Host/Origin（production HTTPS；loopback development HTTP）、JSON、`Sec-Fetch-Site: same-origin`、per-IP/user rate limit |
| S    | 有效 AdminSession；读请求；server-side idle/absolute expiry                                   |
| M    | S + exact Origin + `Sec-Fetch-Site: same-origin` + JSON + session-bound `X-SparkKeeper-CSRF`   |
| R    | M + 5 分钟内 recent password re-auth                                                          |
| D    | R + typed confirmation/expected version；危险 mutation                                        |
| I    | M/D + required `Idempotency-Key`；重复 key 返回 canonical operation                           |

旧 `X-SparkKeeper-Admin-Request: 1` 可过渡保留，但从不替代 S/M/R/D/I。

### 1.3 Pagination / concurrency

- list 默认 `limit=50`，最大 `100`（Contacts 最大 `200`）；
- cursor 是 opaque、bounded、不可包含 raw identity；
- mutation DTO 带 `expectedUpdatedAt` 或 `expectedVersion` 时，冲突返回 409；
- async mutation 返回 202 与 durable ID；
- browser/send/onboarding/sync POST 客户端不得自动 retry；网络不确定时通过 GET 查询；
- Send/Test mutation 强制 `Idempotency-Key`，最大 128 ASCII chars，按 Admin+endpoint namespace 存储。

### 1.4 通用错误

| HTTP | Code 示例                                            | 含义                                    |
| ---: | ---------------------------------------------------- | --------------------------------------- |
|  400 | `VALIDATION_ERROR`                                   | schema/input invalid                    |
|  401 | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED` | 未认证或 session 失效                |
|  403 | `ORIGIN_REJECTED`, `CSRF_REJECTED`, `REAUTH_REQUIRED`   | guard 不满足                         |
|  404 | `*_NOT_FOUND`                                        | resource 不存在；不得用于 username 枚举 |
|  409 | `STATE_CONFLICT`, `VERSION_CONFLICT`, `PROFILE_BUSY` | 状态/lease/idempotency 冲突             |
|  410 | `INTENT_EXPIRED`, `LOGIN_SESSION_EXPIRED`            | 临时资源过期                            |
|  422 | `IDENTITY_UNAVAILABLE`, `TARGET_NOT_SENDABLE`        | domain invariant 阻止                   |
|  429 | `RATE_LIMITED`                                       | 登录限流；响应不暴露 username 存在性    |
|  503 | `SERVICE_NOT_INITIALIZED`, `AUTH_SERVICE_UNAVAILABLE`, `RUNTIME_UNAVAILABLE`, `RELEASE_GATE_CLOSED` | 初始化、安全门或 runtime 不可用 |

## 2. Auth

| Method / Path                           | Guard | Request                         | Response                                                                            | Side effects                                                                                      |
| --------------------------------------- | ----- | ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /auth/login`                      | L     | `{username,password}`           | `{admin:{id,username}, csrfToken, idleExpiresAt, absoluteExpiresAt}` + `Set-Cookie` | uniform password verify；成功创建/rotate Session、Audit；V4-2 使用 memory IP/username admission + Argon2 gate，不读写 persisted failure/lock fields |
| `GET /auth/me`                          | S     | —                               | `{admin,csrfToken,idleExpiresAt,absoluteExpiresAt,recentlyReauthenticated}`         | bounded lastSeen/idle expiry refresh；不 rotate raw token                                         |
| `POST /auth/logout`                     | M     | `{}`                            | `204`                                                                               | revoke current session、clear cookie、Audit                                                       |
| `POST /auth/reauth`                     | M     | `{password}`                    | `{reauthenticatedUntil}`                                                            | 验证当前 Admin，Session 标记 5 分钟 recent re-auth；失败 rate-limit/Audit                         |
| `POST /auth/change-password`            | R     | `{currentPassword,newPassword}` | `204`                                                                               | Argon2id rehash、sessionVersion++、revoke all sessions（包括当前）、clear cookie、Audit           |
| `GET /auth/sessions`                    | S     | —                               | session summaries：id/created/lastSeen/expires/current                              | 无 token/IP/User-Agent 原文                                                                       |
| `POST /auth/sessions/:sessionId/revoke` | R     | `{expectedSessionVersion}`      | `204`                                                                               | revoke selected session、Audit；当前 session 时同时 clear cookie                                  |

未初始化时 `/auth/login` 返回统一 `SERVICE_NOT_INITIALIZED`，不提供公网 setup。初始化/重置只通过 hidden-stdin operator CLI。

V4-2 的 milestone authority 是 [V4-2 Implementation Specification](./specs/v4-2-implementation-spec.md)：该 Milestone 的 login 只使用 bounded process-memory trusted-IP/normalized-username admission + process-wide Argon2 gate；不清零、增加或检查 `failedLoginCount`/`lockedUntil`/`lastFailedLoginAt`。上表保留的 reauth/password/session-management endpoints 是 future draft，不属于 V4-2。

## 3. Overview

| Method / Path   | Guard | Request                | Response                                                                                                                                            | Side effects                                    |
| --------------- | ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /overview` | S     | optional timezone/date | bounded aggregate：Accounts READY/AUTH_EXPIRED、Contacts、enabled Tasks、today Runs/status counts、pending resolutions、next Tasks、attention items | read-only；不返回 identity/message/profile path |

## 4. Accounts 与 Onboarding

| Method / Path                                | Guard | Request                                                      | Response                                                                                | Side effects                                                                                    |
| -------------------------------------------- | ----- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /accounts`                              | S     | cursor/filter                                                | Account summaries（same-origin avatar URL）                                             | read-only                                                                                       |
| `GET /accounts/:accountId`                   | S     | —                                                            | Account detail + profile/auth/sync derived status                                       | read-only；无 absolute profile path                                                             |
| `POST /account-login-sessions`               | M + I | `{purpose:"ADD_ACCOUNT"}` 或 `{purpose:"RELOGIN",accountId}` | `202 {loginSessionId,status,expiresAt,consolePath}`                                     | reserve slot/profile lease；创建 durable session；启动 ephemeral console；绝不发送              |
| `GET /account-login-sessions/:id`            | S     | —                                                            | status、expiresAt、safe failureCode、`resultAccountId?`                                 | read-only；READY 后 server 可自动 finalize Account                                              |
| `POST /account-login-sessions/:id/cancel`    | M     | `{expectedUpdatedAt}`                                        | session summary                                                                         | 关闭 console/browser、释放 lease、staging profile quarantine/cleanup、Audit                     |
| `GET /account-login-sessions/:id/console`    | S     | HTML request                                                 | no-store no-frame console shell                                                         | 每次校验 active session/TTL；不返回 VNC password/internal port                                  |
| `GET /account-login-sessions/:id/console/ws` | S     | WebSocket upgrade                                            | proxied noVNC stream                                                                    | 持续校验 session；完成/过期即关闭                                                               |
| `POST /accounts/:accountId/auth-checks`      | M + I | `{}`                                                         | `202 {operationId}`                                                                     | account profile lease、normal `/chat` auth check；不 sync、不发送                               |
| `GET /account-auth-checks/:operationId`      | S     | —                                                            | `{operationId,accountId,status,resultLoginStatus?,failureCode?,startedAt?,finishedAt?}` | read-only；不返回页面证据/路径                                                                  |
| `POST /accounts/:accountId/unbind`           | D     | `{confirmationText,expectedUpdatedAt}`                       | Account detail（UNBOUND）                                                               | cancel operations、disable Tasks、quarantine profile、Contacts unavailable、Audit；不删 history |

Account 自动创建发生在 AccountLoginSession READY 后的 server-side completion state machine，不允许客户端提交 displayName/secUid/profile path。

## 5. Contacts / Sync / Identity / Legacy Binding

| Method / Path                                     | Guard | Request                                             | Response                                                              | Side effects                                                                   |
| ------------------------------------------------- | ----- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /accounts/:accountId/contacts`               | S     | cursor, query, `type`, availability, identityStatus | Contact summaries                                                     | read-only；remote avatar URL/raw identity 默认不返回                           |
| `POST /accounts/:accountId/contact-syncs`         | M + I | `{}`                                                | `202 {syncRunId,status}`                                              | profile/browser lease；normal `/chat` bounded discovery/upsert；绝不发送       |
| `GET /contact-syncs/:syncRunId`                   | S     | —                                                   | status + safe counts + failureCode + started/finished                 | read-only；无 candidate dump                                                   |
| `GET /contacts/:contactId`                        | S     | —                                                   | metadata、sendable reason、masked identity summaries、Task references | read-only；identity value 仅 detail 中按最小需要显示 masked/适当展示 Douyin ID |
| `POST /contacts/:contactId/preferred-identity`    | D     | `{identityId,expectedUpdatedAt,confirmationText}`   | Contact detail                                                        | transaction 切换 preferred、identityStatus 重算、Audit；不触发 send            |
| `GET /accounts/:accountId/legacy-friend-bindings` | S     | cursor/status                                       | pending legacy target summaries                                       | 不按 displayName 推荐自动 match；可显示人工搜索入口                            |
| `POST /legacy-friend-bindings/:bindingId/bind`    | D     | `{contactId,expectedUpdatedAt}`                     | binding summary                                                       | 校验同 Account；明确 bind；Audit；不启用 Task/send                             |
| `POST /legacy-friend-bindings/:bindingId/dismiss` | D     | `{expectedUpdatedAt}`                               | binding summary                                                       | 标记 dismissed；Friend/history 不删除                                          |
| `GET /avatar-assets/:assetId`                     | S     | conditional cache headers                           | image bytes or placeholder/404                                        | same-origin only；`private, no-store` 或短 private cache；无 remote redirect   |

Sync mutation 遇到 AUTH_EXPIRED 停止并更新 Account；partial/failed sync 不标记 unseen Contact stale。

## 6. Templates

| Method / Path                  | Guard | Request                                 | Response                            | Side effects                                                             |
| ------------------------------ | ----- | --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `GET /templates`               | S     | cursor/enabled                          | summary + referenced Task count     | read-only，无 messages                                                   |
| `GET /templates/:templateId`   | S     | —                                       | detail + messages + Task references | read-only                                                                |
| `POST /templates`              | M     | `{name,providerType,messages,enabled?}` | `201` detail                        | create；Audit；默认 enabled 保持 V3 compatibility，但新 Task 仍 disabled |
| `PATCH /templates/:templateId` | M     | mutable fields + `expectedUpdatedAt`    | detail                              | validate；Audit；不改变既有 SendRecord snapshot                          |

V4.0 没有 Template DELETE；disable 已被 enabled Task 引用时返回影响列表并要求单独确认或先 disable Tasks。

## 7. Test Send

| Method / Path                                 | Guard | Request                                 | Response                                                                             | Side effects                                                                                      |
| --------------------------------------------- | ----- | --------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `POST /accounts/:accountId/test-send-intents` | M     | `{templateId,contactIds:[1..20]}`       | `{intentId,expiresAt,payloadDigest,account,templateSummary,orderedTargets,warnings}` | 只创建 preview intent；不打开 Browser、不生成最终 random message、不发送                          |
| `POST /accounts/:accountId/test-sends`        | D + I | `{intentId,confirm:true,payloadDigest}` | `202 {runId,status:"PENDING"}`                                                       | 原子 consume intent；冻结 Template/identity/message snapshots；启动 server-owned sequential batch |
| `GET /test-sends/:runId`                      | S     | —                                       | Test Run + per-target statuses + abort reason                                        | read-only；与 `/runs/:id` 同 canonical DTO                                                        |

`test-sends` 客户端不得 retry POST。若网络不确定，使用同一 Idempotency-Key 查询/重提并得到 canonical Run。`DELIVERY_UNKNOWN`/AUTH/global failure 停止剩余目标。

## 8. SendTask

| Method / Path                 | Guard | Request                                                                                                                                      | Response                                      | Side effects                                                                                 |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /tasks`                  | S     | cursor, accountId, enabled, blocked                                                                                                          | Task summaries + next window/overlap warnings | read-only                                                                                    |
| `POST /tasks`                 | M     | `{name,accountId,templateId,schedule:{type:"DAILY_WINDOW",startTime,endTime,timezone,maxAttempts,retryIntervalSeconds},contactIds:[1..100]}` | `201` Task detail with `enabled=false`        | transaction create Task+targets；Audit；绝不执行                                             |
| `GET /tasks/:taskId`          | S     | —                                                                                                                                            | Task detail、targets、derived status/warnings | read-only                                                                                    |
| `PATCH /tasks/:taskId`        | M     | disabled-only mutable fields + expectedUpdatedAt                                                                                             | Task detail                                   | transaction validate/update；enabled Task 返回 409；Audit                                    |
| `POST /tasks/:taskId/enable`  | D     | `{expectedUpdatedAt,acknowledgeOverlaps:true}`                                                                                               | Task detail                                   | 重新验证 Account/Profile/Auth/Template/Contacts/release gate；set enabled；Audit；不立即执行 |
| `POST /tasks/:taskId/disable` | M     | `{expectedUpdatedAt}`                                                                                                                        | Task detail                                   | stop future claims；active send 到安全边界结束；Audit                                        |
| `POST /tasks/:taskId/archive` | D     | `{expectedUpdatedAt,confirmationText}`                                                                                                       | Task detail                                   | 仅 disabled/no active Run；soft archive；history 保留                                        |

Task target 不用独立 public CRUD；修改通过 disabled Task PATCH 的完整 `contactIds` 集合，transaction diff，避免部分配置。

## 9. Legacy Schedule Import

| Method / Path                               | Guard | Request                                          | Response                               | Side effects                                                       |
| ------------------------------------------- | ----- | ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| `GET /legacy-schedule-imports`              | S     | accountId/status                                 | pending import summaries               | read-only                                                          |
| `POST /legacy-schedule-imports/:id/convert` | D     | `{name,templateId,contactIds,expectedUpdatedAt}` | `201` disabled Task + converted import | 复用 legacy window/retry，创建有效 disabled Task；原 Schedule 保留 |
| `POST /legacy-schedule-imports/:id/dismiss` | D     | expectedUpdatedAt                                | import summary                         | 标记 dismissed；Schedule/history 不删除                            |

## 10. Runs / Send Records / Resolution

| Method / Path                              | Guard | Request                                               | Response                                                                       | Side effects                                                                    |
| ------------------------------------------ | ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET /runs`                                | S     | cursor, source, kind, accountId, taskId, date, status | mixed V4/legacy summaries with `source`                                        | read-only                                                                       |
| `GET /runs/:runId`                         | S     | —                                                     | canonical Run detail + source/kind/aggregate                                   | read-only                                                                       |
| `GET /runs/:runId/send-records`            | S     | cursor/status/type                                    | per-target records + latest human resolution                                   | read-only；message text 默认不在 list                                           |
| `GET /runs/:runId/events`                  | S     | cursor                                                | safe operational/audit timeline                                                | read-only                                                                       |
| `GET /send-records/:recordId`              | S     | —                                                     | full machine state/evidence flags/message template reference/latest resolution | read-only；不返回 profile/absolute evidence path/raw identity                   |
| `GET /send-records/:recordId/resolutions`  | S     | cursor                                                | append-only resolution history                                                 | read-only                                                                       |
| `POST /send-records/:recordId/resolutions` | D     | `{resolution,note?,expectedLatestResolutionId}`       | `201` DeliveryResolution                                                       | 仅 machine DELIVERY_UNKNOWN；append Audit/Resolution；不改 record/run、不 retry |

Legacy IDs 和 V4 IDs 通过 source-aware lookup；对 legacy `DELIVERY_UNKNOWN` 也允许创建 resolution。Resolution 表固定使用 `target_send_record_id` 与 `legacy_send_record_id` 两个 nullable FK，并以 exactly-one CHECK 表示来源。

## 11. Notifications

| Method / Path                            | Guard | Request                                       | Response             | Side effects                                          |
| ---------------------------------------- | ----- | --------------------------------------------- | -------------------- | ----------------------------------------------------- |
| `GET /notification-config`               | S     | —                                             | config（URL masked） | read-only                                             |
| `PUT /notification-config`               | M     | existing V3 config fields + expectedUpdatedAt | config               | SSRF validation、save、Audit；不发送测试              |
| `POST /notification-config/test-intents` | M     | `{}`                                          | preview/intent TTL   | no network                                            |
| `POST /notification-config/tests`        | D + I | `{intentId,confirm:true}`                     | delivery result      | 一次真实 webhook；fixed server payload；不访问 Douyin |

## 12. Runtime / System / SSE

| Method / Path              | Guard | Request             | Response                                                             | Side effects                                                        |
| -------------------------- | ----- | ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /health`              | P     | —                   | minimal `{serviceName,status}`                                       | 不暴露 version/DB/migration/gates                                   |
| `GET /runtime/status`      | S     | —                   | DB/migration/observability/profile/login-worker/master gates/version | read-only；无 path/secret                                           |
| `GET /system/audit-events` | S     | cursor/type/outcome | safe audit summaries                                                 | read-only                                                           |
| `GET /events/stream`       | S     | EventSource         | `ready`, runtime/config/auth-invalidated events                      | cookie auth；no durable replay；session revoke/expiry closes stream |

SSE 事件只传 internal IDs、safe status/error codes、resource invalidation；不传 display name、identity、message、remote URL、session/login-console material。

## 13. Side-effect matrix

| Capability           | DB write | Browser/Profile |        External network | Real message possible |
| -------------------- | -------: | --------------: | ----------------------: | --------------------: |
| Login/Auth           |       是 |              否 |                      否 |                    否 |
| Account LoginSession |       是 |              是 |        正常 Douyin 页面 |                    否 |
| Auth Check           |       是 |              是 |        正常 Douyin 页面 |                    否 |
| Contact Sync         |       是 |              是 | 正常 Douyin 页面/assets |                    否 |
| Template/Task config |       是 |              否 |                      否 |                    否 |
| Test Send intent     |       是 |              否 |                      否 |                    否 |
| Test Send execute    |       是 |              是 |        正常 Douyin 页面 |                    是 |
| Scheduler Task run   |       是 |              是 |        正常 Douyin 页面 |                    是 |
| Delivery Resolution  |       是 |              否 |                      否 |                    否 |
| Notification test    |       是 |              否 |      configured webhook |                    否 |
| Runtime/System reads |       否 |              否 |                      否 |                    否 |

任何 endpoint 的 side effect 不得超出本表。尤其 Account/Contact/Task 普通 mutation 不启动 send，GET 不 mutation。
