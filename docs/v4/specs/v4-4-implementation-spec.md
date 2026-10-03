# V4-4 Implementation Specification — Contact Discovery

> Status: IMPLEMENTED / PENDING INDEPENDENT REVIEW (uncommitted)
> Spec owner / reviewer: Codex
> Implementer: Codex, separately authorized implementation on the required branch
> Baseline: `develop@e5a3e925c0a6b2436a68679d0ca44d804c2e5a2f`
> Required implementation branch: `feature/v4-4-contact-discovery`
> Accepted dependencies: V4-1 / V4-2 / V4-3; do not reopen them

## 1. Objective and scope

An authenticated Admin can manually discover the **conversation directory exposed by an already logged-in Account's normal `/chat` page**, persist account-scoped Contacts/Identities, inspect a bounded sync result and browse/search/filter Contacts. This is not a claim to enumerate every social friend/follow relationship: a person absent from the exposed directory is outside discovery coverage.

Included:

- Account-owned final profile, shared global browser admission and a supervised, headless discovery worker;
- versioned, read-only directory DOM parsing; PERSON/GROUP/SYSTEM/UNKNOWN classification;
- bounded full/partial scanning, run-local deduplication and transactional Contact/Identity upsert;
- identity change/conflict visibility, complete-scan-only stale policy;
- durable start idempotency, terminal status, restart cleanup and explicit retry from the top;
- opportunistic hybrid avatar cache from normally loaded image responses and optional streak metadata;
- authenticated start/status/list/detail/avatar APIs and a minimal Contacts UI;
- focused offline parser, aggregate, ownership/recovery and security tests.

Excluded:

- Target Resolver, opening/selecting a conversation, composer access, sends, Delivery Verification, Scheduler;
- Friend migration/binding, manual Contact CRUD, preferred-identity mutation or automatic identity rebinding;
- sync cancel API, scheduled/background sync, auto retry, multi-instance execution, resumable website cursor;
- account auth-check/unbind API, authentication redesign, console/noVNC for discovery;
- private Douyin HTTP APIs, request replay/signatures, cookie/token/storage inspection or export;
- full response/DOM/chat dumps, screenshots/HAR/trace capture, CAPTCHA/risk-control bypass;
- real Douyin/browser access during implementation, tests or review; production/deployment/Git delivery.

Real discovery is a separately authorized no-send Gate B. No existing gate is enabled by this milestone. Planning creates documentation only.

## 2. Current implementation and reuse decisions

| Existing foundation | V4-4 decision |
| --- | --- |
| V4-1 Contact / ContactIdentity / ContactSyncRun / AvatarAsset tables and repositories | Reuse domain and constraints; add a transactional discovery aggregate, not a sequence of public CRUD calls. |
| ACTIVE stable identity account/kind/value uniqueness; one preferred/contact | Preserve. Names and virtual-list positions are never merge keys. |
| `AccountProfileStore` final marker and native dirfd operations | Reuse final Account ownership validation; no staging, rename, profile clone or caller-supplied path. |
| `BrowserOperationCoordinator` currently owned by onboarding manager | Construct once in `ApiApplication` and inject into both managers. Preserve onboarding's behavior. |
| `BrowserSession`, native `chromium-launcher`, `BrowserProcessIdentity` and supervisor cleanup | Reuse launch/process-ownership primitives. A small shared cleanup primitive is permitted only where required to avoid duplicating V4-3's corrected recovery semantics. |
| `AuthDetector` / `DouyinAccountIdentityExtractor` (`douyin/AccountOnboardingDetector.ts`) | Reuse auth signals/public self-identity extraction with an explicit self-profile scope; no browser credential extraction. |
| `selectors.ts`, `DouyinChatPage` list navigation/scroll mechanics | Reuse centralized selector organization and bounded list mechanics, not old readiness/complete assumptions. |
| `ContactResolver`, `ConversationCandidate`, `contact-smoke.ts` | Do not use: displayName/listIndex matching, early return and scroll-bottom heuristics are not discovery identity/completeness. The smoke opens a conversation. |
| `ProductionDailyTaskAutomation`, `MessageSender`, legacy Friend CRUD | Not in the new flow. No changes to sender/Scheduler algorithms or compatibility bridge. |
| AdminSession/CSRF middleware, API envelopes, Vue request/error/poll patterns | Reuse; never bypass auth for assets or replace the existing auth controller. |

