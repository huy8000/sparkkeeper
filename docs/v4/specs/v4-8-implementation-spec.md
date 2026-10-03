# V4-8 Implementation Specification — SendTask / Scheduling

> Status: IMPLEMENTED / SELF-REVIEWED / OFFLINE VERIFIED; PR delivery, not merged
> Baseline: `develop@a41562b43e9a9d7882bd9139a2c1ce57d076ba8d` (V4-7 merged, PR #47)
> Branch: `feature/v4-8-send-task-scheduling`
> Authority: explicit Milestone Owner planning/implementation/self-review/offline verification/commit/push/PR; no merge, live Gates or deployment.

## Scope / gates

Implement Task configuration/enable/disable/archive, safe list/detail and overlap warnings; daily-window dispatcher, immutable scheduled run/task/target/message snapshots, record claim/action CAS, sequential execution through V4-5/V4-6/V4-7, bounded pre-action recovery retry, audited status and minimal global/account Task UI. V4 legacy Schedule/Manual Run are not execution inputs. No unbind/migration bridge/human resolution/batch Test Send, real-site access, Gates C/D/E/F, release/deploy.

Production master/execution gate stays hard closed. Configuration creates disabled Tasks; production enable rejects before mutation. No environment variable opens V4 execution. Trusted internal CONTROLLED_LOCAL runtime/master/release ports may exercise complete offline dispatch. Gate false means zero materialization/claims/browser starts; cleanup recovery is still required before admission. Default service must not fall through to legacy production Scheduler, even with legacy send environment flags.

## Configuration / API

- Task belongs to one Account/Template, 1..100 distinct PERSON/GROUP Contacts of that Account; DAILY_WINDOW strict same-day `[start,end)`, IANA timezone, maxAttempts 1..5, retryIntervalSeconds 1..86400.
- POST creates disabled Task + targets + audit transactionally. PATCH uses expectedUpdatedAt, only disabled/not archived/no active Run, atomically replaces complete configuration and targets. No hard delete.
- Enable requires recent authentication + acknowledgeOverlaps=true, current version, current profile marker/Account/Auth/Template/preferred stable identities and release gate. Disable blocks future claims/boundaries; an already recorded action finishes conservatively. Archive requires disabled/no active Run and confirmationText=`ARCHIVE` + recent auth. Version timestamps increase even within the same millisecond.
- Overlap warnings identify enabled same-Account Tasks sharing targets; timezone/window differences are conservatively warned, not used to suppress explicit independent task intents.
- Auth S: GET /tasks (bounded offset/accountId/enabled), GET /tasks/:taskId, GET /scheduled-runs/:runId. Auth M: POST /tasks, PATCH /tasks/:taskId, POST disable. Auth R + explicit confirmation: POST enable/archive. Strict schemas; IDs/references only, never message/identity/profile paths.
- Read DTOs expose configuration, IDs, derived BLOCKED/DISABLED/ENABLED/ARCHIVED, safe overlap IDs and machine records without plaintext message/raw identity. Minimal UI lists global/account Tasks, creates/edits full disabled configuration and exposes explicit enable/archive confirmations, disable and read-only scheduled results. Production closed gate is visible; no Run Now/retry UI.

## Immutable publication / scheduling

Additive 0012 creates managed scheduled-run snapshots. Preserve existing foundation/legacy histories; do not mutate prior migrations. Snapshot includes fixed Task configuration/ordered targets, template version/content fingerprint, each resolver metadata/identity fingerprint and selected message. Persist all target records and audit in one immediate transaction, after rechecking prepared configuration/eligibility under writer lock. Message selection is before browser work; canonical publication never regenerates persisted messages.

Run key=`scheduled:<taskId>:<businessDate>`; record unique `(taskId,contactId,businessDate)`. Local Gregorian businessDate and wall-clock window use Task timezone. DST repeated hours cannot duplicate a day; nonexistent times are not shifted. No missed-day catch-up. Dispatcher serializes ticks and chooses existing managed active run before a new due Task. Durable unique active slot + existing reciprocal onboarding/discovery/Test Send checks provide global admission, including independent DB connections.

Snapshot/record immutable columns and terminal machine truth are protected by triggers. Scheduled runtime uses the same account-owned marker/global lease and trusted cleanup contract as Test Send. All target resolution/preparation/action consumes only persisted references; current stable identity/metadata revalidated before claim/boundary/result. Extend PerTargetSendCoordinator with a narrow structural persistence port, preserving V4-7 behavior. No displayName/index evidence.

## Lifecycle / recovery

Record: READY -> RUNNING (attempt increment CAS, only one RUNNING record per Run) -> SUCCESS / FAILED / DELIVERY_UNKNOWN. Boundary is null -> committed timestamp once; any possible boundary/action means UNKNOWN on uncertainty, never retry/FAILED. SUCCESS only comes from new outgoing bubble proof through current witness/runtime. Target-local pre-action failures allow other targets; AUTH/global runtime failure or UNKNOWN stops remaining targets as SKIPPED/BATCH_ABORTED. Explicit AUTH_EXPIRED updates Account in the result transaction without disabling Task or auto-restoring READY; derived Task becomes BLOCKED. Post-boundary auth expiry remains immutable UNKNOWN at record level. Terminal Run aggregate AUTH_EXPIRED > UNKNOWN > PARTIAL_FAILED/FAILED > SUCCESS; while untouched/running records remain, Run stays active until terminalization.

Only restart recovery with proven stopped runtime and durable null boundary permits RUNNING -> RETRY_WAIT (PROCESS_INTERRUPTED_BEFORE_SEND), same snapshot/date/window, below maxAttempts. Normal untyped exceptions/selector failures do not manufacture transient proof or retry. No retries after boundary, of terminal UNKNOWN, or outside the window. RETRY_WAIT claim requires due timestamp, same window/current metadata and bounded attempts. Window expiration marks unfinished pre-action rows failed/skipped; no future day resumes them.

Startup inventories unfinished managed runs plus terminal leftover runtime ownership; unknown ownership fails closed. The durable global slot/owner remains held after machine terminalization until proven close/recovery; independent DB admission for scheduling, Test Send, onboarding and discovery also rejects that slot. Terminal owned rows are included in startup inventory even if the factory reports no inventory. Acquire lease and await trusted recovery cleanup before reconciling records; no replacement browser/action during recovery. Boundary-present RUNNING -> UNKNOWN; untouched READY may continue only after recovery and an open offline master gate. Recovery failure preserves ownership/lease and blocks admission; unavailable factory with active or terminal-owned history fails closed. Close verifies all resources/late launches stopped before release. Disable/master close/shutdown abort future claims, finish in-flight boundary conservatively and await cleanup. Persistence uncertainty retains lease/admission block.

## Verification / order

Contract + 0012 -> Task/Run aggregates + DB CAS/trigger/recovery -> common persistence port -> controlled scheduler manager and lifecycle wiring -> authenticated API -> minimal UI -> self-review/fixes -> affected tests/typecheck/build/lint/diff -> commit/push/PR.

Prioritize populated upgrade/reopen, versioned config/overlap/account isolation, independent DB claims/idempotency, timezones/DST/end-exclusive window, immutable RANDOM replay, UNKNOWN stop/no retry, pre-action restart bounded retry, held cleanup ownership and real intercepted local DOM Resolver/Verifier integration. API auth/CSRF/recent-auth and closed-production zero claims remain proof boundaries. No broad proof matrix or live validation. Production worker/live DOM integration remains unavailable from V4-7 and requires separate authorization; offline success does not authorize real execution.

## Implementation notes / limitations

- `scheduled_run_snapshots` is private persistence: immutable configuration/fingerprints with a global active slot and durable owner token. Existing unmanaged scheduled foundation/legacy rows are preserved, not imported/enabled/resumed. Default runtime cannot launch or recover a live scheduler; active history without a reliable factory blocks startup and retains ownership.
- Common PerTargetPersistence binds a scheduled record ID or V4-7 run ID to the same actual Resolver -> observer -> persisted exact input -> boundary -> one action -> outgoing evidence chain. Typed account/global failures are preserved, including failures inside delivery witness revalidation, not guessed from exceptions. Runtime factory close/recover must prove all resources/late launches stopped; deadlines retain leases on uncertainty.
- Current automatic retries are only proven null-boundary crash recovery. Untyped runtime/network errors or unavailable transient proof ports are terminal conservative failures, not inferred retry authorization. The frozen retry categories remain policy, not justification to manufacture proof.
- Existing audit vocabulary is retained: runtime transitions use TASK_UPDATED with EXECUTION_RUN/TARGET_SEND_RECORD and bounded SCHEDULED_* reason codes; no new audit enum/table rebuild. DB writes and terminal aggregate/audit are transactional; UI/API only show safe references/status.
- Minimal UI shows the first 50 Tasks and first 200 eligible Contacts; dispatcher reads enabled Tasks in bounded pages of 100, without silently starving later pages behind completed/blocked Tasks. No automatic HTTP mutation retry, no Run Now, no human resolution, no legacy/V4 unified History, no retention tooling; later UI/observability work owns those additions.
- Live worker/production DOM evidence contract is still unavailable/hard closed. No real Douyin access, login, profile use, sending or Gates B–F occurred. Separately authorized live runtime integration/validation and send gates are required before production activation. Inherited non-blocking P2: SupervisorContract.start() is still typed void although the production implementation/callers await it.

## Final offline verification — 2026-10-03

- Shared 33/33; database 297/297; automation 136/136; server 476 PASS / 0 FAIL / 3 existing Linux-only fixture skips on macOS (479 total); admin-web 399/399. All are complete affected-workspace suites, not a new proof matrix.
- Shared/database/automation/server/admin-web typecheck PASS. Shared/database/automation builds and server/admin-web production builds PASS; server native helper build PASS. Drizzle generate reports no schema changes after 0012; upgrade/fresh/reopen/data preservation/DB guard tests PASS.
- Focused scheduling exercises actual intercepted loopback DOM through Resolver/Verifier: same-day canonical replay, sequential independent Tasks, bounded paging, DB ownership/claim/action CAS, immutable selected messages, UNKNOWN/global stop, pre/post-boundary auth loss, held cleanup and restart including terminal-owned leftovers, bounded original-snapshot recovery retry, closed-production/auth/CSRF/recent-auth API and minimal UI.
- Changed-file ESLint/Prettier and git diff --check PASS. No credential-shaped secret, real account/browser data, profile/runtime artifacts or generated build output in the delivery diff. Self-review P0=0/P1=0; inherited P2 recorded above. Live Gates remain unexecuted; no real Douyin or real-send claim is made.
