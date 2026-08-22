# SparkKeeper

SparkKeeper 是一套面向固定 Linux 服务器的自托管抖音火花维护自动化服务。项目将通过持久化浏览器环境保存用户本人有权控制的账号会话，并逐步提供任务执行、结果验证、失败恢复和可视化管理能力。

## 核心目标

- 在固定服务器环境中长期保存登录会话。
- 仅对明确配置的少量联系人执行任务。
- 对发送结果进行验证，避免把输入动作误判为成功。
- 通过幂等、有限重试和可观测性支持长期稳定运行。
- 保持单机、自托管、最小基础设施的技术路线。

## 当前开发阶段

Project Foundation 和 **MVP Task M1：Persistent Browser Session** 已完成。当前进入 **MVP Task M2：Authentication Detection**。

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

M2 只负责检测，不会自动登录、读取联系人或操作聊天消息。

## 技术栈

- Node.js
- TypeScript（strict mode）
- pnpm workspace
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
│   ├── database/        # 后续数据访问能力
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

`pnpm test` 会运行 Browser Session 配置/生命周期测试，以及使用受控页面的 AuthDetector 三态测试。

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

## Roadmap

- **Phase 0 — Project Foundation（已完成）**：建立 Monorepo、应用与 packages 骨架及统一工程命令。
- **MVP（M1 已完成，当前处于 M2）**：逐步验证持久化浏览器会话、登录状态、单联系人定位、单条消息发送与结果验证链路。
- **V1**：增加本地数据持久化、多联系人、每日调度、幂等、重试和可观测性。
- **V2**：增加正式 API、管理后台、实时状态、失败通知和完整自托管部署体验。

各阶段必须通过验收后再进入下一阶段，避免提前引入尚未被真实需求验证的复杂度。