At the baseline there is no account-scoped discovery runtime, stable Contact candidate parser, reliable full-scan evidence, transactional sync admission/completion or Contact API/UI. Existing selectors expose list/title/auth signals, not verified stable-ID/type/end-of-directory extraction. This spec does not invent live Douyin attributes or claim the current page contract is validated.

## 3. Architecture and data flow

```text
Admin + CSRF + Idempotency-Key
  → ContactDiscoveryManager
  → atomic admission: Account checks + cross-operation exclusion + PENDING run + Audit
  → shared global/account lease + owned final profile validation
  → supervised discovery worker → BrowserSession → normal /chat
  → auth + same-Account self-identity + versioned directory readiness
  → bounded typed observations, streamed as validated private IPC chunks
  → stop worker; confirm worker group AND detached Chromium group exited
  → one DB transaction: CAS active run + dedup/upsert + optional stale + terminal/Audit
  → release lease; safe status/counts; authenticated Contact/Avatar reads
```

Automation owns selectors/Locator/page interpretation. The worker has no DB or Admin credentials. The manager owns deadlines, leases, bounded IPC observations and safe outcome mapping. `ContactDiscoveryRepository` owns serialized admission, matching, terminal CAS and atomic publication. Routes contain no selectors or transaction logic.

Application/HTTP never accept profile path, avatar URL, raw identity, page cursor, selector, browser executable or arbitrary worker arguments. Only server-resolved `accountId` and generated `syncRunId` reach trusted runtime configuration. Do not use legacy global `BROWSER_PROFILE_DIR` resolution.

## 4. Migration 0010 and persistence contract

Use one forward-only migration after 0009; old migrations and old data remain unchanged. Generated SQL/snapshot/journal follow repository conventions.

Required additions:

- `contacts.first_missing_at`: nullable timestamp, paired with `missed_full_sync_count` (`0 ⇔ NULL`, positive requires a timestamp). For pre-existing positive counts, backfill to migration time, not guessed historical time; this conservatively restarts the 24-hour window.
- `contact_sync_runs.idempotency_key_digest`: nullable for legacy rows; runtime starts require a digest. Unique `(requested_by_admin_user_id, idempotency_key_digest)` where non-null, in the sync endpoint namespace.
- Global unique active-sync partial index on a constant expression where status is PENDING/RUNNING. It is not per Account.
- Extend the ContactSync failure-code allowlist with `DISCOVERY_STALLED` and `PROCESS_INTERRUPTED`.
- Keep candidate/created/updated/issue counts bounded 0..500. Stale/unavailable counts remain nonnegative but remove their 500 upper bounds: the historical directory can exceed a single run's candidate budget.
- Add/check an Account-scoped contact ordering index `(account_id, created_at, id)` for deterministic cursor traversal.

SQLite CHECK changes may require a controlled table rebuild. Preserve every ContactSyncRun ID, FK relationship (`contacts.last_full_sync_id`), count, timestamp, terminal result, existing index and trigger. Validate fresh/0009 upgrade/reopen/repeat migration plus FK integrity. If dirty historical data violates the new active-sync invariant, fail migration with a safe diagnostic; do not silently delete/terminalize rows.

Do not add observation/checkpoint tables, website continuation tokens, execution/send records or a new Contact type/status. In-memory observations are deliberately not resumable. Existing aggregate helpers must also preserve the new missing-time invariant; no production source is changed during planning.

### 4.1 Admission and idempotency

- Require the same V4-3 Idempotency-Key validation (1..128 printable ASCII, SHA-256 digest only). Namespace by sync endpoint and Admin. Canonical request is `{accountId}`; same key/different Account → 409 IDEMPOTENCY_CONFLICT.
- Check replay first after the M guard: return the canonical run without acquiring a new lease or restarting a terminal run. A retry is a new explicit action/key. No automatic POST retries.
- In `BEGIN IMMEDIATE`, recheck Account ACTIVE, login READY, profile READY and no PROVISIONING; reject active login sessions (including READY_DETECTED/COMPLETING), other active syncs and active legacy/V4 execution ownership, then insert PENDING and CONTACT_SYNC_STARTED Audit atomically.
- Login admission must reciprocally check PENDING/RUNNING syncs in its own serialized transaction; one shared in-memory coordinator alone is insufficient. Preserve login idempotency and READY/cancel semantics.
- Startup recovery must complete before admitting requests. Scheduler/Manual Run/real-send gates must all be disabled, `RunExecutionCoordinator.isBusy` false, and no durable active execution. Fail closed on uncertainty; do not enable or refactor execution engines.
- Hold the shared lease from profile validation through confirmed teardown and publication. PENDING reserves admission; no queue. Profile/runtime validation failure finalizes the run without launching Chromium.
- Existing deployment remains a single server/runtime owner. A second server process sharing the same DB/data root is unsupported and must be blocked operationally, not presented as distributed locking.

