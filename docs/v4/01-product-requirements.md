# SparkKeeper V4.0.0 产品需求冻结

> 状态：FROZEN
> 冻结输入：用户提供的 `SparkKeeper_V4_Product_Requirements.md`
> 输入 SHA-256：`44be34448fbc6d5bbf5dac6eb031fa8ff1b902afd1b1325150aaf5ec056016da`
> 本文是实现与验收使用的规范化产品基线；不替代原始输入的历史价值。

## 1. 产品定义

SparkKeeper V4.0.0 是单实例、受控管理员使用的自托管 Douyin 关系维护管理平台。管理员通过 HTTPS 登录 SparkKeeper，由本人扫码绑定 Douyin Account，在正常 `/chat` 页面上下文内同步可发现联系人，从 Contact Directory 明确选择目标，通过 Template 执行单/多目标 Test Send，并配置一个或多个多目标 SendTask。

V4 必须优先保证：目标唯一、发送动作至多一次、机器结果可信、不确定时不补发、历史可审计、Profile/认证材料不外泄。

## 2. V4.0.0 范围

### 2.1 Public Admin

- 公网仅开放 80/443；HTTP 强制跳转 HTTPS；
- SparkKeeper 自身使用管理员用户名/密码认证；
- 支持登录、退出、Session 过期、修改密码、最近敏感操作重新认证；
- 未认证用户不能读取业务、运行、联系人、配置或 SSE；
- noVNC/登录控制台不直接暴露 6080，也不向浏览器用户提供 VNC password。

### 2.2 Douyin Account

- “添加 Account”启动临时、受保护的 AccountLoginSession；
- 用户本人扫码并处理正常挑战/CAPTCHA/风控；
- 系统检测 READY，读取当前账号的可用基本资料并自动创建 DouyinAccount；
- Avatar、Display Name、Douyin Unique ID/Short ID/Sec UID 来自正常页面可观察数据；
- 每个 Account 使用独立 persistent browser profile；
- 支持 Account relogin、`AUTH_EXPIRED`、soft unbind 与 Profile quarantine；
- V4 不允许多个 Account 共享全局 profile。

### 2.3 Contact Directory

- `Friend` 在 V4 业务/API/UI 中 deprecated，替换为 `Contact`/`ChatTarget`；
- Contact 类型固定为 `PERSON | GROUP | SYSTEM | UNKNOWN`；
- 同步来源仅限正常加载的 `douyin.com/chat` DOM、正常页面已加载数据和项目维护的响应 parser；
- 禁止私有 API replay、签名逆向、token/cookie 抓取和完整响应/聊天 DOM dump；
- 展示可用的 avatar、display name、Douyin ID、type、identity status、availability 与可选 streak days；
- Contact 被发现不等于允许发送；只有管理员明确选择后才成为 Test Send/SendTask target；
- SYSTEM 与 UNKNOWN 在 V4.0.0 不可发送。

### 2.4 Stable Identity

- PERSON candidate identity 顺序：`SEC_UID → UNIQUE_ID → SHORT_ID → REMARK_NAME → DISPLAY_NAME`；
- GROUP 必须使用稳定 `CONVERSATION_ID` 或等价、页面可观察的稳定 conversation identity；
- runtime 只使用管理员/同步流程已确定的 preferred identity；
- 默认和定时运行中禁止 silent fallback；
- 0 match → STOP，1 match → 继续，multiple match → STOP；
- 禁止 `first()`、`nth(0)` 或看到第一个候选即发送；
- identity unavailable/changed 必须阻止发送并进入重新同步/人工重绑流程。

### 2.5 Test Send

