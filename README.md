# SparkKeeper

SparkKeeper 是一套面向固定 Linux 服务器的自托管抖音火花维护自动化服务。项目将通过持久化浏览器环境保存用户本人有权控制的账号会话，并逐步提供任务执行、结果验证、失败恢复和可视化管理能力。

## 核心目标

- 在固定服务器环境中长期保存登录会话。
- 仅对明确配置的少量联系人执行任务。
- 对发送结果进行验证，避免把输入动作误判为成功。
- 通过幂等、有限重试和可观测性支持长期稳定运行。
- 保持单机、自托管、最小基础设施的技术路线。

## 当前开发阶段

Project Foundation 以及 **MVP Task M1–M5** 均已完成，当前状态为 **MVP Core Flow Complete**。V1 的 **V1-1 Database Foundation**、**V1-2 Friend Identity**、**V1-3 Message Engine**、**V1-4 Daily Run & Idempotency**、**V1-5 Scheduler**、**V1-6 Retry & Failure State**、**V1-7 Observability** 和正式 Release Gate 均已完成；当前稳定版本为 **SparkKeeper v1.0.0**。

`packages/automation` 现在提供基于 Playwright Chromium 的持久化浏览器会话基础：

- 使用固定 `userDataDir` 调用 `chromium.launchPersistentContext()`；
- 支持 headed/headless、时区、`zh-CN` locale 和 `1440x900` viewport；
- 提供 `BrowserSession.start()`、`close()`、`isRunning()` 以及 Context/Page 访问；
- 正常关闭或浏览器意外关闭后会清理内部运行状态；
- 默认 Profile 路径为 `<DATA_DIR>/browser-profile`，也可由 `BROWSER_PROFILE_DIR` 显式覆盖。

`packages/automation` 现在还提供 Douyin Chat 认证状态检测：

- `READY`：存在明确、相互支持的登录后聊天页面证据；
- `AUTH_EXPIRED`：存在明确的登录、扫码或重新认证证据；
- `UNKNOWN`：证据不足、冲突、页面异常或超时，按安全失败处理。

M2 只负责检测，不会自动登录或操作聊天消息。

M3 在认证结果为 `READY` 后提供隔离的 Douyin Chat 页面适配能力：

- 打开 `https://www.douyin.com/chat` 并执行认证门禁；
- 通过 Chat shell、会话列表区域和消息区域的正向证据判断页面 ready；
- 解析当前已经加载的会话候选，仅返回页面能够可靠提供的基础字段；
- 明确区分认证不可用、Chat 未 ready、列表缺失、页面关闭和浏览器异常。

M3 不选择或点击目标联系人，不读取聊天正文，也不输入或发送消息。

M4 在 Chat Adapter 之上提供单目标联系人解析：

- 仅对运行时配置的 `displayName` 做 `trim()` 后的精确匹配，不做包含、模糊或猜测匹配；
- 明确区分唯一找到、未找到和同名歧义，只有唯一找到才允许打开会话；
- 对虚拟会话列表执行有最大次数、总时长和无进展终止条件的有限滚动；
- 打开后通过当前会话 Header 再次精确验证内存中的目标身份。

M4 不读取聊天正文，不定位消息输入区，也不输入或发送任何消息。

M5 在已验证的单联系人会话中提供一次性 Send and Verify：

- 真正输入前再次精确验证当前会话 Header；
- 定位可见、可编辑的 Composer，并验证其可观察纯文本与运行时消息完全一致；
- 发送前记录 outbound Bubble 总数、同文本数量和仅存在于当前 DOM 的 baseline；
- 通过显式 Send 控件触发至多一次发送动作，不使用自动 Retry；
- 只有 baseline 后新增的同文本 outbound Bubble 才能判定成功；
- 发送后的页面关闭、结构丢失或验证超时均安全返回 `DELIVERY_UNKNOWN`，绝不自动重发。

M5 不读取或记录历史聊天正文；历史 Bubble 只在页面内进行结构计数和等值判断。

## 技术栈