### 4.2 Run state machine

```text
PENDING → RUNNING → COMPLETE | PARTIAL | FAILED | AUTH_EXPIRED
PENDING → FAILED                 (pre-launch failure / startup interruption)
```

The manager CASes PENDING→RUNNING immediately before starting the supervisor, after acquiring/validating ownership. The collector proposes an outcome; only repository CAS publishes it. All terminal states are immutable, and there is no PARTIAL→RUNNING resume. Runtime phases (launching/scanning/stopping/publishing/cleanup-blocked) remain internal, not new DB statuses. On shutdown or timeout, discard late IPC; process teardown still precedes successful publication and release.

## 5. Automation contract and scanning

### 5.1 Source and readiness

V4-4 implements DOM-only directory discovery. PAGE_DATA/RESPONSE_PARSER are existing domain values, not authorization to add data scraping. Any future adapter requires a separately reviewed, field-allowlisted contract; no generic response listener for JSON bodies is included.

A versioned `DouyinContactDirectory` adapter owns list/container/title/type/identity/loading/end/empty/streak/avatar selectors and fixtures. A recognized layout must expose stable identity in ordinary visible DOM attributes or public profile links. Parse only named allowlisted fields; public profile links are parsed locally, never navigated/fetched. Fixture-only test IDs must not masquerade as real supported selectors.

Use the existing auth detector without reading message bodies. Discovery readiness requires the recognized directory, not a selected conversation/message pane/composer. A recognized empty-directory state can succeed; unknown layout, loading error or missing directory cannot be treated as empty.

Before collecting, compare ordinary public self-identity against the Account bound to the marker. Unknown/unavailable/mismatched self-identity → fail closed (`AUTH_UNKNOWN`, Account login UNKNOWN); do not relabel the Account or discover into it. Explicit login-expiry evidence → AUTH_EXPIRED and Account login AUTH_EXPIRED. Update `lastAuthCheckAt` for an actual check only; do not set `lastLoginAt` or revive an expired Account.

Require a uniquely recognized own-account profile/header scope before reusing the extractor; its page-wide fallback is not sufficient to prove self-identity on a contact directory. If the stored Account has SEC_UID, require that exact observed value; otherwise require its stored UNIQUE_ID. No displayName/SHORT_ID fallback. Missing self scope is UNKNOWN, not the first visible Contact's identity. Safe auth result codes are reused; raw detector reasons/URLs/causes are not forwarded to IPC or logs.

### 5.2 Candidate DTO

Internal observation: type, displayName, optional remarkName; up to one value per stable kind; optional avatar reference and reliably observed streak; observation timestamp and adapter version. No message preview, unread-message text, chat body, phone number, auth token, DOM dump or raw error is allowed.

- PERSON: displayName + at least one SEC_UID/UNIQUE_ID/SHORT_ID.
- GROUP: displayName + CONVERSATION_ID.
- SYSTEM: explicit page type + page-provided stable conversation identity.
- UNKNOWN: no reliable type but a page-provided stable identity. It is not upgraded by guessing from its name/avatar.
- Missing stable identity/name, conflicting same-kind fields or unrecognized type evidence: issue, not a guessed Contact. SYSTEM/UNKNOWN never have preferred identity or identity READY.

Opaque stable values use exact case-preserving trim normalization, consistent with V4-1; no lowercasing, numeric coercion or cross-kind comparison. Numeric DOM strings retain leading zeroes. Reject control characters/oversized inputs; names ≤200 Unicode code points, stable values ≤512, remote avatar reference ≤2048, no truncation that could change an identity. DISPLAY_NAME/REMARK_NAME observations are mutable metadata/history, never match keys.

### 5.3 Bounds and completion evidence

