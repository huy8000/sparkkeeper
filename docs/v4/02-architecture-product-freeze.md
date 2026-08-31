# SparkKeeper V4 架构与产品冻结

> 状态：FROZEN
> 起始实现：`develop@37903c8`
> 数据库：SQLite + WAL + Drizzle + additive versioned migrations
> 本文冻结 V4.0.0 的领域、生命周期、安全、运行与 UI 边界。

## 1. V3 事实基线

架构建立在实际仓库而不是绿地假设之上：

- pnpm/TypeScript ESM monorepo；
- Fastify API + Vue/Vite Admin + Nginx same-origin proxy；
- SQLite/WAL/Drizzle，已执行 migration `0000`–`0007`；
- V3 `accounts`、`friends`、`message_templates`、`schedules`、`daily_runs`、`send_records`、`system_events`、`notification_configs` 已有真实数据兼容义务；
- persistence 可保存 Friend 的 `secUid/uniqueId/shortId/remarkName/displayName`，但 `ProductionDailyTaskAutomation` 实际只传 `friend.displayName`；
- ContactResolver 以虚拟列表 index 去重，遇到首个名称 match 就返回，不能证明后续没有同名项；
- MessageSender 以当前挂载 outgoing node 的 count、同文本 count 与 DOM marker 判定新增 bubble，不能可靠处理 virtualization/unmount/remount；
- Scheduler/Manual Run/BrowserSession/Compose 都围绕一个全局 Profile、一个配置 Account/Template 与一个 Account Schedule；
- 当前 mutation header/Host/Origin 是 local-only guard，不是公网认证；
- V3 已有 `send_action_started_at` 与“可能已发送就不 retry”的正确安全原则，V4 必须保留并收紧 API。

## 2. 架构边界

```text
Internet
  → Caddy 2 edge (public 80/443, ACME, HTTPS redirect)
  → Admin Nginx (internal 8080, static SPA + /api proxy)
  → Fastify application (internal 8080)
       ├─ Auth / API / SSE
       ├─ Application coordinators
       ├─ Drizzle repositories → SQLite WAL
       ├─ account-scoped Browser/Profile lease manager
       └─ internal AccountLoginSession console gateway
              → loopback-only ephemeral Xvfb/Chromium/x11vnc/websockify
```

逻辑分层保持：

| 层             | V4 职责                                                                                |
| -------------- | -------------------------------------------------------------------------------------- |
| Presentation   | Login/Admin SPA、REST、SSE、console gateway                                            |
| Application    | onboarding、sync、test/task run、idempotency、state machine、audit                     |
| Domain         | Admin、Account、Contact/Identity、Template、Task、Run、SendRecord、Resolution          |
| Automation     | account-scoped BrowserSession、normal `/chat` adapter、person/group resolver、verifier |
| Infrastructure | SQLite/Drizzle、Caddy/Nginx、profile/cache/evidence paths、Pino、notification          |

Selector、DOM、page response parser 只能存在于 `packages/automation`。Application 不引用 Playwright Locator；API 不直接访问 repository；前端不推断 domain status。

## 3. Domain Model 冻结

### 3.1 复用、新增、废弃与兼容

| Domain                      | 决定                | 说明                                                                  |
| --------------------------- | ------------------- | --------------------------------------------------------------------- |
| AdminUser                   | 新增                | V4.0 单实例只允许一个 ACTIVE 管理员；schema 保留以后扩展可能          |
| AdminSession                | 新增                | opaque cookie session；DB 只存 token/CSRF digest                      |
| DouyinAccount               | 演进复用 `accounts` | 不新建平行 Account 表，保留全部 legacy FK/history                     |
| AccountLoginSession         | 新增                | `ADD_ACCOUNT`/`RELOGIN` 临时会话及自动创建结果                        |
| Contact                     | 新增                | V4 Directory 与 ChatTarget 的 canonical entity                        |
| ContactIdentity             | 新增独立表          | 保存多 identity、来源、时间、preferred 与变更历史                     |
| Friend                      | deprecated/兼容保留 | 不删除、不自动按 displayName 绑定；V4 runtime/UI 不再以 Friend 为目标 |
| MessageTemplate             | 原表复用            | API/UI 继续称 Template；不复制内容                                    |
| Schedule                    | deprecated/兼容保留 | 不再驱动 V4 Scheduler；迁移成 pending import                          |
| SendTask                    | 新增                | Account+Template+window+retry policy                                  |
| SendTaskTarget              | 新增                | Task 与 Contact 多对多关联                                            |
| DailyRun                    | legacy read-only    | V3 history 保留；V4 新运行使用 ExecutionRun                           |
| ExecutionRun（UI/API: Run） | 新增                | `TEST_SEND` 或 `SCHEDULED_TASK` batch                                 |
| SendRecord                  | 新增现代物理表      | 每个 Run/Contact 一个 machine record；V3 `send_records` 保留为 legacy |
| DeliveryResolution          | 新增                | append-only human resolution，不覆盖 machine truth                    |
| SystemEvent                 | V3 复用             | legacy/runtime operational facts；旧数据不改                          |
| AuditEvent                  | 新增                | login、password、unbind、binding、resolution 等人/安全审计            |
| NotificationConfig          | 原表复用            | V4 Operations 页面继续使用 singleton config                           |
| AvatarAsset                 | 新增                | Admin 只渲染 same-origin cached asset                                 |
| ContactSyncRun              | 新增                | async sync lifecycle 与安全计数结果                                   |
| LegacyFriendBinding         | 新增                | Friend→Contact 的显式人工绑定桥                                       |
| LegacyScheduleImport        | 新增                | Schedule→disabled SendTask 的人工补全桥                               |