- Node.js
- TypeScript（strict mode）
- pnpm workspace
- SQLite（WAL）
- Drizzle ORM + versioned migrations
- Pino structured logging
- Vue 3
- Vite
- ESLint
- Prettier
- Docker Compose（当前仅保留基础骨架）

## 项目结构

```text
sparkkeeper/
├── apps/
│   ├── server/          # Node.js 服务启动骨架
│   └── admin-web/       # Vue 3 管理端基础应用
├── packages/
│   ├── automation/      # Persistent Browser Session
│   ├── database/        # SQLite、Drizzle migration 与具体 Repository
│   ├── message-engine/  # 纯 TypeScript 消息模板校验与 Provider
│   ├── shared/          # 跨应用共享类型与定义
│   └── notifier/        # 后续通知抽象
├── docs/                # 产品、技术与架构设计文档
├── docker-compose.yml   # 容器编排基础骨架
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 开发方式

环境要求：

- Node.js 22 或更高版本
- pnpm 10 或更高版本

安装依赖：

```bash
pnpm install
```

同时启动服务端 API/Scheduler composition root 和管理端开发服务器：

```bash
pnpm dev
```

管理端默认地址为 `http://localhost:5173`。服务端可单独运行：

```bash
pnpm --filter @sparkkeeper/server dev
```

构建后也可通过 `pnpm --filter @sparkkeeper/server start` 启动。V2 API foundation 默认绑定 `127.0.0.1:8080`，仅供本机访问；只有显式配置 `HOST` 才会改变绑定地址。后续远程访问必须先采用明确的 authentication、reverse proxy 或 trusted network 方案，不能把当前未认证 API 直接暴露到公网。

### V2 Read-only API Foundation

当前 HTTP API 仅提供以下只读端点，供未来 Vue 3 管理端消费：

- `GET /api/health`
- `GET /api/runtime/status`
- `GET /api/accounts`
- `GET /api/accounts/:accountId`
- `GET /api/accounts/:accountId/friends`
- `GET /api/friends/:friendId`
- `GET /api/accounts/:accountId/schedules`
- `GET /api/schedules/:scheduleId`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/send-records`
- `GET /api/runs/:runId/events`

API 与 Scheduler 使用独立的安全控制。启动 HTTP 服务不会授权真实发送；Scheduler 仍由 `SCHEDULER_ENABLED` 和 `SCHEDULER_ALLOW_REAL_SEND` 等原有开关控制，默认保持关闭。本阶段没有任何 Web real-send endpoint、文件下载 endpoint、CORS 通配配置或真实平台访问逻辑。

工程检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` 会运行 Browser Session 配置/生命周期测试、使用受控页面的 AuthDetector、Chat Adapter、Contact Resolver 和 MessageSender 契约测试、纯离线 Message Engine 测试，以及全部基于临时 SQLite 文件的 Database migration/Repository 测试。

如需创建本地配置：

```bash
cp .env.example .env
```

### Persistent Profile Smoke Test

首次运行前安装 Playwright Chromium：

```bash
pnpm --filter @sparkkeeper/automation exec playwright install chromium
```

执行 Smoke Test：

```bash
pnpm --filter @sparkkeeper/automation browser:smoke
```

该命令只访问进程内启动的本机测试页面。它会使用同一个 Profile 连续启动两次 Chromium：第一次写入非敏感的 `localStorage` 测试状态并正常关闭，第二次读取该状态；成功时输出 `Persistent profile verified`。

默认使用 headless 模式。需要显示浏览器窗口时：

```bash
BROWSER_HEADLESS=false pnpm --filter @sparkkeeper/automation browser:smoke
```

可通过 `DATA_DIR`、`BROWSER_PROFILE_DIR` 和 `APP_TIMEZONE` 调整 Profile 根目录、Profile 目录和浏览器时区。Browser Profile 属于本地运行时数据，不应提交或复制进镜像。

### Authentication Detection Smoke Test

使用 M1 的固定 Profile 打开 Douyin Chat 并检测当前认证状态：

```bash
pnpm --filter @sparkkeeper/automation auth:smoke
```

