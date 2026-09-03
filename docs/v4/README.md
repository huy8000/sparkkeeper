# SparkKeeper V4 Planning & Implementation Index

> 状态：V4-1 MERGED / V4-2 READY FOR IMPLEMENTATION
> 目标版本：V4.0.0
> 当前基线：`develop@8a349ad`；V4 是第一个真实生产基线，V3 是未实际生产使用的开发原型

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
| [V4-2 Implementation Specification](./specs/v4-2-implementation-spec.md) | READY        | Admin Authentication 的 milestone authority                  |

## Change control

- 产品或架构变化必须先修改 freeze 文档，再更新受影响 Spec；
- Development Agent 发现冲突只能报告 `SPEC_BLOCKER`，不能自行改设计；
- 已实现 Milestone 的 Spec 是后续独立 review 的原始验收依据；
- planning files `task_plan.md`、`findings.md`、`progress.md` 只存在本地，不属于本目录，也不得 commit；
- V4 Release Gate 通过前 Scheduler/real send 默认关闭。
- V3 compatibility 是 `BEST_EFFORT_ONLY`；不新增 compatibility bridge，V4 architecture/security correctness 优先。

## Current phase boundary

V4-1 已合并；V4-2 Spec 已完成并可进入另行授权的 Development Agent implementation。当前 planning amendment 仍只修改文档；Runtime source、migration、production、Douyin 与 real-send changes 均为 0。
