# SparkKeeper V4 Roadmap

> 状态：FROZEN
> 版本目标：V4.0.0
> 所有 Milestone 使用独立 feature branch、Implementation Spec、Development Agent implementation、Codex independent review 与 PR → `develop`。

## 1. 顺序调整

原建议中的 Delivery Verification（V4-7）被提前到 Test Send 之前：

```text
V4-1 Foundation
→ V4-2 Admin Authentication
→ V4-3 Account Onboarding
→ V4-4 Contact Discovery
→ V4-5 Stable Target Resolver
→ V4-6 Delivery Verification
→ V4-7 Test Send
→ V4-8 SendTask / Scheduling
→ V4-9 Migration / Observability
→ V4-10 UI / Security / E2E
```

原因：Test Send 是真实发送入口，必须依赖已通过离线 regression 的 verifier；Scheduled send 又依赖 Test Send 的共同 coordinator。把 verifier 放在 Test Send 之后会迫使开发先建立一条结果不可信的发送路径。

## 2. 全局门禁

每个 Milestone 都必须：

- 从最新 `develop` 创建 feature branch；
- 只实现当前 Spec；
- 使用虚构 fixture/temporary SQLite/controlled local page；
- 不访问真实 Douyin、不发送、不触碰生产；
- 保持 `SCHEDULER_ENABLED=false`、real-send/Manual Run gate false；
- lint/typecheck/test/build PASS；
- Codex 独立 review PASS 后才 commit/push/PR；
- 未获授权不 merge。

## 3. Milestones

### V4-1 — Architecture & Data Model Foundation

Branch：`feature/v4-1-data-model-foundation`

交付：

- V4 shared domain types/validators；
- additive `0008+` migration；
- Account additive profile/Douyin metadata；
- AdminUser/AdminSession/AccountLoginSession schema + repository；
- Contact/ContactIdentity/ContactSyncRun/AvatarAsset schema + repository；
- SendTask/Target、ExecutionRun/TargetSendRecord、DeliveryResolution schema + repository；
- AuditEvent 与 legacy Friend/Schedule bridge/import；
- populated V3 upgrade tests、DatabaseClient inspection/CLI updates；
- no runtime/API/frontend behavior change。

Exit：fresh/upgrade/reopen/repeat migration PASS；零自动 Contact binding、零 enabled migrated Task、零发送能力。

### V4-2 — Admin Authentication & Public Security Baseline

Branch：`feature/v4-2-admin-authentication`

交付：

- hidden-stdin first-Admin bootstrap CLI（无 default credential/Web setup）；
- exact username/password contract 与 Argon2id hash/verify/upward-only rehash；
- DB-backed opaque sessions、idle/absolute expiry、logout、revocation/version/disabled validation；
- bounded process-memory trusted-IP/normalized-username admission + process-wide Argon2 gate；V4-1 failure/lock columns 保留但 V4-2 runtime 不使用；
- exact canonical Origin/authority/Fetch Metadata/JSON/session-bound synchronizer CSRF；
- protected Fastify REST/SSE 与 recent-auth guard foundation；
- minimal Login route/layout/bootstrap/401/logout behavior；
- auth AuditEvent、redaction 与 security regression tests；
- production cookie/application proxy-trust contract，但不改 Caddy/Nginx/生产部署。

Exit：未认证只能访问 minimal health/login；no default password/setup page；password change/session management UI 与 Caddy production rollout 保留给后续 Spec；V4-2 invariant/failure/proof 与 security tests PASS。

### V4-3 — Douyin Account Onboarding

Branch：`feature/v4-3-account-onboarding`

交付：

- AccountLoginSession manager/state machine/TTL/cancel/recovery；
- loopback-only authenticated console gateway；
- staging→account-scoped profile lifecycle/lease；
- user QR login READY detection；
- account profile extraction and automatic Account creation；
- relogin/AUTH_EXPIRED/unbind/quarantine；
- Accounts UI onboarding/relogin/status；
- controlled fixture/process tests。

Exit：No-send Gate tests；真实 Account 验证留给单独 Gate B 授权。

### V4-4 — Contact Discovery

Branch：`feature/v4-4-contact-discovery`

交付：

- normal `/chat` candidate parser；
- bounded full/partial sync、dedup/upsert/stale policy；
- PERSON/GROUP/SYSTEM/UNKNOWN classification；
- ContactIdentity observation/change state；
- hybrid avatar cache and optional streak；
- Contacts list/detail/search/filter/sync UI；
- no-private-API/no-chat-body privacy tests。

Exit：fixture contract PASS；真实 discovery 留给 Gate B；无发送 API。

