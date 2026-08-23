# SparkKeeper

SparkKeeper 是一套面向固定 Linux 服务器的自托管抖音火花维护自动化服务。项目将通过持久化浏览器环境保存用户本人有权控制的账号会话，并逐步提供任务执行、结果验证、失败恢复和可视化管理能力。

## 核心目标

- 在固定服务器环境中长期保存登录会话。
- 仅对明确配置的少量联系人执行任务。
- 对发送结果进行验证，避免把输入动作误判为成功。
- 通过幂等、有限重试和可观测性支持长期稳定运行。
- 保持单机、自托管、最小基础设施的技术路线。

## 当前开发阶段

Project Foundation 以及 **MVP Task M1–M5** 均已完成，当前状态为 **MVP Core Flow Complete**。V1 已完成 **V1-1 Database Foundation**、**V1-2 Friend Identity**、**V1-3 Message Engine**、**V1-4 Daily Run & Idempotency**、**V1-5 Scheduler** 和 **V1-6 Retry & Failure State**；V1-7 Observability 尚未开始。

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

同时启动服务端基础进程和管理端开发服务器：

```bash
pnpm dev
```

管理端默认地址为 `http://localhost:5173`。当前服务端只输出启动状态，不监听业务端口。

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

首个 migration 只创建最小 `accounts` 表。V1-2 至 V1-6 分别通过更高版本 migration 增加 Account 1:N `friends`、`message_templates`、`daily_runs`/`send_records`、每个 Account 唯一的 `schedules`，以及持久化 retry/failure state；这些变化都不会回改已经执行的 migration。Account 保存内部 UUID、显示名称、启用状态、登录状态元数据和 UTC 毫秒时间戳；Friend 保存联系人身份元数据和当前精确绑定键。它们都不保存 Cookie、Token、密码、二维码、Browser Profile 或其他登录凭据。

在默认路径或指定的 `DATA_DIR` 上执行 migration：

```bash
pnpm --filter @sparkkeeper/database db:migrate
```

检查当前数据库的 PRAGMA、migration 数量以及 accounts/friends/message_templates/daily_runs/send_records/schedules schema：

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

## Roadmap

- **Phase 0 — Project Foundation（已完成）**：建立 Monorepo、应用与 packages 骨架及统一工程命令。
- **MVP Core Flow Complete（M1–M5 已完成）**：已验证持久浏览器、认证、Chat 适配、单联系人定位、一次发送及新增 outbound Bubble 验证链路。
- **V1-1 Database Foundation（已完成）**：SQLite + Drizzle、versioned migration、WAL、最小 accounts schema、AccountRepository 和临时数据库测试基础。
- **V1-2 Friend Identity（已完成）**：Account 1:N Friend、可演进身份字段、精确 match field/key、FriendRepository 和 migration upgrade 测试。
- **V1-3 Message Engine（已完成）**：持久化消息模板、StaticProvider、RandomProvider、统一 runtime validation 与纯离线生成能力。
- **V1-4 Daily Run & Idempotency（已完成）**：BusinessDate、DailyRun/SendRecord、数据库唯一约束、消息快照、原子 claim 与离线持久化验证。
- **V1-5 Scheduler（已完成）**：Schedule 持久化、同日时区窗口、进程内轮询、防重入、DailyTaskRunner 恢复边界与离线验证。
- **V1-6 Retry & Failure State（已完成）**：有界固定间隔重试、持久化 Attempt/等待状态、原子到期 claim、执行窗口约束和外部发送不确定性保护。
- **V1-7 Observability（尚未完成）**：后续增加受控日志、SystemEvent 与诊断生命周期。
- **V2**：增加正式 API、管理后台、实时状态、失败通知和完整自托管部署体验。

各阶段必须通过验收后再进入下一阶段，避免提前引入尚未被真实需求验证的复杂度。