### 3.2 AdminUser

规范字段：

```text
id
username
usernameNormalized (UNIQUE)
passwordHash (Argon2id PHC string)
status: ACTIVE | DISABLED
sessionVersion
failedLoginCount
lockedUntil
lastFailedLoginAt
lastLoginAt
passwordChangedAt
createdAt
updatedAt
```

V4.0 service invariant：最多一个 `ACTIVE` AdminUser。没有开放注册/创建用户 API。

### 3.3 AdminSession

```text
id
adminUserId
tokenDigest (UNIQUE; raw token never stored)
csrfTokenDigest
sessionVersion
reauthenticatedAt?
createdAt
lastSeenAt
idleExpiresAt
absoluteExpiresAt
revokedAt
revokeReason
```

Raw session/CSRF token 只存在于生成时和客户端内存/cookie；不得进 URL、日志、SystemEvent、SSE 或错误响应。

### 3.4 DouyinAccount (`accounts` 演进)

保留 V3 字段 `id/name/enabled/loginStatus/lastLoginAt/createdAt/updatedAt`，其中 `name` 成为 UI `displayName` 的兼容存储。新增：

```text
avatarRemoteUrl?
avatarCacheKey?
douyinUniqueId?
douyinShortId?
douyinSecUid? (unique when present)
profileState: PROVISIONING | READY | MIGRATION_REQUIRED | MISSING | QUARANTINED
lifecycleStatus: ACTIVE | UNBOUND
lastAuthCheckAt?
lastContactSyncAt?
unboundAt?
```

Account persisted login status 继续是 `READY | AUTH_EXPIRED | UNKNOWN`。`CHECKING` 是进行中的 auth operation 派生 UI 状态，不写入 V3 CHECK-limited column。

### 3.5 AccountLoginSession

```text
id
purpose: ADD_ACCOUNT | RELOGIN
accountId?                 # RELOGIN target
pendingAccountId?          # ADD_ACCOUNT reserved final UUID
createdByAdminUserId
status: PENDING | STARTING | AWAITING_USER | READY_DETECTED |
        COMPLETING | COMPLETED | EXPIRED | CANCELLED | FAILED
expiresAt
startedAt?
readyDetectedAt?
completedAt?
cancelledAt?
failureCode?
createdAt
updatedAt
```

约束：ADD_ACCOUNT 只有 `pendingAccountId`，RELOGIN 只有 `accountId`。同一 Account 最多一个 active relogin session；V4.0 全局最多一个 active LoginSession，冲突返回 409。

### 3.6 Contact

```text
id
accountId
type: PERSON | GROUP | SYSTEM | UNKNOWN
displayName
remarkName?
avatarRemoteUrl?
avatarAssetId?
streakDays?
streakUpdatedAt?
availabilityStatus: AVAILABLE | STALE | UNAVAILABLE
identityStatus: READY | UNAVAILABLE | CHANGED | AMBIGUOUS | LEGACY_UNBOUND
discoveredAt
lastSeenAt
lastFullSyncId?
missedFullSyncCount
createdAt
updatedAt
```

Contact 名称、头像、streak 均为 metadata，不是 canonical identity。

### 3.7 ContactIdentity 必须独立表

独立表是冻结决定，原因：一个 Contact 同时拥有多个 identity；identity 会新增、消失、改变；必须保留来源/观察时间和 preferred 切换审计；把全部字段平铺在 Contact 会丢失历史并诱发 silent priority recompute。

```text
id
accountId                  # 用于 account-scoped unique index
contactId
kind: SEC_UID | UNIQUE_ID | SHORT_ID | REMARK_NAME |
      DISPLAY_NAME | CONVERSATION_ID
value
normalizedValue
source: DOM | PAGE_DATA | RESPONSE_PARSER | LEGACY_MANUAL | HUMAN_REBIND
state: ACTIVE | SUPERSEDED
isPreferred
firstObservedAt
lastObservedAt
supersededAt?
createdAt
updatedAt
```

约束：

- 稳定 kind `SEC_UID/UNIQUE_ID/SHORT_ID/CONVERSATION_ID` 的 `(accountId, kind, normalizedValue)` 对 ACTIVE identity 唯一；
- mutable `DISPLAY_NAME/REMARK_NAME` 不唯一，必须能表示同名 Contact；
- 每个 Contact 最多一个 ACTIVE preferred identity；
- `accountId` 必须与 Contact 一致，由 repository transaction 校验；
- identity value 不进入普通日志/SSE；
- 新建 PERSON Contact 时只在本次可靠发现的稳定 identity 中按 `SEC_UID → UNIQUE_ID → SHORT_ID` 选初始 preferred；新建 GROUP 固定选 `CONVERSATION_ID`；
- Contact 已存在后，preferred 不因新字段出现而自动改变。

### 3.8 SendTask / SendTaskTarget