命令会输出 `Auth status` 和简洁原因。结果为 `AUTH_EXPIRED` 或 `UNKNOWN` 时，会在 `<DATA_DIR>/screenshots/` 保存本地诊断截图；该目录不会进入 Git。

如需人工登录并验证真实 `READY`，使用 headed 模式运行同一命令：

```bash
BROWSER_HEADLESS=false pnpm --filter @sparkkeeper/automation auth:smoke
```

在浏览器中由用户本人完成登录后，再次运行 Auth Smoke。SparkKeeper 不会自动填写凭据、处理验证码或绕过平台验证。

### Douyin Chat Adapter Smoke Test

使用已经登录的固定 Profile 打开 Douyin Chat，完成认证、页面 readiness、会话列表检测和当前已加载候选解析：

```bash
pnpm --filter @sparkkeeper/automation chat:smoke
```

成功时只输出认证/Chat 状态、列表检测结果和候选数量，不输出联系人名称、标识或聊天内容。需要观察浏览器窗口时可使用：

```bash
BROWSER_HEADLESS=false pnpm --filter @sparkkeeper/automation chat:smoke
```

`AUTH_EXPIRED` 或 `UNKNOWN` 会阻止列表解析，必须先由用户本人在 headed 模式恢复登录。

### Single Contact Resolver Smoke Test

使用运行时环境变量提供单个目标，再执行联系人定位、打开和 Header 验证：

```bash
MVP_TARGET_DISPLAY_NAME="Test User" pnpm --filter @sparkkeeper/automation contact:smoke
```

目标只在当前进程内使用。成功输出仅包含认证、Chat、解析、验证状态及滚动次数，不输出联系人名称、标识或聊天正文。需要观察浏览器窗口时：

```bash
MVP_TARGET_DISPLAY_NAME="Test User" BROWSER_HEADLESS=false pnpm --filter @sparkkeeper/automation contact:smoke
```

目标为空、未找到或存在多个精确同名候选时，Smoke 会安全停止，不会默认选择任何会话。

### Send and Verify Smoke Test

`send:smoke` 会产生一次真实消息发送动作，因此目标、消息和授权必须全部通过当前进程环境显式提供。以下安全示例保留关闭授权，不会发送：

```bash
MVP_TARGET_DISPLAY_NAME="Test User" \
MVP_TEST_MESSAGE="Hello from SparkKeeper" \
MVP_ALLOW_REAL_SEND=false \
pnpm --filter @sparkkeeper/automation send:smoke
```

只有在调用者明确将运行时发送授权开启后，命令才会执行 Composer 输入、单次 Send UI 动作和新增 outbound Bubble 验证。成功输出只包含认证、Chat、联系人、输入、发送动作和交付验证状态，不输出联系人或消息内容。

发送动作一旦尝试，后续只观察验证结果；`VERIFY_FAILED` 或 `DELIVERY_UNKNOWN` 都不会触发第二次发送。V1-4 已建立 DailyRun/SendRecord 幂等基础，V1-6 只会自动重试能够确认外部发送未发生的失败，绝不会把发送结果不确定的记录当作可重试项。

### Database Foundation

`packages/database` 统一管理 SQLite driver、Drizzle、PRAGMA、migration 和 Account 查询，调用层无需直接创建 SQLite 连接或散落 SQL。

默认数据库路径为：

```text
<DATA_DIR>/sparkkeeper.db
```

未设置 `DATA_DIR` 时使用项目当前工作目录下的 `data/sparkkeeper.db`。数据库包会自动创建父目录；`data/`、`*.db`、`*.db-wal` 和 `*.db-shm` 均不会进入 Git 或 Docker build context。该路径可直接映射到未来的 Docker Volume。

连接打开后会验证以下设置：

- `journal_mode = WAL`；
- `foreign_keys = ON`；
- `busy_timeout = 5000`；
- `synchronous = FULL`，适合当前低写入量并保留更强的掉电耐久性。