- Overall normal-operation deadline 120 seconds; allocate at most 90 seconds to launch/readiness/scanning, 20 to bounded teardown and 10 to publication. All page waits/scrolls/image work consume the remaining budget, not fresh nested timeouts. Unresolved cleanup may retain ownership beyond the deadline but cannot publish success or permit replacement.
- Process at most 500 candidate observations (duplicates consume work budget), at most 50 scroll windows. IPC ≤16 KiB/message, batches ≤10 observations, acknowledged backpressure; manager independently bounds total count/bytes and rejects malformed/unordered/extra messages. A large result is not one unbounded IPC message.
- Begin at directory top; collect each rendered window then advance with overlap, waiting for bounded loading settlement. Virtual index/DOM position may guide traversal only, never identify a Contact or persist a resume cursor.
- COMPLETE requires authenticated same-Account readiness throughout, recognized end-of-directory or explicitly recognized empty state, contiguous traversal from top, settled loading and no identity/parser/coverage ambiguity. Scroll-bottom, unchanged scrollHeight or two no-progress polls alone are insufficient.
- Re-read a bounded top/end boundary signature before declaring complete; observable directory mutation/reorder/gaps → PARTIAL. This is a conservative page observation, not a server-side snapshot guarantee.
- Budget/count/window cap → PARTIAL (DISCOVERY_TIMEOUT/CANDIDATE_LIMIT_REACHED as appropriate); stalled traversal → PARTIAL DISCOVERY_STALLED; trustworthy partial rows plus parser issues → PARTIAL PARSER_CONTRACT_FAILURE.
- Unknown parser contract without trustworthy observations → FAILED PARSER_CONTRACT_FAILURE. Browser/protocol/ownership failure → FAILED BROWSER_FAILURE. Explicit auth expiry → AUTH_EXPIRED. Partial results must come from an explicit bounded collector result, never reconstructed from a thrown browser error.
- A directory exceeding the limits remains PARTIAL; repeated top-first runs are **not** promised to exhaust its tail. No full-scan flag or stale inference is allowed to compensate. Increasing scope/limits or resumable discovery requires a future spec.

## 6. Deduplication, identity changes and publication

Collect ≤500 observations, build account-scoped components using intersections of ACTIVE stable `(kind, normalizedValue)` keys, and evaluate the entire run before writing. Do not insert one row at a time and decide preferred before later duplicate/conflict observations arrive.

Within a component, compatible repeated observations merge. Conflicting type or same-kind identity claims quarantine the component as an issue; do not choose the first/last identity. Reliable metadata may use the latest observation only after identity consistency is established. Existing Contacts implicated by a conflict become AMBIGUOUS; no new resolvable Contact or preferred change is made for that component.

In one DB transaction, after worker teardown:

1. CAS PENDING/RUNNING to the selected terminal result; recheck Account binding/state and run ownership. A terminal run cannot apply again. Missing/unsafe Account state → FAILED with no candidate application.
2. For each consistent component, match all stable keys to Account-scoped ACTIVE identities: zero existing Contacts → create; exactly one → update; multiple → mark those Contacts AMBIGUOUS, count an issue and skip identity/metadata merge. Never merge/reassign Contact IDs automatically.
3. New PERSON chooses SEC_UID → UNIQUE_ID → SHORT_ID from this component only; new GROUP chooses CONVERSATION_ID. Insert Contact + all observations + preferred atomically. New SYSTEM/UNKNOWN remain identity UNAVAILABLE without preferred.
4. Existing Contact type mismatch → AMBIGUOUS, not conversion. Otherwise touch observed identities and metadata, add reliable new identities without switching preferred. If preferred is not observed but another stable key matches, latch CHANGED. Neither CHANGED nor AMBIGUOUS is cleared automatically by later discovery; manual resolution belongs to a later milestone.
5. Stable identities are not automatically superseded/deleted for absence. Preserve history and never revive SUPERSEDED identities as match keys; a value colliding with superseded history is a quarantined issue pending review, not a silent reassignment. Mutable name history may be superseded transactionally without changing preferred.
6. Reliable rediscovery sets availability AVAILABLE, lastSeenAt to this observation, missed count 0 and firstMissingAt NULL. It does not clear identity risk. Apply stale rules only when the final outcome remains COMPLETE with zero issues.
7. Set run counts/isComplete/failure/finishedAt, Account.lastContactSyncAt for published COMPLETE/PARTIAL and CONTACT_SYNC_FINISHED Audit in the same transaction. created/updated count consistent upserts only, each Contact at most once; Contacts marked AMBIGUOUS by a quarantined component are represented by issueCount, not updatedCount. Issues count quarantined/unpersistable components/observations once, ≤500. candidateCount is the number of deduplicated components plus unkeyed issues, ≤processed observations. Run-only diagnostics never contain values.

COMPLETE/PARTIAL publish safe observations. FAILED/AUTH_EXPIRED publish no candidate metadata or stale changes; AUTH_EXPIRED updates Account auth status with the terminal run. Any persistence exception rolls back the whole publication; then separately CAS active run to FAILED PERSISTENCE_FAILURE. If that fails, retain durable active admission for recovery, not a fabricated success.