```text
SendTask
- id
- name
- accountId
- templateId
- scheduleType: DAILY_WINDOW
- startTime / endTime          # [start,end), same-day
- timezone                    # IANA
- maxAttempts                 # 1..5, includes first attempt
- retryIntervalSeconds        # 1..86400
- enabled                     # default false
- archivedAt?
- createdAt / updatedAt

SendTaskTarget
- taskId
- contactId
- createdAt
- UNIQUE(taskId, contactId)
```

Task 只在 disabled 时允许修改 Account/Template/schedule/targets。enable 前重新验证 Account/Profile/Auth、Template、target type/availability/identity 与全局 release gate。

### 3.9 ExecutionRun / SendRecord

V4 物理表使用 `execution_runs` 与 `target_send_records`，避免重建/覆盖 legacy `daily_runs`/`send_records`。

```text
ExecutionRun
- id
- kind: TEST_SEND | SCHEDULED_TASK
- accountId
- taskId?                     # required for scheduled
- templateId
- requestedByAdminUserId?     # required for test send
- businessDate?               # required for scheduled
- idempotencyKey              # unique, namespaced
- status: PENDING | RUNNING | SUCCESS | PARTIAL_FAILED |
          FAILED | DELIVERY_UNKNOWN | AUTH_EXPIRED | CANCELLED
- confirmedAt?                # required for test send
- startedAt? / finishedAt?
- createdAt / updatedAt

TargetSendRecord (Domain/API name: SendRecord)
- id
- runId
- taskId?
- contactId
- businessDate?
- templateId?
- messageText                 # immutable known outbound snapshot
- machineStatus: READY | RUNNING | RETRY_WAIT | SUCCESS | FAILED |
                 DELIVERY_UNKNOWN | SKIPPED
- attemptCount
- nextRetryAt?
- failureCode?
- targetIdentityKindSnapshot
- targetIdentityValueDigest   # audit correlation; raw value is not logged
- sendActionStartedAt?
- sentAt?
- startedAt? / finishedAt?
- createdAt / updatedAt
```

每个 `(runId, contactId)` 唯一。Scheduled record 另外唯一 `(taskId, contactId, businessDate)`。

### 3.10 DeliveryResolution

```text
id
targetSendRecordId?          # V4 record
legacySendRecordId?          # V3 record; exactly one source must be set
originalMachineStatus         # V4.0 must be DELIVERY_UNKNOWN
resolution: CONFIRMED_DELIVERED | CONFIRMED_NOT_DELIVERED | INCONCLUSIVE
source: HUMAN
resolvedByAdminUserId
note?
supersedesResolutionId?
resolvedAt
createdAt
```

只 INSERT，不 UPDATE/DELETE。最新链尾是 effective human resolution；全部历史仍显示。Note 最多 500 字，UI 明示不得粘贴聊天正文或认证信息。

### 3.11 SystemEvent / AuditEvent / NotificationConfig

- V3 `system_events` 保留 machine/runtime truth 与旧 FK；V4 runtime event 扩展在专门 migration 中进行，不回写历史；
- `audit_events` 为 append-only，记录 actor、action、entity type/id、outcome、safe reason code 与 timestamp，不保存密码、token、identity value、消息正文、URL secret、IP/User-Agent 原文；
- `notification_configs` 原表复用，Delivery Unknown 通知设置继续有效；Notification failure 不改变 Run/SendRecord。

## 4. Account 与 Browser Profile 生命周期

### 4.1 新 Account

```text
Admin authenticated + CSRF
  → create ADD_ACCOUNT LoginSession
  → reserve pendingAccountId
  → acquire global LoginSession slot
  → create /data/browser-profiles/.onboarding/<sessionId>
  → start loopback-only temporary console + headed Chromium
  → user scans QR / handles challenge
  → READY detector passes
  → extract required profile (displayName + secUid or uniqueId)
  → close Chromium and release staging profile process
  → create Account(profileState=PROVISIONING)
  → atomic same-filesystem rename staging → browser-profiles/<accountId>
  → Account profileState=READY, loginStatus=READY
  → LoginSession=COMPLETED
  → trigger optional Contact Sync offer (not an automatic send)
```

Crash reconciliation is explicit: Account/Profile/session combination in `PROVISIONING`/`COMPLETING` is repaired to READY only when both DB ownership and exact final directory are provable; otherwise it becomes FAILED/MISSING and blocks all sends.

### 4.2 Profile path contract

- final path: `<DATA_DIR>/browser-profiles/<accountId>/`；
- onboarding path: `<DATA_DIR>/browser-profiles/.onboarding/<loginSessionId>/`；
- quarantine path: `<DATA_DIR>/browser-profiles/.quarantine/<accountId>-<timestamp>/`；
- path components are validated UUIDs, resolved under a fixed root, and boundary-checked；
- Account A 的 service 永远不能接受 Account B 的 path 或调用方传入的 arbitrary path；
- 同一 profile 只能被一个 Browser/Profile lease 打开；
- V4.0 所有 browser send/sync/login operation 默认全局 concurrency=1，即使 profile 不同。

### 4.3 Relogin

RELOGIN session 绑定现有 Account，获取该 Account profile exclusive lease，在原 profile 内由用户本人登录。READY 后更新 Account metadata、`lastAuthCheckAt/lastLoginAt/loginStatus`，不创建新 Account，不替换 history。

### 4.4 AUTH_EXPIRED