首个 migration 只创建最小 `accounts` 表。V1-2 至 V1-7 分别通过更高版本 migration 增加 Account 1:N `friends`、`message_templates`、`daily_runs`/`send_records`、每个 Account 唯一的 `schedules`、持久化 retry/failure state 和 `system_events`；这些变化都不会回改已经执行的 migration。Account 保存内部 UUID、显示名称、启用状态、登录状态元数据和 UTC 毫秒时间戳；Friend 保存联系人身份元数据和当前精确绑定键。它们都不保存 Cookie、Token、密码、二维码、Browser Profile 或其他登录凭据。

在默认路径或指定的 `DATA_DIR` 上执行 migration：

```bash
pnpm --filter @sparkkeeper/database db:migrate
```

检查当前数据库的 PRAGMA、migration 数量以及 accounts/friends/message_templates/daily_runs/send_records/schedules/system_events schema：

```bash
pnpm --filter @sparkkeeper/database db:check
```

使用自动清理的临时目录执行无网络、纯虚构数据的持久化 Smoke：

```bash
pnpm --filter @sparkkeeper/database db:smoke
```

正式数据库升级只使用已提交的 versioned migration；已执行的 migration 视为 immutable，后续结构变化必须新增 migration，不使用 destructive reset 或 `db push` 替代升级历史。

### Friend Identity

`FriendRepository` 提供 `create`、`findById`、`listByAccountId`、`listEnabledByAccountId` 和 `update`，支持一个 Account 持久化多个 Friend，并通过外键保持账号隔离和数据完整性。

Friend 身份包含必需的 `displayName`，以及可选的 `remarkName`、`shortId`、`uniqueId` 和 `secUid`。当前真实页面能够可靠获得的字段仍然只有 `displayName`；其余字段只有未来页面能够可靠提供时才会填充，不会推断或伪造。

身份值只做保守的 `trim()`；空白可选字段保存为 `null`。绑定使用一个受控 `matchField` 和从对应身份字段派生的精确 `matchKey`，默认优先级为 `secUid → uniqueId → shortId → remarkName → displayName`。昵称不具备唯一约束，多个同名 Friend 可以安全持久化；歧义处理仍属于后续 ContactResolver/application 编排。

`enabled` 只提供数据库级启停和查询能力。V1-2 尚未把 FriendRepository 接入自动化，不会自动遍历或向多个联系人发送消息。

V1-2 尚未把 FriendRepository 接入自动化运行链路。

### Message Engine

`packages/message-engine` 是不依赖 Playwright、SQLite driver、网络或 Browser Profile 的纯 TypeScript 包。它接受持久化模板对应的领域对象，通过 `MessageEngine` 分派给 `StaticProvider` 或 `RandomProvider`，并返回最终纯文本消息。

所有模板统一使用 `messages: string[]`：`STATIC` 必须恰好包含一条非空白消息，`RANDOM` 必须包含至少一条非空白消息。校验只使用 `trim()` 判断空白，不修改最终消息内容，也不猜测平台最大消息长度。`RandomProvider` 默认使用 `Math.random`，测试或调用方可以注入最小 `RandomSource` 以获得确定性行为。

`message_templates.content` 将消息数组保存为 JSON 字符串。`MessageTemplateRepository` 提供 `create`、`findById`、`list`、`listEnabled` 和 `update`；每次写入及读取都会执行 runtime validation，损坏 JSON、未知 Provider、禁用模板和非法消息均会明确失败。模板名称不是唯一键，内部身份使用 UUID。

执行完全离线、只含虚构消息的 Message Engine Smoke：

```bash
pnpm --filter @sparkkeeper/message-engine engine:smoke
```

V1-5 的 DailyTaskRunner 已将 MessageEngine 与现有 MessageSender 通过显式授权的生产适配器编排；安全默认仍为关闭，V1-4 的 DailyRun/SendRecord 负责消息快照和执行幂等。V1-6 重试始终复用首次持久化的消息快照，不会重新调用 RandomProvider 生成另一条消息。

### Daily Run & Idempotency

V1-4 使用 `BusinessDate` 表示由显式时刻和 `APP_TIMEZONE`（默认 `Asia/Shanghai`）解析出的 `YYYY-MM-DD` 业务日期。解析逻辑是纯 TypeScript，拒绝非法时区、非法时刻和不存在的公历日期；数据库保存规范化日期字符串，时间字段继续使用 UTC Unix epoch milliseconds。

