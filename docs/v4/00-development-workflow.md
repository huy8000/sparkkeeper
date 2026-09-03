# SparkKeeper V4 开发工作流冻结

> 状态：FROZEN
> 适用版本：V4.0.0
> 起始基线：`develop@37903c8`
> 历史 V3 开发代码基线：`v3.0.0@69de7eb15c8cbeaa6edf888873a769be7a5ca5fa`（未实际生产部署）
> 本文定义 V4 从规划到发布的唯一默认工作流。

## 1. 权威顺序

发生冲突时按以下顺序处理：

1. 当前任务中用户的明确指令；
2. [V4 产品需求冻结](./01-product-requirements.md)；
3. 当前 Milestone 的 Implementation Specification；
4. [V4 架构与产品冻结](./02-architecture-product-freeze.md)；
5. [V4 API Draft](./03-api-draft.md) 与 [迁移计划](./04-data-migration-plan.md)；
6. 仓库既有 V3 文档与实现。

真实页面或代码事实与冻结文档冲突时，Development Agent 不得自行改设计；必须提交 blocker/deviation，由 Planning Owner 更新冻结文档或 Spec 后再继续。

Milestone Spec 只能细化、不能放宽产品需求；任意同层文档冲突都必须 `SPEC_BLOCKER`，不得以顺序为理由静默忽略安全或数据保护要求。

## 2. 角色与职责

### 2.1 Codex：Architect / Tech Lead / Planning Owner / Reviewer

负责：

- 产品技术冻结、架构、领域模型、数据库、API、安全与隐私边界；
- Milestone 依赖与 Implementation Specification；
- Development Agent 完成后的独立 review；
- 独立执行测试、lint、typecheck、build 与迁移检查；
- Review PASS 后的 commit、push、PR 与 PR 状态核验；
- Release PR、annotated tag 与发布验收，但必须另有对应任务授权。

默认不负责 Milestone 主体业务代码实现。

### 2.2 Development Agent：Implementation Owner

可以：

- 编辑 working tree；
- 新增更高版本 migration；
- 实现 backend/frontend/tests；
- 运行离线测试、lint、typecheck、build；
- 输出 implementation report。

禁止：

- 自行改变 architecture、product requirement 或 acceptance criteria；
- 修改已经执行的 migration；
- commit、push、创建/合并 PR、tag、release、deploy；
- 访问真实 Douyin、真实 Browser Profile、生产数据库或生产服务器；
- 启动真实发送，或启用 Scheduler/Manual Run/real-send gate；
- 把 deviation 当作已获授权的重新设计。

完成时只能报告 `IMPLEMENTATION_COMPLETE`，并留下未提交 working tree。

## 3. Milestone 状态机

```text
SPEC_FROZEN
  → IMPLEMENTATION_IN_PROGRESS
  → IMPLEMENTATION_COMPLETE
  → CODE_REVIEW_IN_PROGRESS
  → CODE_REVIEW_PASS
  → COMMIT_PUSH_PR
```

若 review 未通过：

```text
CODE_REVIEW_IN_PROGRESS
  → CHANGES_REQUESTED
  → DEVELOPMENT_AGENT_FIX
  → IMPLEMENTATION_COMPLETE
  → CODE_REVIEW_IN_PROGRESS
```

`CHANGES_REQUESTED` 必须按 P0/P1/P2 分类，并给出文件、行为、期望与验证方式。Agent 报告不能替代独立验证。

## 4. 分支与 PR

开发流：

```text
develop
  → feature/*
  → PR
  → develop
```

正式发布：

```text
develop
  → release PR
  → main
  → annotated tag v4.0.0
```

每个 Milestone 使用独立 feature branch。Development Agent 不执行 Git 发布动作。只有 `CODE_REVIEW_PASS` 后 Codex 才能提交。

当前规划冻结分支：`feature/v4-planning-freeze`。

## 5. Planning Files

以下文件必须保留在仓库根目录并通过 `.git/info/exclude` local-only：

- `task_plan.md`
- `findings.md`
- `progress.md`

每次开始与提交前必须执行：

```bash
git ls-files -- task_plan.md findings.md progress.md
```

预期无输出。若任一文件被 tracked，立即 STOP；不得用 `git reset --hard`、`git clean` 或删除用户文件处理。

## 6. 开发前检查

每个 Milestone 开始时：

```bash
git status --short --branch
git branch --show-current
git log --oneline --decorate -12
git diff --stat
git diff
git ls-files -- task_plan.md findings.md progress.md
```

确认：

- 起始 branch/commit 与 Spec 一致；
- working tree 无未解释改动；
- planning files 未 tracked；
- 不覆盖用户已有改动；
- Scheduler、Manual Run、real send 默认关闭。

## 7. Development Agent 交付报告

报告必须使用以下结构：

```text
IMPLEMENTATION_COMPLETE

Spec:
Branch:
Starting commit:

Files added:
Files changed:
Migrations added:

Implementation summary:
Compatibility notes:
Security notes:
Privacy notes:
Deviations: NONE | <details>
Blockers: NONE | <details>

Commands run:
- <command> — PASS/FAIL

Tests added:
- <test and behavior>

Working tree:
- git status --short

Git actions:
- commits: 0
- pushes: 0
- PRs: 0

Real Douyin access: 0
Real sends: 0
Production changes: 0
```

## 8. Codex 独立 Review Contract

每次 review 必须重新读取原始 Implementation Specification，并独立执行：

