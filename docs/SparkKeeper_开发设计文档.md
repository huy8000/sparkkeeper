# SparkKeeper 开发设计文档

> Self-hosted Douyin spark maintenance automation service  
> 服务器常驻型抖音火花自动维护系统

| 项目 | 内容 |
|---|---|
| 文档版本 | 2.0 |
| 产品路线 | MVP → V1 → V2 |
| 主语言 | TypeScript |
| 项目形态 | TypeScript Monorepo |
| 部署目标 | 固定 Linux 服务器 / Docker Compose |
| 核心页面 | `https://www.douyin.com/chat` |
| 编制日期 | 2026-08-23 |

---

## 目录

1. 文档说明
2. 项目定位
3. 产品版本路线
4. 设计原则
5. 技术选型
6. 总体架构
7. Monorepo 项目结构
8. 项目初始化基线
9. MVP 设计
10. V1 设计
11. V2 设计
12. 浏览器与登录态设计
13. Douyin 页面适配层
14. 联系人身份模型
15. 消息引擎
16. 调度、重试与幂等
17. 数据模型
18. 后端 API 设计
19. 管理后台设计
20. 实时状态与通知
21. 日志、截图与可观测性
22. 安全设计
23. Docker 与服务器部署
24. 配置管理
25. 测试策略
26. 开发任务拆解
27. Git 分支与交付规则
28. 总体验收标准
29. 风险与维护策略
30. 后续演进方向
31. 附录 A：环境变量示例
32. 附录 B：任务状态
33. 附录 C：Codex 开发约束

---

# 1. 文档说明

本文档是 SparkKeeper 的产品、技术、架构和开发基线，用于指导项目从零开始逐步完成：

```text
项目初始化
    ↓
MVP
    ↓
V1
    ↓
V2
```

其中：

- **项目初始化**只是工程基础，不属于产品版本。
- **MVP**负责验证核心浏览器自动化链路是否成立。
- **V1**负责把核心链路建设成可以长期无人值守运行的可靠服务。
- **V2**负责补齐 API、Web 管理后台、实时状态、通知和完整服务器部署体验。

后续 Issue、feature branch、Pull Request、Codex/AI 编程任务都应以本文档为基线。

如果真实页面、Playwright 行为或部署条件与本文档发生冲突，应先记录并确认技术事实，再更新文档和实现。不得为了完成任务而自行扩大产品范围或提前实现后续版本。

> **使用边界**
>
> SparkKeeper 仅面向用户本人有权控制的账号和明确配置的少量联系人。项目不设计绕过登录验证、验证码、设备验证、平台风控或其他访问限制的能力，也不提供陌生人群发、营销私信、刷量或批量账号运营能力。

---

# 2. 项目定位

SparkKeeper 不是一个“每天执行一次脚本”的临时任务，而是一套运行在固定服务器上的长期浏览器自动化服务。

它在服务器上维护一个持久化浏览器环境，通过固定 Browser Profile 保存登录会话，并由任务系统完成：

```text
保持登录
    ↓
到达执行窗口
    ↓
检查今日状态
    ↓
定位指定联系人
    ↓
生成消息
    ↓
发送消息
    ↓
验证消息确实出现在聊天区域
    ↓
记录结果
    ↓
失败时重试或通知
```

## 2.1 核心目标

| 目标 | 说明 |
|---|---|
| 固定运行环境 | 长期运行在固定 Linux 服务器 |
| 持久登录 | 使用 Playwright Persistent Context 保存 Browser Profile |
| 定时执行 | 在配置的每日时间窗口内完成任务 |
| 稳定联系人匹配 | 不仅依赖昵称，尽量使用稳定标识 |
| 发送结果验证 | 不以“按下 Enter”作为成功 |
| 幂等 | 同一联系人同一业务日期不能重复成功发送 |
| 失败恢复 | 网络、页面加载等可恢复错误允许有限重试 |
| 登录失效保护 | 登录失效后停止发送并进入人工恢复 |
| 可追踪 | 保存运行记录、错误、截图和事件 |
| 可管理 | V2 通过 Web UI 管理联系人、计划和历史记录 |

## 2.2 非目标

SparkKeeper 当前路线明确不做：

- 多租户 SaaS；
- 大规模账号矩阵；
- 陌生人批量私信；
- 营销群发；
- 自动扩展联系人；
- 绕过验证码、设备验证或其他平台限制；
- 逆向私有签名接口作为正式核心方案；
- 为“模拟真人”而设计的反检测机制；
- 一开始就引入分布式基础设施。

---

# 3. 产品版本路线

SparkKeeper 的产品开发严格分为三个阶段：

| 阶段 | 核心问题 | 产品状态 |
|---|---|---|
| **MVP** | 技术链路能否稳定成立？ | 可验证 |
| **V1** | 能否长期可靠、无人值守运行？ | 可长期自用 |
| **V2** | 能否形成完整、自托管、可视化管理的开源产品？ | 可正式发布 |

整体路线：

```text
工程初始化
│
├─ TypeScript Monorepo
├─ Lint / Typecheck / Test / Build
└─ 基础文档
      ↓
MVP
│
├─ Persistent Browser Profile
├─ 首次人工登录
├─ 登录状态检测
├─ 单账号
├─ 单联系人
├─ 单条消息发送
└─ 发送结果验证
      ↓
V1
│
├─ SQLite / Drizzle
├─ 多联系人
├─ Scheduler
├─ Daily Run
├─ 幂等
├─ 重试
├─ AUTH_EXPIRED
├─ Screenshot / Trace
└─ 结构化日志
      ↓
V2
│
├─ Fastify API
├─ Vue 3 Admin
├─ SSE
├─ 通知
├─ Docker Compose
├─ noVNC 登录维修
├─ 配置管理
├─ 运维文档
└─ 正式开源发布
```

## 3.1 阶段门禁原则

每一个阶段必须通过验收后才能进入下一阶段。