`DailyRunRepository` 以 `(account_id, business_date)` 唯一约束保证同一 Account 每个业务日只有一个 Run，并提供 `createOrGet`、查询和显式状态转换。`SendRecordRepository` 在准备阶段保存不可变的纯文本消息快照，以 `(friend_id, business_date)` 作为核心每日幂等键，并额外约束 `(daily_run_id, friend_id)`。重复准备返回既有记录，不覆盖首次快照；执行资格通过单条条件 `UPDATE ... WHERE status = 'READY'` 原子 claim，`SUCCESS` 记录不能再次取得执行资格。

状态更新要求调用方显式传入时间，方便确定性测试。`send_records.friend_id` 使用 `NO ACTION` 保留历史身份引用，删除 DailyRun 会级联删除其 SendRecord，删除模板则将可选模板外键置空而保留已生成的消息快照。V1-4 的持久化层本身没有网络依赖；V1-5 通过独立 Scheduler 编排这些能力。

`db:smoke` 会在临时 SQLite 中离线验证 migrate、同日重复 Run/SendRecord、消息快照、原子 claim、SUCCESS 终态、重开/重复 migrate，以及下一业务日可创建新记录；仅使用虚构数据并自动清理。

### Task Scheduler

V1-5 增加每个 Account 一条的 Schedule（严格 `HH:mm`、显式 IANA timezone、`[start,end)` 同日窗口）和进程内 `TaskScheduler`。Scheduler 使用 60 秒有界轮询、注入式 clock/timer、进程内防重入，并由数据库 DailyRun/SendRecord 负责重启后的幂等恢复。执行只遍历启用的 Friend，顺序执行且每个 tick 最多启动/关闭一次 Browser Session。

安全默认值为 `SCHEDULER_ENABLED=false` 和 `SCHEDULER_ALLOW_REAL_SEND=false`。启用时必须显式给出 `SCHEDULER_ACCOUNT_ID`；真实发送还必须同时显式给出 `SCHEDULER_MESSAGE_TEMPLATE_ID` 和发送授权。系统不会自动选择第一条 Account、Template 或 Friend。`DELIVERY_UNKNOWN`、终态 `FAILED` 和 `SUCCESS` 都不能重新 claim 或自动重发。

为明确的 Account 创建或更新 Schedule：

```bash
pnpm --filter @sparkkeeper/database schedule:configure -- <account-id> 09:00 10:00 Asia/Shanghai true 3 60
```

执行完全离线、临时 SQLite 和 fake runner 的 Scheduler Smoke：

```bash
pnpm --filter @sparkkeeper/server scheduler:smoke
```

该 Smoke 不启动 Playwright、不访问 Douyin、不读取 Browser Profile，也不发送消息。

### Retry & Failure State

V1-6 为 Schedule 增加有界的 `maxAttempts`（默认 3，范围 1–5，包含初始 Attempt）和固定 `retryIntervalSeconds`（默认 60，范围 1–86400）。系统不实现指数退避或 jitter；重试只能安排在原 BusinessDate 的 `[start,end)` 执行窗口内，超出窗口会终结为 `FAILED`。

每次成功原子 claim 才会增加 `send_records.attempt_count`。确定外部发送尚未发生的 transient failure 可以进入 `RETRY_WAIT`，并持久化 `next_retry_at` 和受控的 `last_error_code`；Scheduler 后续 tick 只在到期时 claim。存在 `RETRY_WAIT` 时 DailyRun 保持 `RUNNING`，全部记录成功后才成为 `SUCCESS`，任一终态失败或 `DELIVERY_UNKNOWN` 会使 Run 终结失败。

`send_action_started_at` 是外部发送不确定性边界，必须在调用 MessageSender 之前持久化。重启遇到 marker 为空的 stale `RUNNING` 可以安全进入有界重试；marker 已存在则保守转为 `DELIVERY_UNKNOWN`，永不自动重试。Retry 不等于盲目 resend：`SUCCESS`、终态 `FAILED`、认证/身份/配置等确定性失败和任何发送后验证不确定性均不会自动重试。

