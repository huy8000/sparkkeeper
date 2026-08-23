# SparkKeeper

SparkKeeper 是一套面向固定 Linux 服务器的自托管抖音火花维护自动化服务。项目将通过持久化浏览器环境保存用户本人有权控制的账号会话，并逐步提供任务执行、结果验证、失败恢复和可视化管理能力。

## 核心目标

- 在固定服务器环境中长期保存登录会话。
- 仅对明确配置的少量联系人执行任务。
- 对发送结果进行验证，避免把输入动作误判为成功。
- 通过幂等、有限重试和可观测性支持长期稳定运行。
- 保持单机、自托管、最小基础设施的技术路线。

## 当前开发阶段

Project Foundation 以及 **MVP Task M1–M5** 均已完成，当前状态为 **MVP Core Flow Complete**。V1 已完成 **V1-1 Database Foundation**，V1-2 及后续任务尚未开始。

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
│   ├── database/        # SQLite、Drizzle migration 与 AccountRepository
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

`pnpm test` 会运行 Browser Session 配置/生命周期测试、使用受控页面的 AuthDetector、Chat Adapter、Contact Resolver 和 MessageSender 契约测试，以及全部基于临时 SQLite 文件的 Database migration/Repository 测试。

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

发送动作一旦尝试，后续只观察验证结果；`VERIFY_FAILED` 或 `DELIVERY_UNKNOWN` 都不会触发第二次发送。正式幂等、Retry 和 SendRecord 属于后续 V1。

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

首个 migration 只创建最小 `accounts` 表。它保存账号的内部 UUID、显示名称、启用状态、登录状态元数据和 UTC 毫秒时间戳，不保存 Cookie、Token、密码、二维码、Browser Profile 或其他登录凭据。

在默认路径或指定的 `DATA_DIR` 上执行 migration：

```bash
pnpm --filter @sparkkeeper/database db:migrate
```

检查当前数据库的 PRAGMA、migration 数量和 accounts schema：

```bash
pnpm --filter @sparkkeeper/database db:check
```

使用自动清理的临时目录执行无网络、纯虚构数据的持久化 Smoke：

```bash
pnpm --filter @sparkkeeper/database db:smoke
```

正式数据库升级只使用已提交的 versioned migration；已执行的 migration 视为 immutable，后续结构变化必须新增 migration，不使用 destructive reset 或 `db push` 替代升级历史。

V1-1 尚未实现 Friend persistence、MessageTemplate、DailyRun、SendRecord、Scheduler、Retry 或 Observability。

## Roadmap

- **Phase 0 — Project Foundation（已完成）**：建立 Monorepo、应用与 packages 骨架及统一工程命令。
- **MVP Core Flow Complete（M1–M5 已完成）**：已验证持久浏览器、认证、Chat 适配、单联系人定位、一次发送及新增 outbound Bubble 验证链路。
- **V1-1 Database Foundation（已完成）**：SQLite + Drizzle、versioned migration、WAL、最小 accounts schema、AccountRepository 和临时数据库测试基础。
- **V1-2+（尚未完成）**：后续增加 Friend Identity、消息引擎、DailyRun/SendRecord 幂等、Scheduler、Retry 和 Observability。
- **V2**：增加正式 API、管理后台、实时状态、失败通知和完整自托管部署体验。

各阶段必须通过验收后再进入下一阶段，避免提前引入尚未被真实需求验证的复杂度。