尤其是：

> **MVP 未证明 Persistent Profile、登录保持、联系人定位、消息发送和发送验证可行之前，不应投入大量时间开发数据库、调度、API 和管理后台。**

---

# 4. 设计原则

| 原则 | 说明 |
|---|---|
| 核心链路优先 | 优先证明浏览器自动化可行，再建设产品外围能力 |
| 固定环境优先 | 固定服务器、固定 Browser Profile、固定数据目录 |
| 可靠性优先 | 所有发送动作必须验证 |
| 幂等优先 | 重启、重试、手工触发不能导致重复发送 |
| 适配隔离 | Douyin DOM 与网络解析集中在 automation adapter |
| 最小基础设施 | 单机能解决的问题不引入分布式组件 |
| 可维修 | 登录失效、DOM 变化时能留下日志、截图和人工修复入口 |
| 类型安全 | TypeScript strict，跨包数据使用明确类型和 Schema |
| 可测试 | 核心状态机、重试、数据库、Selector Parser 可离线测试 |
| 渐进增强 | MVP、V1、V2 不越级实现 |
| 安全最小暴露 | Browser Profile、noVNC、Secret 不裸露公网 |
| 开源友好 | 文档、配置、部署和目录结构清晰，方便贡献者理解 |

---

# 5. 技术选型

明确做到 V2，因此主技术路线采用全栈 TypeScript。

| 领域 | 技术 | 使用阶段 | 说明 |
|---|---|---|---|
| 主语言 | TypeScript | 全阶段 | 前后端、Playwright 统一语言 |
| Runtime | Node.js LTS | 全阶段 | 服务端运行时 |
| 包管理 | pnpm | 全阶段 | Monorepo workspace |
| 浏览器自动化 | Playwright | MVP 起 | Persistent Context、Locator、Trace |
| Schema | Zod | V1 起 | 配置、API、DTO 校验 |
| 数据库 | SQLite + WAL | V1 起 | 单服务器低并发场景足够 |
| ORM | Drizzle ORM | V1 起 | 类型安全、迁移轻量 |
| Scheduler | 轻量进程内 Scheduler | V1 起 | 单机任务调度 |
| API | Fastify | V2 | REST API / SSE |
| 前端 | Vue 3 + TypeScript + Vite | V2 | 管理后台 |
| UI | Element Plus 或 Naive UI | V2 | 选择一个即可，不并存 |
| 实时通信 | SSE | V2 | 服务端单向推送任务状态 |
| 日志 | Pino | V1 起 | 结构化日志 |
| 部署 | Docker Compose | V2 | 自托管部署 |
| 图形环境 | Xvfb + noVNC | V2 | 首次登录与故障维修 |

## 5.1 当前明确不引入

除非未来出现真实需求，MVP、V1、V2 默认均不引入：

- Redis
- PostgreSQL
- MySQL
- Kafka
- RabbitMQ
- BullMQ
- Kubernetes
- 微服务架构
- NestJS

---

# 6. 总体架构

最终 V2 目标架构：

```text
┌───────────────────────────────────────────────┐
│                 Ubuntu Server                 │
│                                               │
│  Docker Compose                               │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │              SparkKeeper Server         │  │
│  │                                         │  │
│  │  Fastify API                            │  │
│  │  Scheduler                              │  │
│  │  Task Runner                            │  │
│  │  Playwright                             │  │
│  │  Drizzle ORM                            │  │
│  │  SQLite                                 │  │
│  │  Pino                                   │  │
│  └─────────────────────────────────────────┘  │
│                    │                          │
│                    │                          │
│  ┌─────────────────▼───────────────────────┐  │
│  │             Chromium                   │  │
│  │       Persistent Browser Profile       │  │
│  └─────────────────┬───────────────────────┘  │
│                    │                          │
│           https://www.douyin.com/chat         │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │             Admin Web                  │  │
│  │         Vue 3 + TypeScript             │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  Xvfb / noVNC：仅登录或维修时启用              │
└───────────────────────────────────────────────┘
```

## 6.1 逻辑分层

| 层 | 职责 |
|---|---|
| Presentation | Vue Admin、REST API、SSE |
| Application | Task Runner、Scheduler、状态机、重试、幂等 |
| Domain | Account、Friend、Schedule、Run、SendRecord、MessageProvider |
| Automation | Browser Session、Douyin Chat Adapter、Contact Resolver |
| Infrastructure | SQLite、Drizzle、Pino、截图、Trace、通知、Docker |

---

# 7. Monorepo 项目结构

推荐最终结构：

