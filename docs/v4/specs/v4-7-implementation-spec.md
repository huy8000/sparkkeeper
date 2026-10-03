# V4-7 Implementation Specification — Single-target Test Send

> Status: MERGED / ACCEPTED (PR #47, `develop@a41562b43e9a9d7882bd9139a2c1ce57d076ba8d`)
> Baseline: `develop@c76cd1fdac8da6f5f1aaf0958fd01fb7c97b32fb` (V4-6 merged, PR #46)
> Branch: `feature/v4-7-test-send`
> Owner: Codex; explicit authorization for planning/implementation/self-review/fix/offline verification/commit/push/PR, not merge or live validation.

## 1. Scope and authority

Current user instruction narrows roadmap V4-7 to **one target**. Implement preview/confirmation, durable immutable message and identity snapshots, a common PerTargetSendCoordinator joining V4-5 and V4-6, conservative restart recovery, authenticated API and minimal UI/detail. No batch, Scheduler, retry, human resolution, release/deploy, real Douyin/profile access, private API/cookie/token extraction or real sends. Existing legacy Manual Run is not reused.

Production runtime remains unavailable and the execute API returns RELEASE_GATE_CLOSED before consuming an intent. No environment flag enables live Test Send. The trusted internal runtime port is for controlled offline integration and future separately authorized supervised worker integration, not caller-selected browser/path/identity/message. V4-6's unsupported production adapter remains fail closed. No new production Chromium process is launched in this milestone.

## 2. Preview, persistence and confirmation

POST intent takes `{templateId,contactIds:[exactly one UUID]}` and required Idempotency-Key. TTL 10 minutes. Freeze account/contact/preferred-identity metadata and template content/version in a private fingerprint; payloadDigest binds that fingerprint, intent/admin IDs and expiry. Preview exposes safe account/template/target summaries and warnings, no raw identity or final random message. It validates enabled template/message definitions and resolver eligibility without browser work. Bound unexpired intents per admin.

POST execute takes `{intentId,confirm:true,payloadDigest}` and a fresh Idempotency-Key, requiring session/CSRF/same-origin and recent reauthentication. Keys are hashed in separate preview/execute namespaces scoped to admin; replay must match the original account/intent/digest. Same key returns the canonical run even after expiry/gate closure; another key cannot consume the same intent. No force resend.

After generating one candidate from the approved stored Template, an immediate transaction rechecks all metadata/TTL/consumption/global admission and atomically consumes intent, creates TEST_SEND ExecutionRun plus exactly one READY TargetSendRecord and audit. Exact message bytes (CRLF normalized only) are persisted before any browser/composer action. No caller text. RANDOM selection occurs only for new confirmation and the winning durable snapshot is never regenerated. Additive migration 0011 creates intents and Test-Send-specific DB guards: immutable snapshots/intent fields, one active test run, boundary CAS, attempt <=1, no retry/terminal rewrites. Preserve prior tables/data and scheduled behavior.

## 3. Common coordinator and action chain

Claim a TEST_SEND READY record once using DB CAS; reject scheduled/task references. Compare persisted fingerprint/identity digest to current coherent resolver snapshot. Acquire the existing shared global/account profile lease; require the account-owned final marker. The trusted runtime owner must prove recovered ownership and cleanup. Resolve/open/reverify using TargetResolutionService on that same runtime; no name/index fallback.

V4-6 arms observer/baseline **before** a narrow adapter prepares the exact persisted message. Add an optional preparation method to the delivery port; controlled textarea assignment dispatches input only, no keypress/Enter. Unsupported live adapter fails at arm first. Recheck witness/runtime/metadata/input. Durable callback immediately before the single send control uses transaction CAS (`RUNNING`, attempt=1, boundary null, current fingerprint); acknowledgement only after commit. V4-6 handles uncertain acknowledgement as UNKNOWN and will not click. Only verified new outgoing bubble allows SUCCESS.

Persist run/record/audit in one transaction. Before boundary: FAILED. After boundary: SUCCESS or DELIVERY_UNKNOWN, never FAILED/retry. If a verifier reports UNKNOWN while DB proves boundary null, safely fail pre-action; no later action is possible after verifier disposal. Database write uncertainty blocks runtime admission rather than allowing a second attempt. No message/witness/raw browser error/evidence in logs/SSE/IPC/API result. Detail exposes IDs, statuses, attempt count, safe failure codes and timestamps, not message text or raw identity.

## 4. Ownership, interruption and recovery

Startup inventory includes unfinished test runs **and terminal runs with leftover runtime ownership**. Unknown ownership IDs fail closed; terminal truth is not rewritten after proven cleanup.

No parallel target execution. Existing global lease is shared with onboarding/discovery; repository admission rejects active login/sync, legacy runs, scheduled runs and other test runs. Reciprocal onboarding admission checks active ExecutionRuns inside its immediate transaction, not only at the HTTP/manager gate; discovery already does so. Legacy Scheduler/Manual Run/real-send flags must all be false. Acquire profile/global lease before consuming a new intent; release only after trusted runtime cleanup confirms all owned resources stopped. Cleanup failure retains ownership and blocks future starts.

Startup does not resume sends: first await runtime recovery/cleanup under the global/profile lease, then terminalize each unfinished test run transactionally. Boundary present -> DELIVERY_UNKNOWN/PROCESS_INTERRUPTED_AFTER_ACTION. Boundary absent -> FAILED/PROCESS_INTERRUPTED_BEFORE_SEND. READY/PENDING never auto-enqueued. Repeated recovery is idempotent; unrelated scheduled rows are untouched. Recovery completion gates admission. Recovery/cleanup failure holds lease and blocks startup/admission. Shutdown waits active completion/cleanup and never schedules another action.

## 5. API/UI

- `POST /api/accounts/:accountId/test-send-intents`: M + key, no browser.
- `POST /api/accounts/:accountId/test-sends`: R + explicit confirm/digest + key; 202 canonical `{runId,status}`; live gate closed by default.
- `GET /api/test-sends/:runId`: S, safe canonical single-target detail.
- Account Test Send tab: select one Contact and Template, preview exact summary/expiry, explicit one-target confirmation, one in-flight request; uncertain HTTP outcome retains key and allows only an explicit canonical lookup/replay, never an automatic resend. GET refresh is safe. Route changes invalidate pending preview/confirmation; render server text escaped.

V4-8 owns scheduled integration and broader History unification. Test detail is canonical at `/test-sends/:runId`, not confused with legacy daily Run IDs.

## 6. Focused acceptance evidence and order

Order: contract/migration -> DB aggregate/CAS/recovery -> preparation adapter -> coordinator/manager -> API -> UI -> self-review and affected-workspace verification.

| Invariant | Failure | Deterministic evidence |
| --- | --- | --- |
| Frozen message/identity | edits, random regeneration, same-ms drift | temporary DB triggers/version mismatch/replay tests |
| One intent/run/action | concurrent confirmation/coordinators | immediate transactions/unique index/CAS with invocation counters |
| Observer before preparation/action | synchronous bubble/mutation | intercepted loopback page real resolver/verifier integration |
| Conservative boundary/result | timeout/drift/crash/DB failure | before/after boundary tests, no additional click after restart |
| Ownership before release | cleanup/recovery stalls/fails | held lease barriers, shared operation conflict tests |
| Auth/privacy/gates | no session/CSRF/recent auth, caller paths/text | HTTP guards/schema/result redaction and closed-production test |

Final verify affected shared/database/automation/server/admin-web tests/typecheck/build, changed-file lint/format and diff checks. No proof matrix expansion, real-site/network validation, deployment or release. Gate B does not authorize sends; actual PERSON/GROUP delivery requires separately authorized C/E (D for future batch).

## 7. Final offline verification and limitations

- Shared: 33/33; database: 290/290; automation: 136/136; admin-web: 396/396.
- Server: 468 passed, 3 existing Linux-only skips on macOS, 0 failed (471 total); new TestSend suite: 12/12, including intercepted local-page authenticated HTTP composition.
- All five affected workspaces: typecheck/build PASS; server production/native helpers and admin-web production build PASS. Changed-file ESLint/Prettier and git diff checks PASS.
- Self-review fixes include same-key in-flight canonical admission, terminal runtime ownership recovery, reciprocal transaction-level onboarding exclusion and infrastructure-vs-eligibility error classification. P0/P1 remaining: 0 within this offline scope.
- No real Douyin/profile access or sends; no Gates B/C/D/E, batch, Scheduler, automatic retry, merge, release or deploy.
- Production Test Send runtime factory/supervised worker and live DOM adapter are not implemented or enabled; execution stays 503 before intent consumption. Separately authorized runtime integration and live Gates are required before live use.
- Minimal picker uses the existing first-page Contact list; broader pagination and unified History are not delivered. Expired intent retention/cleanup policy remains future maintenance work (V4-9); unexpired previews are capped per admin.
- Existing non-blocking P2: onboarding SupervisorContract.start() retains void typing while implementation/call are async/await; unchanged here.