Identity graph conflicts discovered against DB can downgrade a collector's COMPLETE to PARTIAL. Stale calculation always follows the final persistence decision, never the collector's optimistic flag. Stable uniqueness violations roll back rather than catching/continuing individual writes.

### 6.1 Stale/invalid policy

- COMPLETE unseen: increment once for this run; first missing records `firstMissingAt=finishedAt`; availability STALE.
- At least three consecutive COMPLETE misses **and** `finishedAt - firstMissingAt ≥24h`: UNAVAILABLE. Do not infer the interval from lastSeenAt or run start.
- PARTIAL/FAILED/AUTH_EXPIRED unseen: leave availability/miss count/missing timestamp unchanged. Reliable rows of PARTIAL can reset their own miss state.
- COMPLETE observed: AVAILABLE, reset count/time, set lastFullSyncId. Unseen Contacts also record the complete run that applied their miss; terminal replay cannot double-count.
- Never hard-delete Contact/Identity; unavailable != identity superseded. No notification/send/task side effects.

## 7. Runtime ownership, shutdown and restart

The discovery worker uses headless Chromium with the Account's final persistent profile. No Xvfb/Openbox/x11vnc/websockify/display reservation or console is launched for sync. The existing login console remains unchanged and login/relogin exclude sync globally.

Supervision must own the detached worker PGID **and** native launcher's separately detached Chromium PID/PGID. Track launch-start/identity/launch-abort explicitly; `browser.close()` has a deadline shorter than supervisor grace, then TERM/KILL both owned groups. Worker exit/close Promise resolution is not proof that Chromium descendants exited.

Persist trusted operation ownership for restart: existing Chromium identity plus a bounded worker-group ownership record under server-managed private runtime storage. Writes must be exclusive/non-symlink and bound to generated run ID. Before signalling a live persisted group, validate ownership and guard PID reuse (Linux process-start identity or an equally reliable supported mechanism). Missing evidence while a live group may exist is unresolved ownership, not permission to launch. Unsupported mechanisms/platforms fail closed; do not broaden platform claims based on fake process fixtures.

The minimum production target is Linux Docker. Discovery ownership records include run ID, group leader PID/PGID, `/proc` process-start ticks and kernel boot identity; validate the same boot/start/group before signalling. Register the worker record before sending its launch command; the native Chromium launcher publishes its discovery ownership proof before exec, so a crash before IPC receipt is recoverable. A legacy PID/PGID-only record without reliable discovery ownership proof remains blocked, not discarded. Preserve onboarding's existing record/protocol behavior; optional discovery-only ownership support must be backwards-compatible. Non-Linux discovery is unsupported unless an equally strong mechanism and real recovery fixture are delivered; ordinary development/typecheck does not require launching the worker.

Startup, **before HTTP admission or onboarding recovery can launch a browser**:

1. Keep a startup admission barrier closed and inventory persisted discovery ownership for active and terminal runs. Validate all relevant ownership before any replacement spawn. The barrier is not a second coordinator lease that would deadlock onboarding recovery.
2. Adopt/terminate verifiable old worker/Chromium groups; wait for both groups to be absent. Only then delete process identities and release profile ownership. An invalid identity, surviving group, permission error or unassociated runtime record blocks startup/admission; preserve records and lease. Never erase evidence to make recovery pass.
3. CAS remaining PENDING/RUNNING syncs to FAILED PROCESS_INTERRUPTED with no observations/stale changes. Terminal COMPLETE/PARTIAL stays immutable; cleanup only. A DB commit surviving restart is already published and must not be replayed.
4. Complete onboarding recovery, allowing its manager to acquire the shared coordinator normally while the admission barrier stays closed; await every recovery step, then allow requests. Sync recovery never visits Douyin or resumes a page.

Crash cases: before admission → no run; after admission/before launch → interrupt; during scan → interrupt; after teardown/before DB commit → interrupt; during transaction → rollback or full atomic commit; after commit/before release → preserve terminal result and clean residual ownership. Graceful shutdown similarly stops/awaits owned processes before release; uncommitted runs become interrupted or remain active for startup if DB unavailable.

The same-process re-entry barrier remains held if cleanup fails even when a FAILED terminal status can be persisted. Restart must inspect terminal ownership too, so terminalizing cannot open a path to replacement Chromium. There is no profile rename or V4-3 transaction-A/B completion in this flow.