- auth detector 或明确登录页证据将 Account 置 `AUTH_EXPIRED`；
- 当前 batch 全局停止；发送边界后的当前 record 为 DELIVERY_UNKNOWN，否则使用 auth failure；
- Task 不自动 disabled，但 derived status 为 BLOCKED；
- 只有成功 RELOGIN/auth check 才恢复 READY；
- 系统不自动登录、填密码、收验证码或处理 CAPTCHA。

### 4.5 Unbind / delete

V4.0 没有 hard-delete Account API。危险操作 `unbind` 需要近期密码 re-auth、输入确认文字与 CSRF：

1. 标记 Account `UNBOUND`、`enabled=false`、loginStatus UNKNOWN；
2. 禁用该 Account 所有 Task；
3. 取消 active LoginSession/Sync，等待 active send 到安全边界结束；
4. profile close 后移入 quarantine；
5. Contacts 置 UNAVAILABLE；
6. 保留 Account、Run、SendRecord、Resolution、Audit history。

硬删除 profile 仅为停服后的 operator CLI，默认 quarantine 30 天且需要备份/明确确认；不通过公网 Admin 自动执行。

## 5. Public Admin Security Architecture

### 5.1 网络与 TLS

- 参考部署固定使用 Caddy 2 edge；公网只 publish 80/443；
- 80 仅用于 ACME/HTTPS redirect；业务全部 HTTPS；
- Admin Nginx 与 Fastify 只在隔离 Docker network `expose 8080`；不 publish host 8080；
- 6080/5900 不 publish，也不由 Caddy 直接 proxy；
- Caddy 自动续期证书；TLS 最低 1.2，优先 1.3；
- 配置 HSTS（确认域名永久 HTTPS 后启用）、CSP、`frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、strict Referrer-Policy；
- Fastify 只信任已配置的内部 proxy hop；client IP/rate-limit key 不接受任意外部 `X-Forwarded-For`。

### 5.2 初始管理员与口令

- 无 Web 注册/首次 setup 页面；未初始化时除最小 health 外 fail closed；
- operator 使用一次性 CLI，从 hidden stdin 输入密码；密码不在 argv/env/log；
- username 规范化后唯一；密码最少 14 字符、最多 256 Unicode code points，不做会降低熵的静默变换；
- Argon2id PHC string，每用户随机 salt；最低 `m=19456 KiB, t=2, p=1`，部署时在目标硬件向上校准；
- 登录错误统一，不泄露 username 是否存在；
- 修改/重置密码增加 `sessionVersion` 并撤销全部 Session。

### 5.3 Login rate limit

- Caddy per-IP 基础限流 + application per trusted-IP、per normalized username 双维度限流；
- 默认 5 次失败/15 分钟后指数 lock，最长 1 小时；成功后清零用户失败计数；
- rate-limit/lock audit 不记录明文 IP；只记录由独立 server secret HMAC 的短期 correlation digest；
- 后端重启不得解除 AdminUser 的 persisted lock；未知用户名仍走相同耗时路径与 per-IP limiter。

### 5.4 Session 与 Cookie

- 256-bit CSPRNG opaque session token；DB 只存 SHA-256 digest；
- cookie：`__Host-sparkkeeper_session; Secure; HttpOnly; SameSite=Strict; Path=/`，无 Domain；
- server-side idle expiry 30 分钟、absolute expiry 12 小时；敏感操作 re-auth window 5 分钟；
- login 成功 rotate，新登录不接受 caller-supplied session id；
- logout server-side revoke + clear cookie；
- password change/reset、Admin disable、sessionVersion mismatch 立即 revoke；
- Session 不存 localStorage/sessionStorage；SSE 使用同一 HttpOnly cookie。

### 5.5 CSRF / Origin / CORS

- `GET/HEAD` 不产生业务 mutation；
- mutation 必须同时满足 authenticated session、exact canonical HTTPS Origin、`Sec-Fetch-Site` 非 cross-site、JSON content type、session-bound synchronizer token `X-SparkKeeper-CSRF`；
- token 由 `/api/auth/me` 返回，前端只存在内存；不在 cookie/URL/log；
- Login endpoint 无 session token，但仍要求 exact Origin/Host、JSON 与 rate limit；
- 不启用 wildcard CORS，不支持 cross-origin credentialed API；
- 旧 `X-SparkKeeper-Admin-Request: 1` 可在过渡期保留 defense-in-depth，但不再构成授权。

### 5.6 Login Session console

- console HTML/WebSocket 只能经 authenticated app route；
- route 每次检查 AdminSession、LoginSession active/owner/TTL 与 profile lease；
- ephemeral x11vnc/websockify 只绑定同一 runtime namespace 的 loopback dynamic ports；
- VNC 层不使用传给浏览器的 password，访问控制由 app gateway 完成；
- console 页面设置严格 CSP、no-store、frame deny；Session 完成/取消/过期后立即关闭 worker 与 WebSocket；
- QR screenshot、frame buffer、console URL、internal port 均不持久化到日志或 Git。

## 6. Contact Discovery 与 Avatar/Streak

### 6.1 Sync flow

```text
POST ContactSync
  → verify Admin/CSRF/Account ACTIVE+READY/Profile READY
  → acquire account profile + global browser lease
  → create ContactSyncRun(RUNNING)
  → normal navigation to /chat + auth/readiness
  → bounded scroll/pagination
  → parse typed candidates from DOM/already-loaded page data
  → within-run dedup by stable identity
  → transactional safe upsert
  → apply stale policy only after a complete sync
  → store safe counts/failure code, update Account.lastContactSyncAt
  → close browser/release lease