```text
sparkkeeper/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── application/
│   │   │   ├── scheduler/
│   │   │   ├── services/
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── admin-web/
│       ├── src/
│       └── package.json
│
├── packages/
│   ├── automation/
│   │   └── src/
│   │       ├── browser/
│   │       └── douyin/
│   ├── database/
│   ├── shared/
│   ├── message-engine/
│   └── notifier/
│
├── docs/
│   └── SparkKeeper_开发设计文档.md
│
├── docker/
├── scripts/
├── data/                 # gitignore
├── logs/                 # gitignore
├── screenshots/          # gitignore
├── .env.example
├── .gitignore
├── docker-compose.yml
├── eslint.config.js
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

## 7.1 包职责

### `apps/server`

最终承载：

- 服务启动；
- Scheduler；
- Task Runner；
- Fastify；
- SSE；
- 业务编排；
- 配置加载。

### `apps/admin-web`

V2 管理后台。

### `packages/automation`

所有浏览器自动化能力：

```text
browser/
douyin/
```

业务层不得直接使用散落的 CSS Selector 或 XPath。

### `packages/database`

- Drizzle Schema；
- Migration；
- Repository；
- SQLite 初始化；
- WAL 配置。

### `packages/shared`

只放：

- DTO；
- Enum；
- Zod Schema；
- 共享事件类型；
- 无平台依赖的公共类型。

### `packages/message-engine`

消息 Provider。

### `packages/notifier`

通知 Provider。

---

# 8. 项目初始化基线

项目初始化是开发准备工作，不计入 MVP/V1/V2。

目标是建立一个可以长期维护的 TypeScript Monorepo。

## 8.1 必须完成

- pnpm workspace；
- TypeScript strict；
- 根 `tsconfig.base.json`；
- ESLint；
- Prettier；
- `.editorconfig`；
- `apps/server`；
- `apps/admin-web` 基础项目；
- packages 基础目录；
- `.env.example`；
- `.gitignore`；
- README；
- docs；
- 根级统一命令。

根目录至少提供：

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## 8.2 初始化阶段明确不做

不得提前实现：

- Douyin 自动化；
- Persistent Context 业务；
- SQLite Schema；
- Scheduler；
- 联系人；
- 消息发送；
- Fastify 正式业务 API；
- 管理后台业务页面；
- SSE；
- noVNC；
- 通知业务。

## 8.3 初始化验收

必须通过：

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

# 9. MVP 设计

## 9.1 MVP 目标

MVP 只回答一个问题：

> **在固定服务器环境中，SparkKeeper 的核心浏览器自动化链路是否真实可行？**

MVP 不追求完整产品体验，不追求无人值守，只验证核心链路。

## 9.2 MVP 功能范围

MVP 必须包含：

1. Playwright Chromium 启动；
2. Persistent Browser Profile；
3. headed/headless 配置；
4. 首次人工登录；
5. Browser Profile 持久化；
6. 程序重启后复用登录态；
7. 打开 `https://www.douyin.com/chat`；
8. 登录状态识别；
9. 单账号；
10. 单联系人；
11. 联系人定位；
12. 打开聊天；
13. 输入一条固定测试消息；
14. 发送；
15. 验证自己的消息 Bubble 已出现；
16. 失败截图；
17. CLI/脚本手工触发。

## 9.3 MVP 明确不包含

MVP 不做：

- SQLite 正式业务模型；
- 多联系人；
- Scheduler；
- 自动每日执行；
- 幂等；
- 重试状态机；
- 管理后台；
- REST API；
- SSE；
- 通知；
- 完整 Docker Compose；
- 多账号；
- LLM 消息。

## 9.4 MVP 核心流程

```text
启动程序
    ↓
启动 Persistent Chromium
    ↓
打开 douyin.com/chat
    ↓
检测登录状态
    ↓
READY ?
├─ 否 → 输出 AUTH_REQUIRED / UNKNOWN → 截图 → 结束
└─ 是
    ↓
定位唯一目标联系人
    ↓
打开聊天
    ↓
输入测试消息
    ↓
发送
    ↓
等待自己的消息 Bubble
    ↓
验证文本
├─ 成功 → SUCCESS
└─ 失败 → FAILED + screenshot
```

## 9.5 MVP Browser Profile

必须使用：

```ts
chromium.launchPersistentContext(userDataDir, options)
```

禁止把下面方式作为正式 MVP 成功路径：

```text
newContext
+
addCookies
```

Cookie 手工导入只能作为调试工具，不能作为最终架构。

## 9.6 MVP 联系人策略

MVP 可以通过配置明确指定一个目标：

```text
target:
  displayName: "..."
```

但实现时仍应避免绝对 XPath。

如果出现多个相同昵称：

```text
AMBIGUOUS_CONTACT
```

MVP 不应“默认选第一个”。

## 9.7 MVP 发送成功判定

禁止：

```text
press Enter
→ sleep
→ success
```

必须确认：

```text
聊天消息区域
→ 出现自己刚发送的消息 Bubble
→ 文本与预期一致
→ SUCCESS
```

## 9.8 MVP 完成标准

MVP 必须同时满足：

- 浏览器可启动；
- Browser Profile 固定到指定目录；
- 首次人工登录成功；
- 程序关闭再启动后仍可复用会话；
- 能打开 Douyin Chat；
- 登录状态可识别；
- 能唯一定位一个目标联系人；
- 能发送一条测试消息；
- 能验证消息 Bubble；
- 失败时能保存截图；
- Browser Profile 不进入 Git；
- 核心逻辑有基本类型定义；
- 不依赖后续 V1/V2 组件才能运行。

> **只有 MVP 验收通过，才进入 V1。**

---

# 10. V1 设计

## 10.1 V1 目标

V1 的目标是：

> 把 MVP 的“能工作”升级成“可以在固定服务器上长期可靠运行”。

V1 是第一个真正可以长期自用的版本。

## 10.2 V1 必须包含

### 数据持久化

- SQLite；
- Drizzle；
- migration；
- WAL；
- Account；
- Friend；
- Schedule；
- DailyRun；
- SendRecord；
- MessageTemplate；
- SystemEvent。

### 多联系人

- 一个账号配置多个目标联系人；
- 联系人稳定身份信息；
- 匹配优先级；
- 重名歧义保护；
- 启用/停用。

### 每日调度

- 执行窗口；
- 时区；
- 每日 Run；
- 自动触发；
- 服务重启后恢复；
- 当天状态重建。

### 幂等

同一：

```text
account + friend + business_date
```

只允许一个最终 SUCCESS。

### 失败重试

对可恢复错误有限重试，例如：

- 页面超时；
- 网络加载失败；
- 联系人列表暂时未完成加载；
- 第一次消息验证超时。

### 登录失效

识别：

```text
READY
AUTH_EXPIRED
UNKNOWN
```

`AUTH_EXPIRED` 时：

- 停止当日后续发送；
- 保存错误截图；
- 写 SystemEvent；
- 等待人工恢复。

### 日志与证据

- Pino；
- runId；
- friendId；
- eventType；
- Screenshot；
- 可选 Playwright Trace；
- 日志轮转策略。

### 消息模板

V1 至少支持：

- StaticProvider；
- RandomProvider。

## 10.3 V1 每日任务流程