## 8. Avatar and streak: bounded, nonessential metadata

- Avatar capture observes only image responses already loaded by the normal directory page and associated with recognized row image references. No extra request, remote redirect, cookie/header replay, arbitrary URL fetch, navigation to profile/image or JSON response parsing.
- Only JPEG/PNG/WebP/GIF, matching MIME and magic bytes; no SVG/HTML. Require a bounded declared response length before reading, reject actual bytes above 5 MiB; enforce ≤10 MiB retained bytes/run, bounded attempts and the discovery deadline. If the runtime cannot reliably cap byte acquisition, skip capture rather than add an unbounded body-read fallback. Failure/oversize/budget exhaustion → placeholder, not a failed identity sync. IPC uses bounded chunks with an independent manager byte cap; never emit an unbounded binary/base64 result.
- Cache bytes under server-owned `<DATA_DIR>/avatars/` with generated account/digest keys, directory 0700/files 0600. A small AvatarCacheStore must use anchored non-symlink directory/file operations (dirfd/O_NOFOLLOW; exclusive no-replace publication), not `realpath-check → full-path write`. Extend a native primitive only as needed; no generic filesystem cleanup API.
- Write valid bytes atomically before publishing AvatarAsset/Contact FK in the sync transaction. A failed/crashed transaction can leave an unreferenced immutable cache file, never a required missing Contact dependency. Missing/corrupt assets render placeholders. Startup/post-sync bounded orphan/expiry cleanup removes only verified managed bytes; no scheduled service or broad recursive deletion. Grace-period orphan cleanup must exclude active run ownership.
- Store validated normal-page remote reference internally only; HTTP DTOs/SSE/logs never expose it. Cached asset IDs/bytes are Account-associated, not cross-account remote redirects.
- Default unseen/unbound retention 30 days; touch references only on reliable observation, not GET requests. Expiry derives from last reliable reference. Keep DB metadata if bytes are expired; do not delete rows still referenced by Contacts. Empty/unsupported capture is acceptable offline; do not synthesize avatar values.
- Streak is explicit nonnegative integer + observed timestamp or null. No inference from preview/body/time/message count. Unreadable/conflicting current evidence or non-AVAILABLE Contact displays `—`; absent evidence does not invent 0 or refresh old streak timestamp. Detail/list computes freshness (24h); it is presentation metadata, never discovery identity or send permission.

## 9. Minimum API and UI

Base `/api`; existing success/error envelopes and middleware apply. S=valid AdminSession; M=S+Origin/Sec-Fetch-Site/JSON/CSRF; I=required idempotency. All DTOs omit paths, raw stable values, remote URLs, candidate dumps, browser process/internal-port details and message data.

| Route | Guard | Contract |
| --- | --- | --- |
| `POST /accounts/:accountId/contact-syncs` | M+I | Strict `{}`; 202 `{syncRunId,status}` (canonical replay also 202). No limits/path/cursor override. |
| `GET /contact-syncs/:syncRunId` | S | Account ID, status/isComplete, safe counts/failureCode, created/started/finished timestamps. No live observations. |
| `GET /accounts/:accountId/contacts` | S | `{items,nextCursor,latestSync}`; query/type/availability/identityStatus; default50/max200. latestSync is safe latest run summary or null, read-only. |
| `GET /contacts/:contactId` | S | Metadata, masked identities (id/kind/state/preferred/observation times), discovery-eligibility reason. No Task/send capability lookup or preferred mutation. |
| `GET /avatar-assets/:assetId` | S | Valid cached bytes, correct MIME, nosniff, private/no-store; missing/expired404 placeholder; never redirect remote. |

Contact summaries include id/accountId/type/displayName/remarkName/local avatarAssetId, fresh streak fields, availability/identityStatus, discovered/lastSeen/updated times. Discovery-eligibility is **not** resolver verification or permission to send; UI uses “identity ready / review required”, not “verified sendable”. Detail masks stable values; names are escaped text, never HTML.

Contact keyset cursor orders immutable `(createdAt,id)` scoped to Account and canonical filters; bounded encoded schema, no raw identity. Query ≤100 code points and bound LIKE parameters/escaped wildcard semantics. Paging is not a frozen snapshot during sync; after terminal publication UI resets cursor/refetches. No offset-based disappearance/duplicate ordering assumptions.