- 支持 1 个或多个 Contact；
- 必须先生成服务端 preview，再由管理员确认完全相同的 Account/Template/目标集合；
- 默认 `concurrency=1`；V4.0.0 不提供并发调整；
- 每个目标独立 SendRecord；
- `AUTH_EXPIRED`、AUTH UNKNOWN、CAPTCHA/风控或全局 browser/profile failure 停止整个 batch；
- 任一 `DELIVERY_UNKNOWN` 默认停止整个 batch，未开始目标标记 batch-aborted；
- `DELIVERY_UNKNOWN` 永不自动重试；
- Test Send 与 scheduled send 复用同一个 per-target coordinator/resolver/sender/verifier，不建立第二套发送实现；
- V4.0.0 单次 Test Send 最多 20 个目标。

### 2.6 Delivery Verification

- 发送前记录 current conversation witness、outgoing baseline 与本次已知消息；
- 在不可逆发送动作前启动 DOM mutation observation，避免 click 后才监听的竞态；
- SUCCESS 必须证明 baseline 之后出现新的、方向为 outgoing、内容与本次消息严格一致且可归因于本次动作的 bubble；
- composer cleared、click resolved、Enter pressed、最后一条 bubble、任意新 bubble 均不能单独证明 SUCCESS；
- virtualized list 的节点卸载/重挂载不得被当作新消息；
- 发送动作可能发生但证据不足 → `DELIVERY_UNKNOWN`；
- 只有可以证明发送动作没有发生的 pre-action failure 才可 `FAILED` 或进入有限 retry。

### 2.7 Human Resolution

- 人工判断不修改 SendRecord 的 machine status；
- append-only DeliveryResolution 表达 `CONFIRMED_DELIVERED | CONFIRMED_NOT_DELIVERED | INCONCLUSIVE`；
- UI 同时显示原始机器结论与最新人工结论；
- `CONFIRMED_NOT_DELIVERED` 不触发自动补发，新的发送必须成为新的、明确确认的 Test Send/Task intent。

### 2.8 Templates、Tasks 与 Runs

- 复用 V3 MessageTemplate；`STATIC`/`RANDOM` 保持；
- 一个 SendTask 固定关联 1 Account、1 Template、1..N Contacts、时区、每日时间窗口与 retry policy；
- 一个 Account 可以有多个 Task；一个 Contact 可以属于多个 Task；
- 新 Task 默认 disabled；enable 是独立危险操作；
- V4.0.0 每个 Task 最多 100 个目标；
- 同一 Contact 在两个不同 Task 中属于两个明确业务意图，允许各发送一次；UI 必须提示重叠目标；
- scheduled idempotency key 固定为 `taskId + contactId + businessDate`；
- Test Send 使用客户端生成、服务端持久化的 `Idempotency-Key`，不与 scheduled key 共用；
- 多目标 Run 对每个目标产生独立结果。

### 2.9 Retry

可自动 retry 的前提同时为：

1. failure 明确发生在不可逆发送动作之前；
2. adapter 明确返回 `NOT_STARTED` 或 `NOT_TRIGGERED`；
3. failure 属于受控 transient 类；
4. 未超过 maxAttempts；
5. 下一次仍在相同 Task/BusinessDate 窗口。

`TARGET_NOT_FOUND`、`TARGET_AMBIGUOUS`、`TARGET_IDENTITY_UNAVAILABLE`、`IDENTITY_CHANGED`、AUTH/CAPTCHA/风控、配置错误、selector contract failure 默认不可自动 retry。发送边界之后只允许 SUCCESS 或 DELIVERY_UNKNOWN。

### 2.10 Migration 与历史

- SQLite + WAL + Drizzle + versioned migrations 保持到 V4.0.0；
- 已执行的 `0000`–`0007` 永不修改；
- Account、Friend、Template、Schedule、DailyRun、SendRecord、SystemEvent、NotificationConfig 全部保留；
- Friend 不因 displayName 相同自动绑定 Contact；
- 旧 Friend 创建 pending legacy binding，由管理员选择 Contact 后明确绑定；
- V3 Schedule 因没有持久化 Template/目标关系，先迁移为 pending legacy schedule import，不创建无效/可能误启用的 Task；管理员完成 Template/target 选择后生成 disabled SendTask；
- 历史 `DELIVERY_UNKNOWN` 保持原值，只能新增 DeliveryResolution；
- 旧 DailyRun/SendRecord 继续可读，新的 V4 Run/SendRecord 使用独立现代执行表。

