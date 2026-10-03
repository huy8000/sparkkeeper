# SparkKeeper V4 Planning & Implementation Index

> 状态：V4-1 / V4-2 / V4-3 / V4-4 MERGED；V4-5 IMPLEMENTED / OFFLINE VERIFIED
> 目标版本：V4.0.0
> 当前基线：`develop@2fd237f0405d3171c1606c27b9862763baabf950`；V4 是第一个真实生产基线，V3 是未实际生产使用的开发原型

本目录是 V4 实现、验收和独立 Code Review 的规范入口。Development Agent 必须使用对应 Milestone 的 Implementation Specification；不得从摘要自行补做架构设计。

| Document                                                                 | Status       | Purpose                                                       |
| ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------- |
| [Development Workflow](./00-development-workflow.md)                     | FROZEN       | Codex/Development Agent 权限、review、Git、release gate       |
| [Product Requirements](./01-product-requirements.md)                     | FROZEN       | 用户原始 PRD 的规范化产品基线                                 |
| [Architecture & Product Freeze](./02-architecture-product-freeze.md)     | FROZEN       | domain、security、account/contact/send/runtime/IA 决策        |
| [API Draft](./03-api-draft.md)                                           | FROZEN DRAFT | V4 route、payload、guard、side effect contract                |
| [V3 → V4 Migration Plan](./04-data-migration-plan.md)                    | FROZEN       | additive schema evolution、legacy bridge、backup/verification |
| [Roadmap](./05-roadmap.md)                                               | FROZEN       | V4-1…V4-10 dependency order and release gates                 |
| [V4-1 Implementation Specification](./specs/v4-1-implementation-spec.md) | MERGED       | 已接受的 V4 domain/data foundation 与后续实现基线             |
| [V4-2 Implementation Specification](./specs/v4-2-implementation-spec.md) | MERGED       | 已接受的 Admin Authentication 与 public security baseline     |
| [V4-3 Implementation Specification](./specs/v4-3-implementation-spec.md) | MERGED       | 已接受的 Account-owned profile、onboarding 与 supervised runtime 基线 |
| [V4-4 Implementation Specification](./specs/v4-4-implementation-spec.md) | MERGED       | 已接受的 Contact Discovery、完整扫描发布与 runtime ownership 基线 |
| [V4-5 Implementation Specification](./specs/v4-5-implementation-spec.md) | IMPLEMENTED / OFFLINE VERIFIED | preferred-only 完整唯一性解析、稳定会话打开与当前身份复核；内部接口、零发送 |

## Change control

- 产品或架构变化必须先修改 freeze 文档，再更新受影响 Spec；
- Development Agent 发现冲突只能报告 `SPEC_BLOCKER`，不能自行改设计；
- 已实现 Milestone 的 Spec 是后续独立 review 的原始验收依据；
- planning files `task_plan.md`、`findings.md`、`progress.md` 只存在本地，不属于本目录，也不得 commit；
- V4 Release Gate 通过前 Scheduler/real send 默认关闭。
- V3 compatibility 是 `BEST_EFFORT_ONLY`；不新增 compatibility bridge，V4 architecture/security correctness 优先。

## Current phase boundary

V4-1…V4-4 已合并，不重新打开。V4-4 经 PR #44 合入当前基线。离线验收不代表真实 discovery 已通过 Gate B；production DOM adapter 的结束证据仍保守 fail closed，avatar/streak 无可靠证据时降级为 placeholder/null。

V4-5 已按 Milestone Owner 授权实现、自审并完成受影响 workspace 的离线 tests/typecheck/build；授权包括 feature branch commit/push/PR，不包括 merge/release/deploy。交付是只读 snapshot + 内部 typed resolver + page-bound witness；不新增 migration/HTTP/UI/browser worker，不接入 legacy send/Scheduler。生产 DOM contract 无完整性证据，仍保守 UNVERIFIABLE，不开放 conversation click；只有受控 loopback fixture 可证明 exhaustive static layout。完整性、稳定 candidate anchor 或当前聊天身份不足时不以 displayName/list position 补证。未访问 Douyin、未发送、未执行 Gate B；真实页面验证仍须另行授权。