```text
Scheduler
    ↓
检查执行窗口
    ↓
创建/恢复 DailyRun
    ↓
打开 Persistent Browser
    ↓
Auth Check
    ↓
READY?
├─ AUTH_EXPIRED
│    ↓
│  SystemEvent
│    ↓
│  Screenshot
│    ↓
│  Stop
│
└─ READY
     ↓
加载 Enabled Friends
     ↓
逐个处理
     ↓
检查当天是否 SUCCESS
├─ 是 → SKIPPED_IDEMPOTENT
└─ 否
     ↓
Resolve Contact
     ↓
Build Message
     ↓
Send
     ↓
Verify
     ↓
Persist
     ↓
下一联系人
     ↓
Run Summary
```

## 10.4 V1 联系人身份模型

Friend 建议保存：

| 字段 | 说明 |
|---|---|
| `id` | 系统内部主键 |
| `accountId` | 所属账号 |
| `displayName` | 当前昵称 |
| `remarkName` | 备注名 |
| `shortId` | 可获取时保存 |
| `uniqueId` | 可获取时保存 |
| `secUid` | 可获取时保存 |
| `matchKey` | 当前实际绑定标识 |
| `enabled` | 是否参与任务 |

匹配优先级建议：

```text
uniqueId / secUid
        ↓
shortId
        ↓
remarkName
        ↓
displayName
```

任何一层存在多条候选时：

```text
AMBIGUOUS_CONTACT
```

停止该联系人任务。

## 10.5 V1 重试策略

| 错误 | 是否重试 | 策略 |
|---|---:|---|
| 网络瞬时错误 | 是 | 2–3 次 |
| 页面加载超时 | 是 | 刷新/重新打开后重试 |
| 联系人未加载 | 是 | 重新加载聊天列表 |
| 发送验证超时 | 谨慎 | 先检查是否实际已发送，避免重复 |
| AUTH_EXPIRED | 否 | 停止整批任务 |
| AMBIGUOUS_CONTACT | 否 | 人工修复 |
| SELECTOR_FAILURE | 否 | 保存证据，停止相关流程 |

## 10.6 V1 完成标准

- SQLite migration 正常；
- WAL 正常；
- 多联系人可配置；
- 每日 Scheduler 可执行；
- 服务重启不重复发送；
- 同一联系人同一天 SUCCESS 后幂等跳过；
- 有限重试正常；
- AUTH_EXPIRED 能停止任务；
- 联系人歧义不会误发；
- 关键错误有日志和截图；
- 可连续运行一段验证期；
- 无需 Web UI 也可以通过配置/CLI 完成维护。

> **只有 V1 达到长期稳定运行标准，才进入 V2。**

---

# 11. V2 设计

## 11.1 V2 目标

V2 的目标是：

> 在 V1 可靠自动化内核之上，形成一个完整、可视化、易部署、易维护的自托管开源产品。

V2 不重新设计自动化内核，而是在已经稳定的 V1 上增加产品层。

## 11.2 V2 必须包含

### Fastify API

提供：

- Health；
- System Status；
- Accounts；
- Friends；
- Schedules；
- Message Templates；
- Daily Runs；
- Send Records；
- Manual Run；
- System Events；
- SSE。

### Vue 3 Admin

至少包括：

- Dashboard；
- 账号状态；
- 好友管理；
- 调度设置；
- 消息模板；
- 今日任务；
- 发送历史；
- 系统事件；
- 登录维修入口；
- 系统设置。

### SSE

后台实时显示：

```text
RUN_STARTED
AUTH_CHECKING
FRIEND_RESOLVING
MESSAGE_BUILDING
MESSAGE_SENDING
VERIFYING
VERIFY_SUCCESS
RETRY_WAIT
AUTH_EXPIRED
RUN_FINISHED
```

### 通知

至少实现一种失败通知 Provider。

默认策略：

- 全部成功：静默或只记录；
- 登录失效：通知；
- 最终失败：通知；
- 连续运行异常：通知。

### Docker Compose

支持在干净 Ubuntu 服务器按文档部署：

```text
docker compose up -d
```

数据必须持久化。

### 登录维修

通过：

```text
Xvfb + noVNC
```

提供首次登录/重新登录能力。

noVNC 默认不得直接公网裸露。

### 运维能力

- 数据备份；
- 日志轮转；
- Profile 持久化；
- SQLite 持久化；
- 升级说明；
- 故障排查说明。

## 11.3 V2 明确不包含

V2 仍不做：

- 多租户 SaaS；
- Redis/BullMQ 分布式队列；
- 多服务器 Worker；
- Kubernetes；
- 企业级 RBAC；
- 复杂组织权限体系；
- 默认 PostgreSQL；
- 自动破解登录异常；
- 批量营销工具。

## 11.4 V2 完成标准

管理员无需修改代码即可：

- 查看登录状态；
- 查看今日完成情况；
- 管理联系人；
- 修改任务窗口；
- 启停联系人；
- 管理消息模板；
- 查看发送历史；
- 查看失败截图/错误；
- 手工触发一次受幂等保护的任务；
- 接收失败通知；
- 完成人工重新登录；
- 在服务器重启/容器升级后保留数据和 Browser Profile。

---

# 12. 浏览器与登录态设计

## 12.1 Persistent Context

Browser Profile 是 SparkKeeper 最重要的运行时状态之一。

建议路径：

```text
/data/browser-profile/
```

示例：

```ts
const context = await chromium.launchPersistentContext(
  config.browser.userDataDir,
  {
    headless: config.browser.headless,
    viewport: {
      width: 1440,
      height: 900,
    },
    locale: 'zh-CN',
    timezoneId: config.app.timezone,
  },
);
```

## 12.2 Profile 原则

- 固定目录；
- Docker Volume；
- 不提交 Git；
- 不把 Cookie 打印到日志；
- 不在多个 Worker 同时打开同一个 Profile；
- Profile 升级/迁移前先备份；
- 登录失效后允许人工重新登录。

