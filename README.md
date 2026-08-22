# SparkKeeper

SparkKeeper 是一套面向固定 Linux 服务器的自托管抖音火花维护自动化服务。项目将通过持久化浏览器环境保存用户本人有权控制的账号会话，并逐步提供任务执行、结果验证、失败恢复和可视化管理能力。

## 核心目标

- 在固定服务器环境中长期保存登录会话。
- 仅对明确配置的少量联系人执行任务。
- 对发送结果进行验证，避免把输入动作误判为成功。
- 通过幂等、有限重试和可观测性支持长期稳定运行。
- 保持单机、自托管、最小基础设施的技术路线。

## 当前开发阶段

当前处于 **Phase 0：Project Foundation**。

本阶段只提供可运行、可构建、可检查的 TypeScript Monorepo 工程骨架。浏览器自动化、数据库模型、调度、正式 API、后台业务页面和通知能力均尚未实现。

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
│   ├── automation/      # 后续浏览器自动化能力
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

当前尚无实际测试用例，`pnpm test` 会运行 Node.js 测试运行器并明确报告零测试状态。

如需创建本地配置：

```bash
cp .env.example .env
```

## Roadmap

- **Phase 0 — Project Foundation（当前）**：建立 Monorepo、应用与 packages 骨架及统一工程命令。
- **MVP**：验证持久化浏览器会话、登录状态、单联系人定位、单条消息发送与结果验证链路。
- **V1**：增加本地数据持久化、多联系人、每日调度、幂等、重试和可观测性。
- **V2**：增加正式 API、管理后台、实时状态、失败通知和完整自托管部署体验。

各阶段必须通过验收后再进入下一阶段，避免提前引入尚未被真实需求验证的复杂度。