执行完全离线、临时 SQLite、fake clock/automation 和虚构数据的 Retry Smoke：

```bash
pnpm --filter @sparkkeeper/server retry:smoke
```

该 Smoke 验证固定间隔、到期 claim、最大三次 Attempt、交付不确定性保护、数据库重开和两种 crash recovery；不启动 Browser、不访问网络，也不输出消息正文。

### Runtime Observability

V1-7 在 `apps/server/src/observability` 建立本地运行证据链：Pino 同时输出 JSON 到 stdout 和按 UTC 日期切分的 `<LOG_DIR>/sparkkeeper-YYYY-MM-DD.log`；默认 `LOG_LEVEL=info`、日志保留 14 天。Runtime logging API 只接受受控 eventType、内部 account/run/friend ID、Attempt、BusinessDate、errorCode 和计数摘要，并由 Pino redact 提供第二层保护。日志不会输出 Friend displayName、matchKey、消息正文、Cookie、Token、Authorization、Browser Profile 内容或默认原始 Error stack。

重要诊断事实由 concrete `SystemEventRepository` 写入 `system_events`，普通过程日志不会复制进数据库。SystemEvent 只保存安全固定摘要和本地相对证据路径；Account、DailyRun、Friend 外键删除时使用 `SET NULL` 保留历史事件。`listRecent` 默认 100 条、最大 500 条，避免无界读取。

失败截图保存在 `<DATA_DIR>/screenshots/<businessDate>/<runId>/`，可选 Trace 保存在 `<DATA_DIR>/traces/<businessDate>/<runId>/`。文件名只包含受控事件类型和内部 ID，不包含昵称或消息；路径组件和最终 root boundary 都经过校验。`TRACE_MODE` 支持 `off`、`on-failure`、`always`，生产默认 `off`。截图默认保留 14 天，Trace 默认保留 7 天；RetentionManager 只清理这两个明确 evidence root，不触碰 Browser Profile 或 SQLite。

执行完全离线的 Observability Smoke：

```bash
pnpm --filter @sparkkeeper/server observability:smoke
```

该 Smoke 使用临时 SQLite、虚构 Account/Friend、临时日志目录和受控本地 Playwright 页面，真实生成 Screenshot 与 Trace，并验证 structured logging、敏感值 0 命中、SystemEvent、相对路径、重开/重复 migration 和 retention。它不访问 Douyin、不读取真实 Browser Profile，也不发送消息。

Logger、SystemEvent、Screenshot、Trace 或 Retention 失败均为观察失败：不会增加 Send Attempt，不会改变 SUCCESS，不会把 DELIVERY_UNKNOWN 变为可重试状态。V1 功能开发与正式 Release Gate 均已完成，`v1.0.0` 是首个长期自用稳定版本。

### V1 Release Gate（PASSED）

V1-1 至 V1-7 的功能实现与正式 Release Gate 均已完成。SparkKeeper V1 采用以下正式验收流程：

1. Phase A 工程与配置 preflight；
2. 在本地 SQLite 中显式维护 Account、至少 2 个 enabled Friends、MessageTemplate 和 Schedule；
3. Phase B 在受控环境中由 Scheduler 完成至少 2 个连续 BusinessDate 的真实运行，并完成同日重启幂等、`AUTH_EXPIRED` 安全停止和失败证据链验证；
4. 每个 BusinessDate 执行只读 Audit 并保存验收结论；
5. 最终 Release Audit；
6. 只有全部证据通过后才允许合并到 `main` 并创建 `v1.0.0`。

上述“两日受控运行 + 同日重启幂等 + `AUTH_EXPIRED` 安全停止 + 失败证据链”是当前 V1 的正式验收标准，不是临时豁免。

V1 无需 Web UI 即可通过脚本化 CLI 完成最小维护。以下示例只使用虚构名称和占位 ID：