## 12.3 登录状态

建议：

```ts
type LoginStatus =
  | 'READY'
  | 'AUTH_EXPIRED'
  | 'UNKNOWN';
```

判断顺序：

1. 登录后聊天页面特征；
2. 登录/扫码页面特征；
3. 都无法确定 → `UNKNOWN`；
4. `UNKNOWN` 不发送。

---

# 13. Douyin 页面适配层

所有 DOM、Locator、页面事件、网络响应解析必须集中到：

```text
packages/automation/src/douyin/
```

建议：

```text
douyin/
├── DouyinChatPage.ts
├── ContactResolver.ts
├── MessageSender.ts
├── AuthDetector.ts
├── selectors.ts
├── responseParsers.ts
└── types.ts
```

## 13.1 Selector 原则

优先级：

```text
稳定语义属性
    ↓
可访问性定位
    ↓
稳定文本结构
    ↓
相对 DOM 结构
    ↓
动态 class（仅兜底）
```

禁止依赖：

- 大量绝对 XPath；
- 深层 `div/div/div/...`；
- 散落在业务层的 Selector。

## 13.2 Selector 变化

任何 Selector 修复应：

- 集中修改 adapter；
- 保留失败截图；
- 更新 fixture；
- 执行 selector/parser 回归测试；
- 做一次真实 smoke test。

---

# 14. 联系人身份模型

昵称只是展示信息，不能假设其唯一。

联系人绑定应支持多个可获取标识。

建议 Domain：

```ts
interface FriendIdentity {
  displayName?: string;
  remarkName?: string;
  shortId?: string;
  uniqueId?: string;
  secUid?: string;
}
```

解析结果：

```ts
type ContactResolveResult =
  | { type: 'FOUND'; contact: ResolvedContact }
  | { type: 'NOT_FOUND' }
  | { type: 'AMBIGUOUS'; candidates: ResolvedContact[] };
```

禁止：

```text
存在多个结果
→ 默认选第一条
```

---

# 15. 消息引擎

统一接口：

```ts
export interface MessageProvider {
  build(context: MessageContext): Promise<string>;
}
```

## 15.1 MVP

只需要：

```text
FixedMessage
```

用于技术验证。

## 15.2 V1

必须：

```text
StaticProvider
RandomProvider
```

## 15.3 V2 可选增强

可以扩展：

```text
HitokotoProvider
LLMProvider
```

但必须是可选模块，不能成为核心任务成功的依赖。

## 15.4 消息校验

发送前：

- 非空；
- 长度限制；
- 去除异常控制字符；
- Provider 异常不能导致系统失控；
- 保存最终发送文本到 SendRecord。

---

# 16. 调度、重试与幂等

## 16.1 时间窗口

推荐：

```text
19:30 - 21:00
```

而不是只定义：

```text
20:00:00
```

执行窗口的作用是提高容错能力。

## 16.2 Daily Run

每天每个账号最多存在一个业务批次：

```text
account + businessDate
```

## 16.3 幂等

关键约束：

```text
friend + businessDate
```

当天已经：

```text
SUCCESS
```

则：

```text
SKIPPED_IDEMPOTENT
```

## 16.4 手工执行

V2 管理后台的“手工执行”同样必须经过幂等逻辑。

默认不提供绕过幂等强制重复发送能力。

---

# 17. 数据模型

V1 引入正式数据库。

## 17.1 `accounts`

| 字段 | 说明 |
|---|---|
| id | 主键 |
| name | 显示名称 |
| enabled | 是否启用 |
| loginStatus | 登录状态 |
| lastLoginAt | 最近成功登录 |
| createdAt | 创建时间 |
| updatedAt | 更新时间 |

## 17.2 `friends`

| 字段 | 说明 |
|---|---|
| id | 主键 |
| accountId | 所属账号 |
| displayName | 昵称 |
| remarkName | 备注 |
| shortId | 短 ID |
| uniqueId | 唯一标识 |
| secUid | 安全 UID |
| matchKey | 当前绑定键 |
| enabled | 是否启用 |
| createdAt | 创建时间 |
| updatedAt | 更新时间 |

## 17.3 `schedules`

| 字段 | 说明 |
|---|---|
| id | 主键 |
| accountId | 账号 |
| startTime | 窗口开始 |
| endTime | 窗口结束 |
| timezone | 时区 |
| maxAttempts | 最大尝试次数 |
| retryIntervalSeconds | 重试间隔 |
| enabled | 是否启用 |

## 17.4 `message_templates`

| 字段 | 说明 |
|---|---|
| id | 主键 |
| name | 名称 |
| providerType | Provider |
| content | 内容 |
| enabled | 是否启用 |

## 17.5 `daily_runs`

| 字段 | 说明 |
|---|---|
| id | 主键 |
| accountId | 账号 |
| businessDate | 业务日期 |
| status | 批次状态 |
| startedAt | 开始 |
| finishedAt | 完成 |

唯一约束建议：

```text
UNIQUE(account_id, business_date)
```

## 17.6 `send_records`

| 字段 | 说明 |
|---|---|
| id | 主键 |
| runId | DailyRun |
| friendId | 联系人 |
| businessDate | 业务日期 |
| message | 最终消息 |
| status | 状态 |
| attemptCount | 尝试次数 |
| sentAt | 成功发送时间 |
| lastError | 最后错误 |
| createdAt | 创建 |
| updatedAt | 更新 |

建议唯一约束围绕：

```text
friend_id + business_date
```

设计，确保业务幂等。

## 17.7 `system_events`

保存：

- AUTH_EXPIRED；
- SELECTOR_FAILURE；
- 浏览器异常；
- 连续任务失败；
- 其他需要追踪的系统级事件。

## 17.8 Migration 原则

- migration 文件纳入版本控制；
- 已执行 migration 不回改；
- 新结构通过新 migration 演进；
- 禁止生产启动时 destructive sync。