## 3. 明确非目标

V4.0.0 不包含：

- SaaS、多租户、组织/RBAC；
- PostgreSQL 或其他数据库替换；
- Douyin 官方 API 集成或私有 API 逆向；
- 签名逆向、cookie/token 导出、CAPTCHA 自动化、风控绕过、stealth；
- 陌生人营销群发、自动加好友/关注/点赞；
- 聊天正文分析、画像或通过正文推算 streak；
- 无限联系人抓取、无限 Test Send/Task targets；
- 多 Worker、分布式队列、Kubernetes；
- SYSTEM/UNKNOWN 发送；
- 自动 hard-delete Account/Profile/历史；
- Scheduler Gate F 前的生产启用。

## 4. 产品信息架构

```text
Login

Overview

Accounts
└─ Account Detail
   ├─ Overview
   ├─ Contacts
   ├─ Test Send
   ├─ Tasks
   └─ History

Templates
Tasks
Runs

Operations
├─ Notifications
└─ System
```

页面目标、数据源、操作和状态详见 [架构冻结的 Frontend IA](./02-architecture-product-freeze.md#17-frontend-ia-冻结)。

## 5. Scheduler Release Gate

生产 `SCHEDULER_ENABLED=false` 保持到以下 Gate 依次通过：

- Gate A：全部 no-send engineering/security/migration/privacy tests；
- Gate B：真实 Account onboarding + Contact Sync，无发送；
- Gate C：一个明确授权 PERSON 的单条发送与自动 SUCCESS；
- Gate D：少量明确授权 PERSON，顺序发送、无重复/越权；
- Gate E：单独授权一个 GROUP，稳定 identity 与自动 SUCCESS；
- Gate F：在 A–E 全部 PASS 后，首次少量目标 Scheduler。

每个真实 Gate 必须单独授权账号、目标、消息上限和是否包含 GROUP。

## 6. V4.0.0 产品验收

- [ ] HTTPS 公网入口仅暴露 80/443；
- [ ] 未认证用户无法读取 Admin/API/SSE；
- [ ] 密码强哈希、Session expiry、logout、CSRF、rate limit、audit 生效；
- [ ] 用户本人扫码后自动创建 Account；
- [ ] Account 基本资料来自 Douyin 正常页面；
- [ ] 每个 Account 独立 Profile；
- [ ] 可安全 relogin/unbind，AUTH_EXPIRED 阻止执行；
- [ ] Contact Sync 区分 PERSON/GROUP/SYSTEM/UNKNOWN；
- [ ] Contact Directory 展示冻结字段与同步状态；
- [ ] streak 不可识别时为 null，不猜测；
- [ ] PERSON/GROUP runtime 使用 preferred stable identity；
- [ ] 0/multiple/unavailable/changed 全部 STOP；
- [ ] 单/多目标 Test Send 需要 preview + explicit confirmation；
- [ ] 每目标独立记录，默认顺序执行；
- [ ] Delivery Verification 已覆盖 known V3 false-negative regression；
- [ ] 可能已发送时只产生 DELIVERY_UNKNOWN 且不自动重试；
- [ ] 人工 resolution 不覆盖 machine truth；
- [ ] 一个 Account 可有多个 Task，一个 Task 可有 1..N Contacts；
- [ ] scheduled idempotency 为 Task+Contact+BusinessDate；
- [ ] V3 数据和历史可读，旧 Friend 不按名称自动绑定；
- [ ] noVNC/VNC password/Profile/Cookie/Token/QR 不对公网或日志暴露；
- [ ] Gate A–E 前 Scheduler 保持关闭。

## 7. 冻结后的产品问题

V4.0.0 没有阻塞实现的开放产品问题。未来版本候选（不是 V4 承诺）：多管理员/RBAC、更多 schedule types、SYSTEM target、Task duplication、更多通知 Provider、PostgreSQL 和多 Worker。