404 for missing/PROVISIONING Account or inaccessible resource; 409 PROFILE_BUSY/STATE_CONFLICT/IDEMPOTENCY_CONFLICT for admission; 422 for non-ready Account/profile; 503 RELEASE_GATE_CLOSED/RUNTIME_UNAVAILABLE for disabled safety boundary. Expected failures carry allowlisted safe codes, not raw errors. Domain status/failure distinctions follow §5–7.

Minimal `/accounts/:accountId/contacts` UI in existing Account workspace:

- Sync button enabled only for known eligible Account and no known active flow (server remains authoritative).
- Start generates a key once/action, disables double-submit; safe polling every 2 seconds while mounted/authenticated and active. Unmount/session loss cancels reads, not the durable operation; no automatic POST retry.
- Refresh/list reload obtains latestSync, then polls its durable ID. A network-uncertain start can only be explicitly reconciled with the same key, never quietly restarted with a new key.
- List, query/type/availability/identityStatus filters, next-page, minimal read-only detail drawer; distinguish zero Contacts, empty complete, partial, interrupted, parser failure and auth expired.
- Show partial coverage limits, stale/changed/ambiguous warnings and existing relogin link where needed. No resolve/send/test-send/legacy binding/manual identity fields.
- Use authenticated same-origin cached avatar/placeholder. Never render remoteURL. Optional streak dash rules apply.
- Add Contacts navigation without repurposing legacy Friends IDs/API or rewriting legacy pages. Friend manual CRUD is not Contact creation; no automatic import/bind. Old `POST /api/accounts` remains 404.

No new SSE payload or SystemEvent schema required: poll durable status and refresh list after terminal. No privacy-sensitive candidate progress feed.

## 10. Focused acceptance tests

Use synthetic directory fixtures and temporary DB/data roots only. No Douyin, actual logged-in profile, screenshot/trace or send execution. New parser browser tests, if needed, use local HTML and a disposable test profile, never Account onboarding or network. Test doubles must not be the sole proof of process/filesystem recovery.

| Invariant / failure | Focused evidence |
| --- | --- |
| One global flow | Concurrent sync/sync and sync/login/relogin across Accounts/Admins; replay/conflicting key; reciprocal DB admission; gates/busy execution/recovery barrier. |
| Stable matching, not names | Same-name distinct Contacts, cross-account key isolation, duplicate windows, whole-run bridge conflict, type conflict, preferred-not-observed CHANGED; no automatic preferred upgrade/superseded revival. |
| Correct full/partial semantics | Explicit empty/end; virtualized windows; delayed loading/no-progress/reorder; missing stable fields; 500/deadline; no stale on any issue/partial/auth failure. |
| Atomic publication/stale | Inject transaction failure before/after upsert; terminal replay; no partial metadata leak; 3 complete misses/24h; partial preserves misses; historical directory >500. |
| No automatic restart/ownership release | Crash boundaries before/after commit; active and terminal stale identities; real POSIX detached worker/Chromium-shaped groups, hung child, invalid identity; both groups absent before release; no replacement spawn on uncertainty. |
| Security/privacy | S/M guards, malformed IPC limits; PROVISIONING/profile-marker mismatch; unsafe asset path/symlink/oversize/MIME, authenticated asset reads; negative assertions for raw identity/URL/path/body in logs/DTOs. |
| Minimal UI/regression | Start double-click/network uncertainty/reload status, partial/auth warning, filters/paging/detail/placeholder; POST Accounts404 and onboarding recovery/security unchanged. |

Run affected database/shared/automation/server/admin-web tests and typecheck proportionate to changes; build server/admin-web/native helpers and validate Docker packaging for new worker/helper when implementing. Update route/migration proof inventories impacted by legitimate changes without weakening V4-2 auth invariants. No unrelated proof matrix, whole-repo heavy tests, new real-site smoke, release or Gate B during implementation/review.

## 11. Main implementation files (planned, not created by planning)