---

# 18. 后端 API 设计

V2 才实现正式业务 API。

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/system/status` | 服务、浏览器、登录、Scheduler 状态 |
| GET | `/api/accounts` | 账号列表 |
| POST | `/api/accounts/:id/login-session` | 进入登录维修流程 |
| GET | `/api/friends` | 联系人列表 |
| POST | `/api/friends` | 添加联系人 |
| PATCH | `/api/friends/:id` | 修改联系人 |
| GET | `/api/schedules` | 调度列表 |
| PUT | `/api/schedules/:id` | 更新调度 |
| GET | `/api/message-templates` | 消息模板 |
| POST | `/api/message-templates` | 创建模板 |
| PATCH | `/api/message-templates/:id` | 修改模板 |
| GET | `/api/runs/today` | 今日运行状态 |
| GET | `/api/runs` | 历史 Run |
| POST | `/api/runs/manual` | 手工触发 |
| GET | `/api/send-records` | 发送历史 |
| GET | `/api/system-events` | 系统事件 |
| GET | `/api/events/stream` | SSE |

API 入参和响应 Schema 建议使用 Zod。

---

# 19. 管理后台设计

## 19.1 Dashboard

优先显示：

```text
登录状态
今日完成 / 总数
今日失败
今日跳过
下一次执行窗口
最近系统错误
```

## 19.2 页面

| 页面 | 功能 |
|---|---|
| Dashboard | 今日运行总览 |
| 账号管理 | 登录状态、启停、重新登录 |
| 好友管理 | 联系人绑定、标识、启停 |
| 调度设置 | 时间窗口、时区、重试 |
| 消息模板 | 模板管理和预览 |
| 今日任务 | 实时任务进度 |
| 发送记录 | 日期/联系人/状态筛选 |
| 系统事件 | AUTH_EXPIRED、Selector 等 |
| 系统设置 | 运行参数、通知、日志级别 |

## 19.3 UI 原则

- “今天是否成功”是第一信息层级；
- 异常比普通配置更醒目；
- 不展示 Cookie；
- 不展示 Browser Profile 文件；
- 危险操作二次确认；
- 后台不为了视觉效果增加无业务价值页面。

---

# 20. 实时状态与通知

## 20.1 SSE 事件

建议：

```ts
type RuntimeEventType =
  | 'RUN_STARTED'
  | 'AUTH_CHECKING'
  | 'AUTH_EXPIRED'
  | 'FRIEND_RESOLVING'
  | 'CONTACT_NOT_FOUND'
  | 'AMBIGUOUS_CONTACT'
  | 'MESSAGE_BUILDING'
  | 'MESSAGE_SENDING'
  | 'VERIFYING'
  | 'VERIFY_SUCCESS'
  | 'RETRY_WAIT'
  | 'TASK_FAILED'
  | 'RUN_FINISHED';