```bash
# Account：create / list / set-enabled
pnpm --filter @sparkkeeper/database maintenance -- account create --name "Test Account"
pnpm --filter @sparkkeeper/database maintenance -- account list
pnpm --filter @sparkkeeper/database maintenance -- account set-enabled --id <account-id> --enabled false

# Friend：显式 Account、list、identity update、enable/disable
pnpm --filter @sparkkeeper/database maintenance -- friend create --account-id <account-id> --display-name "Test User"
pnpm --filter @sparkkeeper/database maintenance -- friend list --account-id <account-id>
pnpm --filter @sparkkeeper/database maintenance -- friend update --id <friend-id> --unique-id <known-unique-id>
pnpm --filter @sparkkeeper/database maintenance -- friend set-enabled --id <friend-id> --enabled false

# MessageTemplate：STATIC / RANDOM、safe list、update、enable/disable
pnpm --filter @sparkkeeper/database maintenance -- template create --name "Test Template" --provider STATIC --message "Hello"
pnpm --filter @sparkkeeper/database maintenance -- template create --name "Test Random Template" --provider RANDOM --message "Message A" --message "Message B"
pnpm --filter @sparkkeeper/database maintenance -- template list
pnpm --filter @sparkkeeper/database maintenance -- template update --id <template-id> --provider RANDOM --message "Message A" --message "Message B"
pnpm --filter @sparkkeeper/database maintenance -- template set-enabled --id <template-id> --enabled false

# Schedule：必须显式 Account；不会自动选择第一条 Account
pnpm --filter @sparkkeeper/database maintenance -- schedule configure --account-id <account-id> --start-time 09:00 --end-time 10:00 --timezone Asia/Shanghai --enabled true --max-attempts 3 --retry-interval-seconds 60
```

普通 Template list 只输出 `id`、`name`、`providerType`、`enabled` 和 `messageCount`，不输出消息内容。Friend list 只输出本地运维所需的 internal ID、displayName、matchField 和 enabled，不 dump raw entity、matchKey 或可选稳定标识。所有命令都不会显示 Cookie、Token、Browser Profile 或认证材料。

在正式本地环境配置 `DATA_DIR`、`BROWSER_PROFILE_DIR`、显式 Account/Template ID，并保持两个发送安全开关关闭后，执行只读 Phase A preflight：

```bash
SCHEDULER_ENABLED=false \
SCHEDULER_ALLOW_REAL_SEND=false \
SCHEDULER_ACCOUNT_ID=<account-id> \
SCHEDULER_MESSAGE_TEMPLATE_ID=<template-id> \
pnpm --filter @sparkkeeper/server v1:preflight
```

Preflight 只检查数据库/七段 migration/PRAGMA、配置、Account、Schedule、Template、enabled Friend 数量、Profile 目录存在性、安全开关和 observability 配置。它不执行 migration、不修改业务状态、不打开 Browser、不读取 Profile 内容，也不输出 Friend 列表或模板内容；任何前置条件不满足都会返回非零退出码。

Phase B 每个 BusinessDate 结束后执行只读 Audit：

```bash
pnpm --filter @sparkkeeper/server v1:audit -- --date 2026-08-23
pnpm --filter @sparkkeeper/server v1:audit -- --from 2026-08-21 --to 2026-08-23
```

Audit 只输出 DailyRun 状态、enabled Friend 数量、各 SendRecord 状态计数、duplicate SendRecord/SUCCESS 违规数、SystemEvent/关键事件/evidence 数量，以及结构化日志是否存在、条目数和 JSONL 解析错误数。它不输出 Friend 身份、messageText、模板内容或内部实体 dump，也不创建 DailyRun、claim SendRecord、安排 Retry、启动 Browser 或调用 MessageSender。

Phase B 每日验收要求：Scheduler 在窗口内自动触发、Auth 为 READY、至少 2 个 enabled Friends、每个 Friend 使用明确 Template、全部 SendRecord 最终可解释、duplicate SendRecord/SUCCESS 均为 0、`DELIVERY_UNKNOWN=0`、日终无 `RUNNING`/`RETRY_WAIT`、日志存在且可解析、关键 SystemEvent 可定位，触发证据时相对路径实际存在。Retry 只能发生在确定未执行外部发送的 pre-send failure。

