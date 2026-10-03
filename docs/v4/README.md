# SparkKeeper V4 Planning & Implementation Index

> 状态：V4-1…V4-6 MERGED；V4-7 IMPLEMENTED / SELF-REVIEWED / OFFLINE VERIFIED（待 PR 合并）
> 目标版本：V4.0.0
> 当前基线：`develop@c76cd1fdac8da6f5f1aaf0958fd01fb7c97b32fb`；V4 是第一个真实生产基线，V3 是未实际生产使用的开发原型

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
| [V4-5 Implementation Specification](./specs/v4-5-implementation-spec.md) | MERGED | preferred-only 完整唯一性解析、稳定会话打开与当前身份复核；内部接口、零发送 |
| [V4-6 Implementation Specification](./specs/v4-6-implementation-spec.md) | MERGED | 内部 witness-bound verifier、pre-action observer 与至多一次动作边界；无发送入口 |
| [V4-7 Implementation Specification](./specs/v4-7-implementation-spec.md) | OFFLINE VERIFIED / PR DELIVERY | 单目标 preview/confirm、不可变 snapshot、共同 coordinator、no-retry recovery、API/UI；live gate 关闭 |

## Change control

- 产品或架构变化必须先修改 freeze 文档，再更新受影响 Spec；
- Development Agent 发现冲突只能报告 `SPEC_BLOCKER`，不能自行改设计；
- 已实现 Milestone 的 Spec 是后续独立 review 的原始验收依据；
- planning files `task_plan.md`、`findings.md`、`progress.md` 只存在本地，不属于本目录，也不得 commit；
- V4 Release Gate 通过前 Scheduler/real send 默认关闭。
- V3 compatibility 是 `BEST_EFFORT_ONLY`；不新增 compatibility bridge，V4 architecture/security correctness 优先。

## Current phase boundary

V4-1…V4-6 已合并，不重新打开；V4-6 经 PR #46 合入当前基线。离线验收不代表真实 discovery/resolution/delivery 已验证；production DOM 证据仍保守 fail closed，avatar/streak 无可靠证据时降级为 placeholder/null。

V4-7 按本轮用户明确指令收敛为单目标，不实现 roadmap 的 batch。新增 0011 intents 与一次性 DB 边界，将 V4-5 Resolver/V4-6 Verifier 串入共同 coordinator；API/UI 提供 preview/confirm/detail。生产 factory 未接入，不提供 environment bypass；execute 在 consume 前返回 RELEASE_GATE_CLOSED。离线 factory 仅用于 intercepted loopback fixture，并要求共享 global/profile lease 与可证明 cleanup/recovery。现阶段不新增生产 worker/supervisor，不宣称已具备 live 发送能力；后续实际 DOM/受监管 worker 接入与真实发送分别需要授权。

V4-6 已按 Milestone Owner 授权实现、自审并完成受影响 workspace 离线 tests/typecheck/build；授权包括 feature branch commit/push/PR，不包括 merge/release/deploy。交付仅含内部 delivery verifier、私有 witness 绑定和至多一次 persistence/action boundary，不新增 migration/HTTP/UI/worker、Test Send 或 Scheduler，也不改 legacy sender。真实生产 message/tail/action DOM contract 未验证，production delivery adapter 在 callback/click 前 fail closed；只有受控 loopback fixture 可执行合成动作。未访问 Douyin、未真实发送、未执行 Gate B。Gate B 无发送；真实发送验证另须 Gates C/D/E 单独授权。