```

## 20.2 通知 Provider

统一接口：

```ts
export interface Notifier {
  send(event: NotificationEvent): Promise<void>;
}
```

V2 至少落地一种合法通知渠道。

---

# 21. 日志、截图与可观测性

## 21.1 日志字段

至少：

```text
timestamp
level
eventType
runId
accountId
friendId
attempt
message
errorCode
```

## 21.2 敏感字段

统一 redact：

- Cookie；
- Authorization；
- Token；
- Secret；
- Browser Profile 内容；
- 登录二维码截图如包含敏感状态，应按生命周期清理。

## 21.3 截图

失败截图：

```text
data/screenshots/YYYY-MM-DD/<runId>/
```

建议命名：

```text
auth-expired.png
contact-not-found-<friendId>.png
selector-failure.png
verify-failed-<friendId>.png
```

## 21.4 Trace

Playwright Trace 不必每天全量开启。

建议：

- DEBUG 模式；
- 连续失败；
- Selector Failure；
- 手工诊断。

---

# 22. 安全设计

- Browser Profile 永不进入 Git；
- `.env` 永不进入 Git；
- SQLite 正式数据默认不进入 Git；
- noVNC 默认只监听本机/私网；
- 推荐 SSH Tunnel；
- 管理后台应置于认证之后；
- Secret 只通过环境变量/服务器 Secret；
- 日志敏感字段脱敏；
- 容器尽量使用非 root；
- 不提供绕过验证功能；
- 不提供大规模群发能力；
- 不把账号凭据嵌入镜像。

---

# 23. Docker 与服务器部署

V2 正式完成 Docker Compose。

## 23.1 推荐服务器

| 项目 | 建议 |
|---|---|
| OS | Ubuntu 24.04 LTS |
| CPU | 2 vCPU 起 |
| RAM | 4 GB 推荐 |
| Disk | 20 GB+ SSD |
| Runtime | Docker Engine + Compose |
| Timezone | 应用显式配置 |

## 23.2 持久化目录

```text
/opt/sparkkeeper/
├── data/
│   ├── browser-profile/
│   ├── sparkkeeper.db
│   └── screenshots/
└── logs/
```

必须保证：

```text
docker compose down
docker compose up -d
```

之后：

- 登录态仍在；
- SQLite 仍在；
- 历史记录仍在。

## 23.3 noVNC

用途只有：

- 第一次登录；
- AUTH_EXPIRED；
- 页面异常维修。

默认不作为常驻公网服务。

---

# 24. 配置管理

## 24.1 环境配置

环境变量：

- `NODE_ENV`
- `PORT`
- `DATA_DIR`
- `BROWSER_PROFILE_DIR`
- `BROWSER_HEADLESS`
- `APP_TIMEZONE`
- `LOG_LEVEL`

## 24.2 业务配置

MVP：

```text
本地开发配置 / 测试配置
```

V1：

```text
SQLite
```

V2：

```text
SQLite + Admin Web
```

## 24.3 配置 Schema

使用 Zod 校验。

配置错误必须在启动阶段明确失败，而不是运行到发送阶段才暴露。

---

# 25. 测试策略

## 25.1 Unit

覆盖：

- Message Provider；
- 状态机；
- Retry Policy；
- 幂等判断；
- Zod Schema；
- 日期/时区逻辑。

## 25.2 Database

覆盖：

- migration；
- 唯一约束；
- CRUD；
- DailyRun；
- SendRecord；
- WAL 初始化。

## 25.3 Automation Contract

通过保存的 HTML fixture / DOM 片段测试：

- Selector；
- response parser；
- contact identity parser；
- auth detector。

## 25.4 Browser Integration

对受控测试页面验证：

- Browser Session；
- Persistent Profile；
- Screenshot；
- Trace。

## 25.5 Real Smoke Test

真实平台只做人工触发 Smoke：

- 登录；
- 联系人绑定；
- 单条发送；
- 结果验证。

真实账号 E2E 不放到公共 CI 自动运行。

---

# 26. 开发任务拆解

## 26.1 项目初始化

### Task 00 — Project Foundation

建议分支：

```text
feature/bootstrap-foundation
```

产物：

- pnpm Monorepo；
- TypeScript；
- ESLint；
- Prettier；
- apps；
- packages；
- README；
- docs；
- `.env.example`；
- Docker skeleton。

验收：

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

## 26.2 MVP

### Task M1 — Persistent Browser Session

分支：

```text
feature/browser-persistent-session
```

实现：

- Playwright；
- Chromium；
- Persistent Context；
- userDataDir；
- headed/headless；
- Profile 忽略规则；
- 基础 Browser Session API。

### Task M2 — Auth Detection

分支：

```text
feature/douyin-auth-detection
```

实现：

```text
READY
AUTH_EXPIRED
UNKNOWN
```

以及失败截图。

### Task M3 — Douyin Chat Adapter

分支：

```text
feature/douyin-chat-adapter
```

实现：

- 打开 Chat；
- 页面 readiness；
- Selector 集中管理；
- conversation list；
- 基础解析。

### Task M4 — Single Contact Resolver

分支：

```text
feature/single-contact-resolver
```

实现：

- 单联系人配置；
- 唯一匹配；
- NOT_FOUND；
- AMBIGUOUS。

### Task M5 — Send and Verify

分支：

```text
feature/message-send-verification
```

实现：

- 固定消息；
- 输入；
- 发送；
- Bubble 验证；
- screenshot。

### MVP Release Gate

通过真实服务器 Smoke Test：

```text
Persistent Profile
→ 登录保持
→ Chat
→ 单联系人
→ Send
→ Verify
```

通过后：

```text
tag: v0.1.0-mvp
```

---

## 26.3 V1

### Task V1-1 — Database Foundation

分支：

```text
feature/database-foundation
```

实现：

- SQLite；
- Drizzle；
- migration；
- WAL；
- Repository。

### Task V1-2 — Friend Identity

分支：

```text
feature/friend-identity
```

实现多标识联系人模型。

### Task V1-3 — Message Engine

分支：

```text
feature/message-engine
```

实现：

- StaticProvider；
- RandomProvider。

### Task V1-4 — Daily Run and Idempotency

分支：

```text
feature/daily-run-idempotency
```

实现：

- DailyRun；
- SendRecord；
- UNIQUE；
- SKIPPED_IDEMPOTENT。

### Task V1-5 — Scheduler

分支：

```text
feature/task-scheduler
```

实现：

- 时间窗口；
- 时区；
- 每日触发；
- 服务重启恢复。

### Task V1-6 — Retry and Failure State

分支：

```text
feature/retry-failure-state
```

实现：

- retry；
- attempt；
- RETRY_WAIT；
- final FAILED。

### Task V1-7 — Observability

分支：

```text
feature/runtime-observability
```

实现：

- Pino；
- screenshot；
- SystemEvent；
- Trace policy；
- 日志轮转。

### V1 Release Gate

要求：

- 多联系人；
- 定时任务；
- 幂等；
- 重试；
- AUTH_EXPIRED；
- 连续验证期运行；
- 无重复发送；
- 可定位失败原因。

通过后：

```text
tag: v1.0.0
```

---

## 26.4 V2

### Task V2-1 — Fastify API

分支：

```text
feature/server-api
```

### Task V2-2 — SSE Runtime Events

分支：

```text
feature/runtime-events
```

### Task V2-3 — Admin Web Foundation

分支：

```text
feature/admin-web-foundation
```

### Task V2-4 — Admin Business Pages

分支：

```text
feature/admin-task-management
```

### Task V2-5 — Notification Provider

分支：

```text
feature/failure-notification
```

### Task V2-6 — Login Maintenance

分支：

```text
feature/login-maintenance
```

实现受控 Xvfb/noVNC 流程。

### Task V2-7 — Docker Production Runtime

分支：

```text
feature/docker-production
```

实现：

- Compose；
- Volume；
- healthcheck；
- restart；
- upgrade；
- backup。

### Task V2-8 — Release Documentation

分支：

```text
feature/v2-release-docs
```

实现：

- 部署；
- 配置；
- 运维；
- 备份；
- 登录失效；
- Selector 故障；
- 贡献指南。

### V2 Release Gate

通过：

- 干净 Ubuntu 部署；
- UI 管理；
- SSE；
- 通知；
- noVNC；
- Profile 保留；
- DB 保留；
- 重启恢复；
- 升级验证；
- 文档完整。

通过后：

```text
tag: v2.0.0
```

---

# 27. Git 分支与交付规则

长期分支：

```text
main
develop
```

开发流：

```text
develop
    ↓