```

Limits：120 秒、最多 500 candidates；达到限制为 `PARTIAL`，partial/failed sync 不把未见 Contact 标 stale/unavailable。用户可显式再次同步。

### 6.2 Candidate required/optional fields

| Type    | Required to persist as resolvable                     | Optional                    |
| ------- | ----------------------------------------------------- | --------------------------- |
| PERSON  | displayName + at least one of secUid/uniqueId/shortId | remarkName, avatar, streak  |
| GROUP   | displayName + conversationId                          | avatar, memberCount, streak |
| SYSTEM  | displayName + page-provided conversation identity     | avatar                      |
| UNKNOWN | displayName + page-provided stable discovery identity | avatar/candidate metadata   |

没有稳定 discovery identity 的候选只计入 sync issue count，不持久化为可发送 Contact，也不使用 displayName 自动合并。不得使用 virtual-list index 作为 identity。

### 6.3 Dedup/upsert/change

- 同一 sync 内相同 `(kind, normalizedValue)` 合并；类型冲突进入 AMBIGUOUS，不猜；
- 先按 Account-scoped ACTIVE stable identity 查 Contact；0 创建、1 更新、>1 数据完整性错误；
- display/remark/avatar/streak 改变只更新 metadata；
- 新 candidate identity 加入 Contact，但不自动成为 preferred；
- preferred identity 未观察到、而 Contact 通过另一 identity 找到时，标记 `CHANGED` 并停止发送，等待人工确认；
- 不因 displayName/头像相同合并旧 Friend 或两个 Contact。

### 6.4 Stale/removed

- complete sync 首次未见：`STALE`、miss count +1；
- 连续 3 次 complete sync 且跨度至少 24 小时未见：`UNAVAILABLE`；
- partial/failed/auth-expired sync 不增加 miss count；
- 再次可靠发现：恢复 AVAILABLE、miss count 归零；
- 不 hard-delete Contact。

### 6.5 Avatar：hybrid 冻结

数据库保存 remote URL（刷新来源、不得直接给浏览器渲染）与 local cache key。缓存只从正常页面已经加载的 image response 获取，不用 cookie/token 重放 URL，不接受 Admin 提交任意 URL，限制 MIME/size，并保存到 `<DATA_DIR>/avatars/`。

Admin 只通过 authenticated same-origin `/api/avatar-assets/:id` 读取缓存；缓存缺失/过期显示 placeholder，不让客户端直接访问 remote URL。默认未见/解绑后 30 天清理 bytes；DB metadata 可用于后续刷新。URL、cache path 不进普通日志/SSE。

### 6.6 Streak

`streakDays` 是非负整数或 null，`streakUpdatedAt` 只在可靠观察时更新。无法识别、冲突或 stale 时显示 `—`；不从聊天正文、消息计数或时间差推算，不影响 identity/sync/send。

## 7. Stable Identity Runtime Contract

### 7.1 Resolver input

Application 只能传入：

```text
ResolverRequest
- accountId
- contactId
- contactType
- preferredIdentity { id, kind, normalizedValue, observedAt }
- expectedMetadataVersion
```

不得传入“所有字段并让 resolver 自己 fallback”。resolver 不查询 DB、不选择 preferred、不接受 list index。

### 7.2 PERSON

Person candidate 可包含 `SEC_UID/UNIQUE_ID/SHORT_ID/REMARK_NAME/DISPLAY_NAME`。resolver 只比较 request 中的 preferred kind/value，并完成有界全列表扫描或获得等价的“已穷尽当前目录”证据后才返回：

```text
0 → TARGET_NOT_FOUND
1 → FOUND + ResolutionWitness
>1 → TARGET_AMBIGUOUS
candidate lacks preferred field → TARGET_IDENTITY_UNAVAILABLE
candidate exposes conflicting known identities → IDENTITY_CHANGED
```

`ResolutionWitness` 包含本次页面内稳定 candidate key、contact type、匹配字段、打开前 metadata version 和观察 epoch；不含可在日志输出的 raw identity。

### 7.3 GROUP

GROUP resolver 是独立接口，不把群聊转成 Friend：

- required preferred identity：`CONVERSATION_ID`；
- candidate：conversationId、displayName、avatar、可用时 memberCount；
- 全扫描精确匹配 conversationId；
- 点击时以 candidate DOM handle/witness 打开；
- 打开后必须从 header/当前 conversation page data 再验证相同 conversationId；
- 只能看到 displayName、无法再验证 conversationId → `TARGET_IDENTITY_UNAVAILABLE`，不发送；
- Group send 使用共同 verifier，但必须在独立 Gate E 通过。

### 7.4 SYSTEM / UNKNOWN

可以进入 Directory 与历史，但 `sendable=false`。Test Send preview、Task target mutation 和 runtime coordinator 三层都拒绝，防止只靠 UI 隐藏。

### 7.5 Fallback 规则

V4.0 runtime 没有 silent fallback。以下不属于 fallback：

- sync 使用任一已知 ACTIVE stable identity 判断同一 Contact；
- 管理员在 Contact Detail 明确选择另一个已观察 identity 为 preferred，并确认变更；
- legacy Friend 通过专用 binding UI 人工绑定 Contact。

变更 preferred 之后，新的 resolver request 只用新的 preferred identity。DISPLAY_NAME/REMARK_NAME 可被人工设为 preferred，但 UI 必须标记 mutable/low-confidence；任何 0/multiple match 仍 STOP。系统永远不在一次发送中自动尝试下一个字段。

## 8. Test Send 与共同发送协调器

### 8.1 两阶段确认

1. `TestSendIntent`：服务器验证 Account/Template/Contacts，冻结有序 target list、Template version、预览摘要与 payload digest，TTL 10 分钟，不打开 Browser；
2. `TestSend Run`：客户端提交 intent ID、`confirm=true` 与唯一 `Idempotency-Key`；服务器原子 consume intent 并创建 Run/SendRecords，返回 202。

Intent 过期、内容版本变化、Contact 状态变化或被消费后不能执行；必须重新 preview。

### 8.2 PerTargetSendCoordinator

Test Send 与 scheduled send 共同调用：

```text
prepare immutable message/identity snapshot
  → acquire global browser + account profile lease
  → auth check
  → resolve type-specific target exactly once
  → open + reverify ResolutionWitness
  → capture verification baseline and arm mutation observer
  → prepare composer exactly
  → persist irreversible action boundary
  → invoke exactly one send control
  → verify
  → persist SUCCESS or DELIVERY_UNKNOWN