1. `git status`、`git diff --stat`、`git diff`；
2. scope 与 forbidden changes 检查；
3. migration SQL、Drizzle schema、upgrade/reopen/repeat-migrate 检查；
4. domain invariant 与 repository atomicity 检查；
5. API schema、auth、mutation guard、CSRF、rate limit 检查；
6. privacy/log/evidence/path 检查；
7. 针对风险补充或运行 tests；
8. `pnpm lint`；
9. `pnpm typecheck`；
10. `pnpm test`；
11. `pnpm build`；
12. 与 Acceptance Criteria 逐项对照。

Review 只能输出：

- `CODE_REVIEW_PASS`；或
- `CHANGES_REQUESTED`，附 P0/P1/P2 整改项。

不得仅依据 Agent report 判定 PASS。

### 8.1 实现前必须建立 Invariant / Failure / Proof Matrix

每个安全、数据完整性或不可逆边界都必须在实现前明确：

- invariant；
- failure mode；
- production guard/behavior；
- 能证明目标路径真正执行的 deterministic test/proof。

测试 PASS 不等于 proof PASS。若测试可能绕过目标分支、竞态或失败点，必须增加状态、barrier、调用次数或真实路径证据。

### 8.2 错误语义只能来自对应事实

- business failure、security failure 与 infrastructure failure 必须分类；
- 不得把任意 DB/network/driver/crypto 失败翻译成 `AUTH_FAILED`、`CONFLICT`、`FORBIDDEN` 或其他业务事实；
- error-classification test 应尽可能通过真实 HTTP/service/repository/security path。

### 8.3 时间预算覆盖完整 stack

任何 timeout/rate/session 契约必须计入 application wait、database/driver busy wait、crypto cost 与可适用的 proxy/network wait。不得宣称一个会被隐藏下层等待超过的名义 timeout。

### 8.4 Test seam 与 resource scope

- test seam 不得执行任意 production-path callback，不得改变安全决策、error classification 或 timing semantics，也不得成为 public business API；
- synchronous resource scope 必须在 TypeScript 类型层禁止 Promise/Thenable，并在 runtime 防御；
- async lease/queue/stream 必须在所有 success/failure/abort 路径可证明地释放。

### 8.5 Risk-tiered 与批量收敛 review

- VERY HIGH：real sends、target identity、delivery verification、irreversible action boundary、Scheduler idempotency；
- HIGH：authentication、sessions、CSRF、credential storage、authorization；
- NORMAL：ordinary Admin CRUD、presentation/UI 与低风险 read path。

若 review 发现 P0/P1，可停止已无意义的高成本 regression/Git delivery，但必须继续对本 Milestone 其余 scope 做合理可发现的 static inspection，一次批量返回 P0/P1。不得故意把可同轮发现的 A/B/C 拆成多轮 review。

## 9. Commit 前危险文件检查

只有 `CODE_REVIEW_PASS` 后执行：

```bash
git status --short
git diff --stat
git diff
git add -A
git diff --cached --stat
git diff --cached
```

staged 内容必须确认不包含：

- `.env`、`.env.*`（`.env.example` 的安全占位符除外）；
- `.secrets/`、VNC password、任何 secret；
- `data/`、SQLite、WAL/SHM、备份；
- `browser-profile/`、`browser-profiles/`、Cookie、Token、Session、QR；
- 真实 Account/Contact identity、聊天正文、模板真实私密内容；
- logs、screenshots、traces、Playwright artifacts；
- planning files；
- 临时 fixture、导出文件、调试 dump；
- 与当前 Milestone 无关的用户文件。

发现危险文件时必须先从 staged set 中安全移除并调查来源；不得删除用户本地数据。

## 10. Commit、Push、PR 与清理

Review PASS 后：

1. dangerous-file precheck；
2. `git add -A`；
3. staged diff review；
4. 创建单一、清晰的 Milestone commit；
5. push feature branch；
6. 创建 PR → `develop`；
7. 核验 PR base/head、commit、checks 与文件范围；
8. 未明确授权时 STOP，不 merge。

合并获授权且完成后：

1. 删除 remote feature branch；
2. checkout `develop`；
3. pull；
4. 删除 local feature branch；
5. prune。

## 11. 安全与生产边界

任何普通开发、CI、review 均不得：

- SSH production；
- 修改 `/opt/sparkkeeper`、生产 `.env`、生产数据库或 Profile；
- 访问 `douyin.com`；
- 启动真实 BrowserSession；
- 启用 Scheduler、Manual Run 或 real send；
- 发送真实消息；
- 解决 CAPTCHA、绕过风控、导出 Cookie/Token。

真实 Gate B–E 必须是独立、逐 Gate、逐账号/目标/最大消息数的明确授权任务。Gate F 前生产保持 `SCHEDULER_ENABLED=false`。

## 12. Release Gate 归属

- Gate A（No-send engineering）可在离线 CI/review 完成。
- Gate B（真实 onboarding）只允许扫码与联系人同步，不发送。
- Gate C（单 PERSON）、D（少量 PERSON）、E（单 GROUP）分别授权，不能合并授权范围。
- Gate F 只有 A–E 全部通过后才能授权首次 Scheduler。

任何 Gate 失败均回到修复与独立 review，不得降低标准或扩大真实测试范围。

## 13. V4 生产基线与 V3 兼容政策

V4 是 SparkKeeper 的第一个真实生产基线；V3 是未曾真实生产部署的开发原型。因此：

- V3 compatibility 只是 `BEST_EFFORT_ONLY`；
- 不为假设的 V3 migration 新增 compatibility bridge；
- 不为保留未使用的 V3 behavior 破坏 V4 architecture/security；
- 已接受的 legacy 结构可保留到对应 Milestone，但不扩展 Friend/Schedule compatibility，除非当前 Spec 明确要求。