- Shared: `packages/shared/src/Contact.ts`, DTO/export modules as needed.
- Database: `packages/database/migrations/0010_*.sql` + metadata; `schema/contacts.ts`, `schema/contactSyncRuns.ts`; new `repositories/ContactDiscoveryRepository.ts`; bounded Contact/Identity/SyncRun/AvatarAsset repository methods/exports; `AccountOnboardingRepository.ts` reciprocal admission only.
- Automation: new `packages/automation/src/douyin/DouyinContactDirectory.ts` and typed candidate/parser contract; centralized `selectors.ts`/exports and offline fixtures. No changes to ContactResolver/send implementation.
- Server: new `apps/server/src/contacts/ContactDiscoveryManager.ts`, `ContactDiscoveryWorkerProtocol.ts`, `ContactDiscoveryWorkerSupervisor.ts`, `contact-discovery-worker.ts`, `AvatarCacheStore.ts`; narrow reuse of onboarding process ownership/coordinator/profile primitives; `apps/server/native/chromium-launcher.c` discovery ownership proof and native anchored asset primitive if needed.
- Wiring: `apps/server/src/http/ApiApplication.ts`, `lifecycle/SparkKeeperService.ts`, contact routes/schemas/serializers/services; worker production entry/build assets and native packaging (`apps/server/scripts/build-native.mjs`, Dockerfile) only if needed.
- Admin: new `apps/admin-web/src/pages/AccountContactsPage.vue`/detail component; router/Account workspace nav, `api/sparkkeeperApi.ts`, parsers/types, status/error/i18n labels. Keep auth controller and legacy Friends page contracts.
- Focused tests corresponding to these modules; existing route/migration inventory tests only as required. Docs status/spec updates at acceptance.

## 12. Fixed implementation order and stop conditions

1. Migration/shared DTO/failure/count contract; fresh/upgrade integrity.
2. DB aggregate: cross-operation admission/idempotency, whole-run matching, terminal CAS/stale/atomic publication; tests before browser integration.
3. Shared coordinator/profile ownership and startup barrier; owned-process recovery without website navigation.
4. Automation adapter/readiness/candidate parser/bounded traversal against local fixtures; document exact supported layout evidence.
5. Discovery worker/IPC/supervision, deadline and real POSIX cleanup/recovery fixture; native/runtime packaging.
6. Opportunistic avatar cache/read/retention and optional streak rules; failures remain nonessential.
7. Manager lifecycle/completion/recovery orchestration and auth/state mapping.
8. Authenticated API + inventory/security regression.
9. Minimal Contact UI + affected verification; independent review; stop before Git delivery/real Gate B.

Stop with SPEC_BLOCKER if implementation needs private endpoints, raw response/credential extraction, guessed identity/type/end evidence, automatic merge/rebind, changes to send/Scheduler, or unavailable reliable process/filesystem ownership. If ordinary page DOM cannot expose required identifiers/completeness, ship safe partial/failure behavior and report the limitation; do not manufacture fixture-driven live capability or silently expand to a private parser.

Planning exit: the scope/state/data/API/order contracts above are ready for separate implementation authorization. Real-site usefulness remains unverified until a separately authorized Gate B validates normal-page identity extraction, directory completeness and headless profile behavior with zero sends.

## 13. Implementation record (offline, not Gate B acceptance)

The implementation preserves sections 1–12 as its acceptance contract. Migration 0010, serialized discovery aggregate, shared browser admission, startup process ownership recovery, bounded DOM projection/collector, worker IPC/supervision, anchored optional avatar cache, manager, five authenticated routes and read-only Contacts UI are implemented on the required branch. No Resolver/send/Scheduler/preferred mutation/cancel capability was added. Existing Account read DTOs additionally expose only `profileState` and `lifecycleStatus` so the UI can establish known eligibility; they do not expose a path or permit mutation of ownership.

Offline evidence covers populated 0009 upgrades/FK/index/trigger preservation and dirty-data rollback; stable-key matching and independent-connection sync/sync/relogin admission; full-only stale and partial/auth-safe publication; parser projection/window fixtures; manager cleanup/recovery barriers, S/M/CSRF/asset boundaries and legacy Account POST404; minimal UI uncertainty/filter/detail behavior. Linux Docker validates the native discovery ownership writer using a detached Node executable, not Chromium: restart adopts worker and browser-shaped groups and reaps their hung children before clearing identities.

Known limitations remain explicit:

- Normal-page stable attributes/self-profile and end/empty/loading/coverage evidence are not live-site verified. The production conservative adapter cannot declare COMPLETE; absent a reviewed end contract it reports bounded PARTIAL/FAILED. Fixture COMPLETE does not grant live completeness or stale permission.
- No reliably bounded loaded-image acquisition or current streak DOM contract is verified. Runtime capture is skipped, with placeholder/null; the immutable cache/read/retention capability is tested with synthetic bytes. No extra image request or response-body fallback is introduced.
- Production discovery is Linux-only (`/proc` start ticks + boot proof); other platforms fail closed. Multi-instance runtime ownership remains unsupported.
- Independent code review and separate no-send Gate B authorization are still required. No real Douyin access, discovery, onboarding, scan, send, Git delivery or deployment occurred.