### V4-5 — Stable Target Resolver

Branch：`feature/v4-5-stable-target-resolver`

交付：

- typed PersonResolver/GroupResolver；
- preferred identity only/no silent fallback；
- complete bounded uniqueness scan；
- 0/1/multiple/unavailable/changed result；
- ResolutionWitness through open/header re-verification；
- legacy displayName-only production adapter removed from V4 path；
- late-duplicate/virtual-index/type regression tests。

Exit：all resolver fixtures PASS；no MessageSender invocation in resolver tests。

### V4-6 — Delivery Verification

Branch：`feature/v4-6-delivery-verification`

交付：

- verifier baseline + pre-action MutationObserver；
- direction/exact text/new bubble proof；
- stable ID/anchor/fingerprint and virtualization reconciliation；
- irreversible action boundary callback immediately before one click；
- strict SUCCESS/DELIVERY_UNKNOWN/FAILED state machine；
- V3 real false-negative regression fixture；
- no-retry-after-boundary tests。

Exit：controlled browser tests cover history/sticker/inbound/nonmatch/remount/close/timeout；no real send。

### V4-7 — Test Send

Branch：`feature/v4-7-test-send`

交付：

- TestSendIntent preview/TTL/digest；
- explicit confirmation + Idempotency-Key；
- common PerTargetSendCoordinator；
- single/multi-target sequential batch（max 20）；
- per-target SendRecord、AUTH/global/unknown stop policy；
- Test Send UI and Run detail integration；
- fake automation integration tests。

Exit：all no-send tests PASS；真实 sends only separate Gates C/D/E。

### V4-8 — SendTask / Scheduling

Branch：`feature/v4-8-send-task-scheduling`

交付：

- Task CRUD/enable/disable/archive；
- 1..N targets、daily window/timezone/retry；
- task dispatcher + common coordinator；
- `(task,contact,businessDate)` idempotency；
- overlap warnings；
- master gate + per-task enable；
- task/account/global UI；
- restart/recovery and multi-task tests。

Exit：master gate false 时 zero claims/sends；Gate F 前不启用生产 Scheduler。

### V4-9 — Migration Completion & Observability

Branch：`feature/v4-9-migration-observability`

交付：

- explicit legacy profile binding/relogin tooling；
- Friend binding and Schedule import UI/service；
- unified legacy/V4 Run read model；
- legacy DELIVERY_UNKNOWN human resolution；
- Audit/SystemEvent/SSE/notification safe events；
- migration preflight/audit/backup/restore docs and smoke；
- privacy/redaction/retention checks。

Exit：populated V3 fixture and release migration rehearsal PASS；zero automatic legacy target binding/enabling。

### V4-10 — UI, Public Deployment Security & E2E

Branch：`feature/v4-10-ui-security-e2e`

交付：

- final IA/Chinese-default/English parity/accessibility/responsive polish；
- Caddy 80/443 reference deployment、TLS headers、trusted proxy；
- internal-only app/admin/login worker ports；
- security regression（auth/session/CSRF/rate/CSP/cookies/SSE/console）；
- no-send E2E and upgrade smoke；
- release operations/runbook/gate evidence templates。

Exit：Gate A PASS。B–F 必须由后续独立授权任务执行。

## 4. Release Gate sequence

| Gate | Environment                 |     Real Douyin |    Real send | Pass condition                                  |
| ---- | --------------------------- | --------------: | -----------: | ----------------------------------------------- |
| A    | CI/controlled local         |               0 |            0 | engineering/security/migration/privacy all PASS |
| B    | authorized real Account     | onboarding/sync |            0 | Account/Profile/Contacts correct                |
| C    | authorized PERSON           |             yes |        max 1 | automatic SUCCESS, no human assist              |
| D    | small authorized PERSON set |             yes | explicit max | sequential, per-target, no duplicate/overreach  |
| E    | separately authorized GROUP |             yes |        max 1 | stable group identity + automatic SUCCESS       |
| F    | production-like small scope |             yes | explicit max | Scheduler only after A–E, then gradual rollout  |

任何 unknown、误匹配、重复、越权或不可解释 verifier 结果使当前 Gate FAIL；不得扩大样本“碰运气”。

## 5. Release workflow

所有 V4 Milestone PR 合入 develop 且 A–E evidence 通过后：

1. freeze release candidate；
2. full backup/migration rehearsal；
3. `develop → release PR → main`；
4. main checks + version verification；
5. annotated tag `v4.0.0`；
6. production upgrade with Scheduler false；
7. read-only health/migration/account checks；
8. only Gate F explicit authorization may change Scheduler master gate。