```

Coordinator 不接受 caller-provided message text、identity 或 browser path；只接受持久化 Template/Contact/Run references。Test 与 scheduled 的差异只在 intent、idempotency、batch policy 和 retry configuration。

### 8.3 Batch policy

- 固定 concurrency=1；
- 每目标独立 record；
- target-local confirmed pre-action failure 可按 policy 继续下一个；
- global browser/network/auth failure 停止 batch；
- AUTH_EXPIRED/UNKNOWN/CAPTCHA/risk-control 停止 batch；
- DELIVERY_UNKNOWN 停止 batch；
- 未开始目标为 `SKIPPED/BATCH_ABORTED`，attemptCount=0；
- browser session 在 batch 内可复用同一 Account profile，但每目标重新 resolve/open/verify；
- UI/API 不提供 force resend。

## 9. Delivery Verification 状态机

### 9.1 Evidence baseline

发送前 verifier 创建只存在内存/页面的 baseline：

- current page URL/navigation epoch；
- current conversation `ResolutionWitness`；
- mounted outgoing bubble 的 stable page-provided ID（可用时）；
- outgoing bubble fingerprint：direction + exact normalized text + available timestamp/sequence；
- baseline tail anchor（可用时）；
- known outbound text（只在当前 execution memory；DB 已有 SendRecord snapshot）；
- MutationObserver 在 click 前 armed 的时间/sequence。

不得持久化 full DOM、对方消息、history text 集合或 raw page response。

### 9.2 Exact text normalization

仅把 CRLF 规范为 LF；不 trim、不折叠空格、不做模糊/包含/Unicode 猜测。富文本/sticker 无法与已知纯文本严格等价时不能证明 SUCCESS。

### 9.3 SUCCESS

必须同时满足：

1. send action boundary 已持久化且 UI action 只调用一次；
2. conversation witness 在 action 前后仍有效；
3. post-action mutation/reconciliation 观察到 outgoing 方向；
4. text 与 immutable message snapshot 严格一致；
5. bubble 是 baseline 之后的新消息：优先以新 stable bubble ID；无 ID 时必须有未在 baseline 出现的 fingerprint 与 post-action append witness；
6. 若历史已有同文本且无 stable ID/anchor 能区分 remount 与新增，则不能 SUCCESS。

### 9.4 DELIVERY_UNKNOWN

action boundary 之后出现以下任一情况：timeout（默认 15 秒、最大 30 秒）、page/context close、navigation、message list disappear、virtualization 无法区分、only nonmatching outgoing、sticker/history interference、direction unknown、text parse conflict、auth/risk state change、observer/reconciliation failure。

`DELIVERY_UNKNOWN` 是 terminal machine truth，no retry。

### 9.5 FAILED

仅用于可以证明 action boundary 尚未跨越的 failure：navigation/readiness、resolver、conversation verify、composer/input、send-control discovery，以及 adapter 明确证明 click 未触发的受控错误。跨越 boundary 后不能写 FAILED。

### 9.6 Mutation 与 virtualization

- observer 必须先于 action；
- observer 保存最小事件 fingerprint，不保存完整节点/DOM；
- 节点从 baseline 卸载后重挂载不能自动算 new；
- 使用 page-provided message ID 时仍校验 direction/text；
- 只检查“最后一条”或当前总数变化是不合格实现；
- timeout 结束前允许一次当前 DOM reconciliation，但不能滚动读取历史正文来寻找证据。

## 10. Human Delivery Resolution

API 只允许对 `DELIVERY_UNKNOWN` SendRecord 新增 resolution。每次提交要求 auth、CSRF、recent re-auth、`expectedLatestResolutionId`（避免并发覆盖语义）、resolution、可选 note。

UI 显示：

```text
Machine: DELIVERY_UNKNOWN (immutable)
Human: CONFIRMED_DELIVERED (latest)
History: resolver, time, note, superseded chain
```

Resolution 不改变 Run machine status、idempotency、notification history，也不解锁自动 retry。Overview 可另外显示“待人工处理”和“人工确认已送达”统计。

## 11. Idempotency

### 11.1 Scheduled

```text
Run key    = scheduled:<taskId>:<businessDate>
Record key = <taskId>:<contactId>:<businessDate>
```

数据库 unique index 是最终防线，application `createOrGet/prepare` 返回 canonical row，message snapshot 第一次写入后不可覆盖。Task A 与 Task B 是两个显式业务意图，因此同一 Contact/BusinessDate 可以各发送一次；UI 在 enable 时列出跨 enabled Task 的重叠目标与窗口。

### 11.2 Test Send

```text
Run key = test:<serverNamespace>:<Idempotency-Key>
Record  = UNIQUE(runId, contactId)
```

同一个 key 重复 POST 返回同一个 Run；不同 key 代表新的明确 intent，必须重新 preview/confirm。客户端在网络不确定时先 GET Run，不自动重发 POST。

### 11.3 Legacy

V3 `(friendId,businessDate)` 约束与记录不修改。V4 records 不写 legacy table，因此不会被旧 key 错误压制，也不会破坏历史查询。

## 12. Retry Model

| Failure                                                      | Auto retry | Scope/说明                          |
| ------------------------------------------------------------ | ---------: | ----------------------------------- |
| navigation/network transient before action                   |         是 | bounded，仍在同一窗口/BusinessDate  |
| page/chat list not ready before action                       |         是 | 只对 typed transient；重新打开页面  |
| browser process transient before action                      |         是 | close/reacquire profile lease       |
| interrupted process, boundary null                           |         是 | crash recovery，复用 snapshot       |
| target not found after complete scan                         |         否 | target-local final；先 sync/inspect |
| identity unavailable/changed/ambiguous                       |         否 | target-local final；人工处理        |
| selector/parser contract failure                             |         否 | code/fixture repair；不盲重试       |
| composer/input/send control discovery                        |         否 | pre-action FAILED；人工/code repair |
| adapter proves action NOT_TRIGGERED and classifies transient |         可 | 必须显式 proof token                |
| AUTH_EXPIRED/UNKNOWN/CAPTCHA/risk                            |         否 | global stop                         |
| action possibly happened                                     |         否 | DELIVERY_UNKNOWN/global stop        |
| delivery timeout/nonmatching/sticker/virtualization          |         否 | DELIVERY_UNKNOWN/global stop        |

Retry 必须复用第一次 message/identity snapshot；不得重新运行 RandomProvider 生成另一条消息。

## 13. Run Aggregation

优先级：

```text
AUTH_EXPIRED
> DELIVERY_UNKNOWN
> FAILED / PARTIAL_FAILED
> RUNNING / PENDING
> SUCCESS
```

- 任一 unknown → Run `DELIVERY_UNKNOWN`；
- 无 unknown、部分 success + 部分 confirmed pre-action failed/skipped → `PARTIAL_FAILED`；
- 全部 failed/skipped → `FAILED`；
- 全部 success → `SUCCESS`；
- machine aggregate 永不因 human resolution 重写。

## 14. V3 Migration Compatibility

- 详细步骤见 [迁移计划](./04-data-migration-plan.md)；
- `accounts` 原地扩展，旧行 `profileState=MIGRATION_REQUIRED`；
- Friend/Schedule/DailyRun/SendRecord/SystemEvent 不删除、不重命名、不回写；
- 每个 Friend 创建 `LegacyFriendBinding(PENDING)`，不创建自动 Contact match；
- 每个 Schedule 创建 `LegacyScheduleImport(PENDING)`，不创建缺 Template/target 的无效 Task；
- Template/NotificationConfig 直接复用；
- 历史 API 用统一 DTO 标记 `source=LEGACY_V3`，现代运行标记 `source=V4`；
- migration 本身不移动 Browser Profile；profile binding 是停服、备份、显式 operator step。

## 15. API 与 Mutation Contract

完整冻结见 [API Draft](./03-api-draft.md)。共同规则：

- strict JSON schemas and envelopes；
- session auth except minimal health/login；
- mutation = auth + exact Origin + Fetch Metadata + CSRF + JSON；
- dangerous mutation = 上述条件 + recent re-auth + typed confirmation/expected version；
- async browser/send/sync mutation 返回 `202` 与 durable operation/run ID；
- POST send/onboarding/sync 不由 client 自动 retry；
- list endpoint cursor pagination + bounded limit；
- raw identity、remote avatar URL、message body、profile/evidence absolute path 不进入 list DTO/SSE；
- 409 用于 state/version/idempotency/profile lease conflict；429 用于 auth/rate limit。

## 16. Observability 与 Privacy

- Pino/SystemEvent/AuditEvent 使用 allowlist fields；
- identity 日志只允许 internal contactId 与 keyed digest，不输出 raw secUid/conversationId；
- message text 不输出日志/SSE/SystemEvent/AuditEvent；
- auth/session/CSRF/login-console token 全部 redact；
- Screenshot/Trace 只在受控 failure policy 下本地保存，AccountLoginSession QR/console 不自动截图；
- evidence path 必须 relative + root boundary check；
- Avatar cache、Profile、DB、logs/evidence 全部在 ignored data root；
- API list 默认不返回 remote avatar URL，返回 same-origin asset endpoint；
- DeliveryResolution note 明示禁止聊天正文，仍视为敏感业务数据，不写日志。

## 17. Frontend IA 冻结

| 页面              | Primary goal                  | Data source                     | Main actions                                           | Dangerous actions                      | Empty state                                           | Error state                             |
| ----------------- | ----------------------------- | ------------------------------- | ------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| Login             | 建立 AdminSession             | `/auth/login`, `/auth/me`       | login                                                  | 无；rate limit 提示不枚举用户          | 首次未初始化提示 operator CLI                         | generic credentials/rate/network        |
| Overview          | 看今天结果与需处理项          | `/overview`                     | refresh、跳转异常                                      | 无                                     | 无 Account/Run/Task 的引导                            | 分区 stale/error，不泄露 runtime detail |
| Accounts          | 添加/查看账号                 | `/accounts`                     | Add Account、进入 detail                               | unbind 只在 detail                     | 添加第一个 Account                                    | list error + retry                      |
| Account Overview  | 判断账号能否工作              | account/runtime summary         | auth check、relogin、sync shortcut                     | unbind（reauth+typed confirm）         | profile migration/onboarding guide                    | auth/profile/sync 分区错误              |
| Account Contacts  | 发现并选择目标                | contacts + latest sync          | sync、search/filter、detail、preferred identity/rebind | legacy binding/preferred change 需确认 | 从未 sync / 无 resolvable contacts / unresolved count | partial sync、AUTH_EXPIRED、stale data  |
| Account Test Send | 安全预览并执行                | templates/contacts/intents/runs | select、preview、confirm、view result                  | confirm send（精确 target count）      | 无 template/contacts 时给前置链接                     | intent expired、batch aborted、unknown  |
| Account Tasks     | 管理该 Account 的 Tasks       | `/tasks?accountId=`             | create disabled、edit、enable/disable、archive         | enable/archive                         | 无 Task 引导                                          | validation/conflict/blocked             |
| Account History   | 看该 Account Runs             | `/runs?accountId=`              | filter、open run                                       | 无                                     | 无 history                                            | paginated error/stale                   |
| Templates         | 管理消息源                    | `/templates`                    | create/edit/preview/enable                             | disable referenced template 需影响预览 | 创建模板                                              | validation/reference conflict           |
| Tasks             | 跨账号查看任务与 next run     | `/tasks`                        | filter、open、enable/disable                           | enable/archive                         | 无 Task                                               | blocked reason/state conflict           |
| Runs              | 查 Test/Scheduled/Legacy 运行 | `/runs`                         | filter、open                                           | 无                                     | 无 runs                                               | list error/stale                        |
| Run Detail        | 看每目标 machine/human truth  | run/records/events/resolutions  | filter target、resolve unknown                         | resolution 需 reauth/confirm           | 无 records 说明 pending/cancelled                     | section-level errors                    |
| Notifications     | 配置高价值通知                | notification config             | save、fixed test                                       | test 发真实 webhook，明确确认          | 未配置 guide                                          | SSRF/config/delivery result             |
| System            | 看 runtime/security/gates     | runtime/security summary        | refresh、session list/revoke self-other                | revoke sessions/password change        | 无异常为 healthy                                      | 不显示 secret/path/raw error            |

Account workspace tab 顺序固定：`Overview → Contacts → Test Send → Tasks → History`。旧 `/friends`、`/schedule`、`/manual-run` 只提供 compatibility redirect/legacy read surface，不作为 V4 navigation。

## 18. Release Gate 与 Scheduler

Scheduler 具有两层 gate：

1. operator master environment gate，V4 开发及 Gate A–E 始终 false；
2. 每个 SendTask `enabled`；即使 Task enabled，master gate false 也不执行。

Gate F 启用前必须有可审计证据证明 Auth、Profile isolation、Person/Group resolver、Test Send、Delivery Verification、idempotency、migration、privacy 与 public security 全部通过。

## 19. 冻结技术结论与待验证事实

没有阻塞 V4-1 的开放技术问题。以下是后续 Milestone 必须通过 fixture/controlled real Gate 验证的技术事实，不授权 Agent 改架构：

1. 正常 `/chat` 页面实际可观察的 PERSON/GROUP stable identity 字段与 selector/response shape；
2. Group conversationId 在 list、open、header 三阶段是否都可验证；
3. outgoing bubble 是否提供 stable message ID/timestamp/sequence；若没有，严格 verifier 将更多结果判为 DELIVERY_UNKNOWN；
4. Account profile extraction 可可靠获得 secUid 或 uniqueId；无法获得时 onboarding 必须失败安全；
5. ephemeral login console 的 loopback process packaging 与 resource limits；安全合同（不暴露 6080/password）不可改变。

这些事实只允许在对应 Gate 的明确授权范围内验证；不得在普通开发/CI 中访问真实 Douyin。

## 20. Public security baseline references

密码存储、Session 与 CSRF 参数以 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) 为下限；公网证书自动签发、续期与 HTTP→HTTPS 行为采用 [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https) 的官方合同。实现时若上游安全下限提高，允许只向更强参数调整，不得无 Spec 变更向下削弱。