若出现代码/幂等缺陷、重复发送、不可解释 `DELIVERY_UNKNOWN` 或状态损坏，Gate 立即失败，修复后重新开始 2 个连续 BusinessDate。用户主动停服或明确取消的日期不计入 streak。真实 `AUTH_EXPIRED` 若能安全停止、正确记录 Run/SystemEvent/evidence 且无重复发送，证明保护行为有效，但该日不计作正常连续成功日；人工恢复登录后按 Gate B 记录重新计算连续期，SparkKeeper 不会自动登录或绕过平台验证。

执行完全离线、自动清理且仅含虚构数据的 Phase A 验收 Smoke：

```bash
pnpm --filter @sparkkeeper/server v1:gate:smoke
```

该 Smoke 不启动 Scheduler、Playwright 或真实发送，不访问 Douyin，也不读取任何真实 Browser Profile。

### SparkKeeper v1.0.0

SparkKeeper v1.0.0 是一套 self-hosted Douyin automation，不依赖或暗示官方 Douyin API / 官方集成。本版本包括：

- Playwright Persistent Browser Profile、认证检测、Douyin Chat adapter、安全联系人解析和发出消息 Bubble 验证；
- SQLite + Drizzle 持久化、versioned migrations，以及 Account、Friend、MessageTemplate 和 Schedule 的 CLI 维护；
- DailyRun / SendRecord 幂等、Scheduler、服务重启恢复、有界重试和保守的 `DELIVERY_UNKNOWN` 处理；
- `AUTH_EXPIRED` 在消息动作前安全停止；
- 结构化日志、SystemEvent、失败 Screenshot、Trace policy、日志/证据 retention；
- V1 Preflight、只读 Audit、离线 Gate smoke，以及至少 2 个连续 BusinessDate、同日重启幂等和失败证据链的受控验证。

V1 Release 任务本身不访问真实平台，也不执行任何真实消息发送。

## Roadmap

- **Phase 0 — Project Foundation（已完成）**：建立 Monorepo、应用与 packages 骨架及统一工程命令。
- **MVP Core Flow Complete（M1–M5 已完成）**：已验证持久浏览器、认证、Chat 适配、单联系人定位、一次发送及新增 outbound Bubble 验证链路。
- **V1-1 Database Foundation（已完成）**：SQLite + Drizzle、versioned migration、WAL、最小 accounts schema、AccountRepository 和临时数据库测试基础。
- **V1-2 Friend Identity（已完成）**：Account 1:N Friend、可演进身份字段、精确 match field/key、FriendRepository 和 migration upgrade 测试。
- **V1-3 Message Engine（已完成）**：持久化消息模板、StaticProvider、RandomProvider、统一 runtime validation 与纯离线生成能力。
- **V1-4 Daily Run & Idempotency（已完成）**：BusinessDate、DailyRun/SendRecord、数据库唯一约束、消息快照、原子 claim 与离线持久化验证。
- **V1-5 Scheduler（已完成）**：Schedule 持久化、同日时区窗口、进程内轮询、防重入、DailyTaskRunner 恢复边界与离线验证。
- **V1-6 Retry & Failure State（已完成）**：有界固定间隔重试、持久化 Attempt/等待状态、原子到期 claim、执行窗口约束和外部发送不确定性保护。
- **V1-7 Observability（已完成）**：Pino 结构化日志、隐私 allowlist/redaction、SystemEvent、失败截图、可选 Trace、日志轮转和 evidence retention。
- **V1 Release Gate Phase A（已完成）**：工程 preflight、CLI maintenance、只读 Audit 和离线 Gate smoke 已建立并通过。
- **V1 Release Gate Phase B（已完成）**：至少 2 个连续 BusinessDate 的受控 Scheduler 验证，以及同日重启幂等、`AUTH_EXPIRED` 安全停止和失败证据链验证均已通过。
- **SparkKeeper v1.0.0（已发布）**：V1 长期自用稳定版本。
- **V2**：增加正式 API、管理后台、实时状态、失败通知和完整自托管部署体验。

各阶段必须通过验收后再进入下一阶段，避免提前引入尚未被真实需求验证的复杂度。