feature/*
    ↓
Pull Request
    ↓
develop
```

正式版本稳定后：

```text
develop
    ↓
release PR
    ↓
main
    ↓
tag
```

## 27.1 每个任务原则

- 一个清晰 feature branch；
- 不混入下一阶段功能；
- 合并前完成测试；
- PR 描述包含验证结果；
- feature 合并后删除远程分支；
- 本地同步 develop；
- 删除本地已合并 feature；
- prune 远程引用。

## 27.2 提交前检查

至少：

```bash
git status
git diff --stat
git diff
```

确认以下内容未进入 Git：

```text
.env
node_modules/
data/browser-profile/
*.db
logs/
screenshots/
playwright-report/
test-results/
```

---

# 28. 总体验收标准

## 28.1 MVP

- [ ] Persistent Context 工作；
- [ ] Browser Profile 持久；
- [ ] 重启后复用登录态；
- [ ] Login Status 可判断；
- [ ] 可打开 Chat；
- [ ] 可唯一定位一个联系人；
- [ ] 可发送一条消息；
- [ ] 可验证自己的消息 Bubble；
- [ ] 失败有截图。

## 28.2 V1

- [ ] 多联系人；
- [ ] SQLite；
- [ ] migration；
- [ ] Scheduler；
- [ ] 时间窗口；
- [ ] 幂等；
- [ ] retry；
- [ ] AUTH_EXPIRED；
- [ ] SystemEvent；
- [ ] 日志；
- [ ] screenshot；
- [ ] 连续验证期无重复发送。

## 28.3 V2

- [ ] Fastify API；
- [ ] Vue Admin；
- [ ] SSE；
- [ ] 通知；
- [ ] Docker Compose；
- [ ] noVNC 登录维修；
- [ ] UI 管理好友；
- [ ] UI 管理调度；
- [ ] UI 查看今日状态；
- [ ] UI 查看历史；
- [ ] 容器升级数据不丢；
- [ ] 服务器重启可恢复；
- [ ] 部署/运维文档完整。

---

# 29. 风险与维护策略

| 风险 | 影响 | 策略 |
|---|---|---|
| DOM 改版 | Selector 失效 | Adapter 隔离、截图、fixture |
| 网页能力变化 | 自动化链路不可用 | 停止任务，重新评估合法可用方案 |
| 登录失效 | 当日任务失败 | AUTH_EXPIRED + 人工登录 |
| 服务器网络变化 | 登录/访问异常 | 固定环境、避免频繁迁移 |
| SQLite 损坏 | 历史状态丢失 | 定期备份 |
| 磁盘占满 | 服务异常 | 日志/Trace/截图轮转 |
| 联系人误匹配 | 错发 | 稳定标识 + 歧义停止 |
| 重复发送 | 用户体验风险 | 数据库唯一约束 + 幂等 |
| 自动化验证误判 | 状态不可信 | Bubble 验证 + 审慎重试 |

---

# 30. 后续演进方向

V2 之后再根据真实使用情况考虑：

- 多账号隔离；
- 每账号独立 Browser Profile；
- 更多通知 Provider；
- LLM MessageProvider；
- 自动 Selector Health Check；
- 备份/恢复工具；
- 数据导入导出；
- 版本升级助手；
- 真实规模需要时迁移 PostgreSQL；
- 多 Worker 需求真实存在后再评估队列组件。

原则：

> **只有出现真实业务或运维问题后才增加复杂组件。**

---

# 31. 附录 A：环境变量示例

```dotenv
NODE_ENV=production
PORT=8080

DATA_DIR=/app/data
BROWSER_PROFILE_DIR=/app/data/browser-profile
BROWSER_HEADLESS=true

APP_TIMEZONE=Asia/Shanghai
LOG_LEVEL=info
```

V2 可增加：

```dotenv
ADMIN_AUTH_SECRET=
NOTIFY_PROVIDER=
NOTIFY_WEBHOOK_URL=
```

所有 Secret：

- 不提交 Git；
- 不写普通日志；
- 不写 README 示例真实值。

---

# 32. 附录 B：任务状态

建议状态：

| 状态 | 含义 |
|---|---|
| `PENDING` | 等待执行 |
| `RUNNING` | 执行中 |
| `SUCCESS` | 发送并验证成功 |
| `RETRY_WAIT` | 等待重试 |
| `FAILED` | 最终失败 |
| `AUTH_EXPIRED` | 登录失效 |
| `UNKNOWN_AUTH` | 登录状态无法判断 |
| `CONTACT_NOT_FOUND` | 未找到联系人 |
| `AMBIGUOUS_CONTACT` | 联系人歧义 |
| `SELECTOR_FAILURE` | 页面适配失败 |
| `VERIFY_FAILED` | 发送验证失败 |
| `SKIPPED_IDEMPOTENT` | 当天已成功，幂等跳过 |

---

# 33. 附录 C：Codex 开发约束

每次交给 Codex 前，要求其先阅读本文档。

统一要求：

1. 本文档是产品和技术基线。
2. 一次任务只实现当前指定范围。
3. 不提前实现下一版本。
4. 不擅自增加 Redis、PostgreSQL、Kafka、RabbitMQ、BullMQ、NestJS 或微服务。
5. 不把页面 Selector 散落到业务层。
6. 不把 Browser Profile、Cookie、Secret 提交到仓库。
7. 不使用 `any` 逃避核心业务类型设计。
8. 不创建无边界的 `utils.ts`、`helpers.ts`、`common.ts`。
9. 修改完成后必须运行当前阶段要求的 lint、typecheck、test、build。
10. 不自动执行 `git commit` 或 `git push`，除非任务明确要求。
11. 如果真实技术条件与文档冲突，先报告冲突，不自行扩大架构。
12. 所有公开项目内容只描述 SparkKeeper 本身。

---

# 版本路线总结

```text
Project Foundation
    │
    ▼
MVP
核心技术链路成立
    │
    ▼
V1
长期可靠自动运行
    │
    ▼
V2
完整自托管开源产品
```

最重要的阶段判断：

> **MVP 解决“能不能做”。**  
> **V1 解决“能不能稳定长期跑”。**  
> **V2 解决“能不能成为一个完整、可维护、可视化、自托管的开源产品”。**
