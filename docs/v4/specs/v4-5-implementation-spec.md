# V4-5 Implementation Specification — Stable Target Resolver

> Status: MERGED / ACCEPTED (PR #45); do not reopen
> Spec owner / reviewer: Codex
> Baseline: `develop@2fd237f0405d3171c1606c27b9862763baabf950` (V4-4 merged by PR #44)
> Merged baseline: `develop@d964fc4f8b3d8ead0f675a0d2c2477edb32eb5a5`
> Required implementation branch: `feature/v4-5-stable-target-resolver`
> Accepted dependencies: V4-1 / V4-2 / V4-3 / V4-4; do not reopen them
> Authority: this milestone spec under the V4 product/architecture freeze; user authorized Milestone Owner implementation, self-review, verification and feature-branch Git delivery (not merge/release/deploy)

## 1. Objective and minimum scope

Resolve one persisted Contact's **single ACTIVE preferred identity** against the current Account's normal `/chat` directory, establish uniqueness, open only that conversation and re-verify its current identity. Return an ephemeral, page-bound verification witness, never a guessed target or permission to send.

Included:

- A coherent, read-only Account/Contact/preferred-Identity snapshot and eligibility/version checks;
- separate typed PERSON and GROUP resolvers, exact preferred-kind comparison and bounded complete-coverage proof;
- a versioned, narrowly scoped DOM adapter for candidates, stable conversation anchors and current-chat identity;
- stable-handle reacquisition, one conversation-open action and current-header/conversation re-verification;
- typed terminal results, process-memory `ResolutionWitness` and a minimal internal application interface;
- focused synthetic/unit/temporary-DB/controlled-local-page tests, including negative no-send assertions.

Excluded:

- Actual send, composer preparation, MessageSender, Delivery Verification, Test Send, Run/SendRecord and Scheduler;
- resolver HTTP routes, background operations, durable ResolverRun/status storage and new resolver UI;
- new browser worker/supervisor, profile/runtime ownership redesign or discovery-worker conversation opening;
- discovery/persistence/stale progression, preferred mutation, human rebinding, legacy Friend binding or automatic resync;
- auth-check/unbind, noVNC/console changes, multi-instance runtime support;
- private Douyin API, response/JSON/page-store introspection, request replay, cookie/token/storage inspection;
- message-body/preview collection, whole DOM dumps, screenshots/HAR/trace, CAPTCHA/risk-control bypass;
- real Douyin access, real Account/profile use, Gate B or any real-send gate during implementation/review.

V4-5 is an internal resolver building block, **not a new production browser operation**. There is no reachable production trigger in this milestone. Its implementation must not create a feature flag, CLI or diagnostic endpoint that bypasses this boundary. Existing Contact `identityReady` means persisted eligibility, not live target verification.

## 2. Baseline facts and reuse decisions

| Existing implementation | V4-5 decision |
| --- | --- |
| Contact / ContactIdentity, account-scoped ACTIVE strong-key uniqueness and one preferred/contact | Reuse without migration. Validate Account association on both rows; the separate FKs alone do not prove that association. |
| `ContactRepository.ALLOWED_PREFERRED_IDENTITY_KINDS` | Current persisted PERSON preferences are SEC_UID/UNIQUE_ID/SHORT_ID; GROUP is CONVERSATION_ID. Preserve this minimum boundary. |
| `ContactIdentityRepository.setPreferred` | Changes Identity rows without advancing Contact.updatedAt. Bind preferred row contents/version as well as Contact version; a timestamp-only Contact check is insufficient. |
| V4-4 `parseDirectoryRow`, observation validation and Account self-identity check | Reuse allowlisted field/type/public-profile-link validation and normalization where applicable. Do not treat discovery dedup, a stored Contact or a prior COMPLETE sync as current resolver coverage. |
| V4-4 conservative live DOM adapter | Currently cannot prove complete coverage. A resolver adapter must remain UNVERIFIABLE where coverage/current-chat identifiers are unsupported; local fixture success is not a live-site claim. |
| legacy `ContactResolver` | Do not reuse its matching algorithm: displayName-only, virtual-index dedup and first-match early return cannot prove uniqueness. Bounded clock/scroll test patterns are reference material only. |
| legacy `DouyinChatPage.openConversation` | Do not reuse its name/index click or name-only header verification. Reuse normal `/chat` navigation, readiness/scroll mechanics only through the new stricter adapter contract. |
| `selectors.ts`, `AuthDetector`, `DouyinAccountIdentityExtractor` | Reuse centralized selectors and explicit auth/self-profile scopes. Add an independently versioned resolver selector contract; existing selectors do not prove current-chat stable identity. |
| AccountProfileStore / BrowserOperationCoordinator / supervised Chromium ownership | Preserve Account-owned final marker, single global/profile lease, startup barrier and proven cleanup. Resolver consumes an already owned runtime; it neither opens a profile nor releases its lease. |
| `ProductionDailyTaskAutomation`, legacy Friend/Schedule/send path | Leave unchanged and gated. The new V4 path must not instantiate legacy ContactResolver/DouyinChatPage open logic or wire into this production adapter. |

The architecture freeze permits a **future explicit human-selected** DISPLAY_NAME/REMARK_NAME preference with low-confidence UI. It is not implemented by the current repository/UI. V4-5 does not add that mutation or activate name-only resolution: such a request returns `UNAVAILABLE / TARGET_IDENTITY_UNAVAILABLE`. This milestone subset does not remove the frozen future manual option and never changes the current allowed-preferred kinds to enable it implicitly.

## 3. Identity and evidence model

| Evidence | Allowed role | Never sufficient for |
| --- | --- | --- |
| PERSON SEC_UID / UNIQUE_ID / SHORT_ID | Exact match of the request's one preferred kind/value in a typed PERSON row and again in the current chat. | Silent fallback to another kind; assuming identifiers cannot change. |
| GROUP CONVERSATION_ID | Exact preferred comparison, stable group selection and same-ID current-chat verification. | Identifying a group by a member's profile identity or its title. |
| Page-provided stable conversation/candidate anchor | Distinguishes conversations across virtualized windows; binds a fresh selectable handle to the current chat. | Substituting for the preferred PERSON identity. |
| displayName / remarkName / avatar | Human-readable metadata only in this milestone. Same name with different strong identities is normal. | Identity match, deduplication, disambiguation or header verification. |
| list position / data-index / DOM order / scroll offset | Bounded traversal diagnostics and layout progress only. | Identity, durable target, uniqueness proof or a saved click target. |
| Persisted READY, last discovery result, visible title after click | Preflight metadata or readiness hints. | Current directory completeness, current Account identity or VERIFIED. |

Normalize exactly as persisted identities: bounded strings, trim only, case-sensitive equality, no case folding, Unicode/confusable substitution, numeric parsing or leading-zero removal. Reject invalid/control-containing values; do not repair or broaden them. A normal public `/user/...` link may supply SEC_UID only when its scoped ownership and URL validation match the V4-4 parser contract; never follow/fetch that link.

**Conversation dedup is not Contact discovery dedup.** Prefer a normally exposed conversationId as an independent candidate anchor. Another page-provided stable key is allowed only with an explicit versioned adapter contract proving conversation-level equivalence. Never synthesize it from names, positions or the preferred identity itself. Without such evidence, repeated rows cannot safely be collapsed and resolution is UNVERIFIABLE.

- Same anchor, same type and same scoped identity projection across windows: one conversation observation.
- Two distinct proven anchors matching the same preferred identity: AMBIGUOUS, even if names match or the DB contains only one Contact.
- Same anchor with contradictory preferred/type evidence: IDENTITY_CHANGED; missing/uncertain evidence is UNAVAILABLE/UNVERIFIABLE, not a guessed change.
- Multiple simultaneous selectable rows for one anchor require an adapter-proven single conversation control; otherwise UNVERIFIABLE. Never click `.first()` to resolve uncertainty.

Matching uses only preferred kind/value. Other row fields may expose intrinsic contradictory evidence, but cannot become alternative match keys. V4-4 persisted CHANGED/AMBIGUOUS already blocks preflight. Do not pass every stored identity to automation to construct a hidden fallback or silently merge/rebind targets.

## 4. Read-only snapshot and version boundary

Application prepares the request from trusted Account ID + Contact ID; it does not accept a caller-supplied identity, displayName, index, selector, URL or profile path.

One short DB read transaction must load Account, Contact and up to two ACTIVE preferred rows for that Contact (enough to reject multiplicity), verify exact count one and Account association, then freeze:

- Account: ACTIVE, enabled, profileState READY, loginStatus READY and required persisted self-identity (SEC_UID, otherwise UNIQUE_ID as selected before navigation);
- Contact: belongs to Account, type PERSON/GROUP, availability AVAILABLE, identityStatus READY;
- preferred Identity: same Account/Contact, ACTIVE, isPreferred, supported kind for type, valid normalizedValue and observation timestamp;
- expected metadata version: a canonical private snapshot binding Account eligibility/self-binding, Contact id/type/displayName/remarkName/availability/identityStatus/updatedAt and preferred id/kind/normalizedValue/state/isPreferred/updatedAt/lastObservedAt. Bind values, not timestamps alone; detect a preferred switch even within the same millisecond. Names participate only in snapshot concurrency, never target matching.

SYSTEM/UNKNOWN, STALE/UNAVAILABLE, CHANGED/AMBIGUOUS/LEGACY_UNBOUND, PROVISIONING/MISSING/UNBOUND, zero/multiple preferred or cross-account association fail closed before page access. No preferred row is created or selected from alternatives. No migration, schema column or update to accepted repositories is required: add a bounded read-only aggregate/snapshot method.

`expectedMetadataVersion` is internal and non-loggable, not a public raw-value digest or new client concurrency token. Re-load the same aggregate immediately before open and immediately before returning VERIFIED; any changed eligibility/binding/preferred/version stops this invocation and invalidates its witness. Database failure is FAILED, never a retained VERIFIED result. No DB transaction remains open across browser awaits. Automation does not query DB; the application layer coordinates these checks with the two-phase interface below.

No resolver result updates ContactIdentity, Contact availability/risk, Account auth state, ContactSyncRun or AuditEvent. An auth/change result can inform a future caller's separately specified lifecycle, but V4-5 performs no such write. Recovery after a crash discards the in-memory resolution and starts with a new snapshot under a future authorized operation; it never resumes a witness.

## 5. Resolver state machine and scan contract

```text
prepare eligible snapshot
  → assert existing runtime ownership + normal-page auth/self binding
  → scan typed directory to proven complete coverage
  → exactly one matching conversation / provisional FOUND
  → application revalidates snapshot
  → reacquire and re-read stable candidate control
  → open once + re-verify current-chat identity
  → application revalidates snapshot + runtime/witness still current
  → VERIFIED

Any uncertainty/error → typed terminal failure; no open on scan failure, no send on any path.
```

### 5.1 Account readiness and DOM scope

The authorized runtime may navigate only to the normal configured `/chat` page. Auth uses existing recognized login/expired signals and a unique visible self-profile region; compare its stable self-identity to the frozen Account binding. No matching by Account name or shortId-only fallback. Missing/ambiguous self proof is AUTH_UNKNOWN; positively different Account is ACCOUNT_IDENTITY_MISMATCH. Never launch login/relogin, inspect cookies or bypass a challenge.

There must be exactly one supported directory root, and later exactly one current conversation/header scope. Multiple/unknown roots, broad body-text matches, fixture-only attributes in a production adapter or selectors renamed without a supported contract cannot pass. Only row/header identity attributes, scoped public profile href and type/coverage/loading evidence may be projected. Do not read message-region text, previews, message rows, page-global stores or response payloads.

### 5.2 Complete bounded uniqueness

- Reset to a proven directory beginning; scan contiguous overlapping windows with loading/quiescence and typed-row validation. A single visible viewport is not a full directory.
- Collect all potential same-type candidates, not just matching names/values. An unknown type or missing required preferred-field evidence on a row that could be the target blocks zero/one-match certification. A proven non-target type does not need the target's PERSON field.
- Do not return FOUND on the first match. A late second distinct matching anchor returns AMBIGUOUS. This failure may terminate early once multiplicity is positively proved.
- FOUND or NOT_FOUND requires positive empty/end evidence, contiguous coverage without unresolved rows and a coherent directory observation epoch. That epoch must cover every window: a page-provided version or adapter-proven equivalent exhaustive snapshot contract. Re-reading unchanged top/bottom signatures alone does not prove that unseen middle rows stayed unchanged.
- Virtualization index, scrollHeight/bottom, timeout, stalled loading, no-progress or “no new rows” are never end/uniqueness evidence. They return UNVERIFIABLE. A previous COMPLETE discovery run cannot fill current gaps.
- A new candidate, reorder, identity change or directory mutation invalidating the coverage epoch stops this invocation. No automatic restart, second-field search, arbitrary profile navigation or search-box fallback.
- Budgets: one overall deadline `min(callerDeadline, start + 60 seconds)`, at most 500 row observations (including repeated windows/invalid rows/reacquisition), at most 50 window reads total. All page operations use the remaining deadline; no phase resets it. Budget exhaustion before certification is UNVERIFIABLE / RESOLUTION_LIMIT_REACHED. After the conversation-open click, timeout remains failure, never an implicit verification.

The production adapter is intentionally conservative until normal-page completeness/anchor/header evidence is supported. If only the V4-4 projection is available, return UNVERIFIABLE rather than claim working live resolution from a synthetic end marker. Implementation documents the exact supported layout/version; no real-site validation is required or authorized by this planning task.

### 5.3 Stable open and current-chat re-verification

1. Provisional FOUND retains a private candidate witness; it is not VERIFIED and not a public success result.
2. After the application snapshot check, reacquire the candidate using its independent stable anchor under the same coverage epoch. Re-read type, preferred kind/value and selectable control. No saved virtual index, stale nth locator or name match. Reacquisition consumes the same budget; disappearance/invalidation stops rather than choosing another row.
3. Use an owned, exactly-one conversation control with documented navigation semantics. Do not click an enclosing row's profile link, group member, composer, send button or arbitrary text. One click maximum, no retry after an uncertain click or navigation failure.
4. Re-check Account self/auth binding and obtain fresh current-conversation evidence associated with that selected anchor after the open action. A stale header from the preceding chat or an arbitrary hidden matching header cannot pass.
5. PERSON: same type, same conversation anchor and exact same preferred kind/value in the scoped current-chat identity. SEC_UID evidence cannot substitute when the preferred kind is UNIQUE_ID/SHORT_ID. GROUP: same type and exact CONVERSATION_ID, never group title/member SEC_UID.
6. Stable contradictory current-chat evidence → IDENTITY_CHANGED; wrong type → UNSUPPORTED_TARGET_TYPE or IDENTITY_CHANGED where an observed candidate changed type. Missing preferred/header evidence → TARGET_IDENTITY_UNAVAILABLE. Auth expired/unknown, page/context replacement or timeout → failure.

A changing name does not invalidate an otherwise identical stable target unless the frozen metadata version changed; it can never repair a failing identity proof. Opening a conversation may produce normal read receipts/mark-as-read and profile/network side effects. The guarantee is **zero message composition/submission**, not zero website navigation side effects.

## 6. Terminal result model

Final `TargetResolutionResult` is a discriminated union. Only VERIFIED contains a witness; every other variant contains an allowlisted safe reason code and no target handle. Failure priority is based on positive evidence, not on convenient exception text: known auth/ownership failure blocks all candidate success; invalid snapshot blocks use; proved duplicates are ambiguous; incomplete coverage can never become NOT_FOUND.

| Status | Reason examples / meaning | Open allowed? |
| --- | --- | --- |
| VERIFIED | Complete uniqueness + selected-chat identity + unchanged snapshot/ownership; live witness present. | Already opened exactly once; no send capability. |
| AMBIGUOUS | TARGET_AMBIGUOUS: at least two distinct proven conversations match. | No. |
| NOT_FOUND | TARGET_NOT_FOUND: a complete, supported, preferred-field-covered directory contains zero matches. | No. |
| AUTH_EXPIRED | Recognized normal-page expired/login state, or frozen Account already AUTH_EXPIRED. | No further action. |
| IDENTITY_CHANGED | IDENTITY_CHANGED for persisted CHANGED/contradictory stable identity; METADATA_VERSION_CHANGED for a changed frozen snapshot. The latter is a concurrency stop, not a persisted identity-risk judgment. | No further action. |
| UNAVAILABLE | TARGET_IDENTITY_UNAVAILABLE, CONTACT_UNAVAILABLE, ACCOUNT_NOT_READY, TARGET_NOT_ELIGIBLE, UNSUPPORTED_TARGET_TYPE. Includes absent preferred/current-header field and unsupported name preference. | No further action. |
| UNVERIFIABLE | AUTH_UNKNOWN, ACCOUNT_IDENTITY_MISMATCH, SELECTOR_CONTRACT_UNAVAILABLE, DIRECTORY_INCOMPLETE, DIRECTORY_CHANGED, CANDIDATE_ANCHOR_UNAVAILABLE, TARGET_DISAPPEARED, RESOLUTION_LIMIT_REACHED. | No further action. |
| FAILED | PAGE_CLOSED, BROWSER_FAILURE, PERSISTENCE_FAILURE, RUNTIME_OWNERSHIP_LOST, RESOLUTION_TIMEOUT after open. Infrastructure cannot prove success. | No further action. |

Persisted AMBIGUOUS may produce AMBIGUOUS / TARGET_AMBIGUOUS before scan; no claim about current match count is then emitted. Missing/ineligible entities return safe unavailable results; DB integrity violations (e.g. multiple preferred) return FAILED / PERSISTENCE_FAILURE and do not mask corrupt data as ordinary NOT_FOUND. Raw exceptions/URLs/identity values/candidate names are not reasons. Do not invent NOT_FOUND or AUTH_EXPIRED from timeout/network/selector failure.

### 6.1 ResolutionWitness

The automation package owns an opaque, privately branded witness/registry, not a caller-constructible plain object. Private backing state binds:

- Account/Contact, preferred identity ID/kind and the exact expected metadata version;
- original Page/BrowserContext, owned-runtime generation and observation/coverage epoch;
- independent stable conversation anchor, contact type, match field and fresh current-chat observation;
- resolver deadline and live handle validity.

Stable raw values/anchors remain in private process memory only. A witness exposes no serializable raw identity or DOM handle; JSON/logging produces no backing state. Revalidation checks the same page, owner generation, unchanged selected conversation/auth/identity and snapshot. Navigation, chat switch, context/page replacement/close, lease loss, deadline or metadata change invalidates it. A string ID alone or a copied/forged object cannot pass.

Witness is local to one operation, never persisted, sent through HTTP/SSE/IPC, revived after restart or cached as permanent “verified”. Future worker integration must keep witness consumption in the same owned worker, returning safe result summaries rather than transmitting its authority. It is not a reservation against future page/DB mutation or send authorization: later V4-6/V4-7 must freshly revalidate immediately before their separately specified action boundary.

## 7. Internal interface, runtime ownership and API boundary

Internal contract shapes (opaque service capabilities keep the snapshot and runtime private):

```text
ResolverRequest
  accountId, contactId, contactType
  preferredIdentity { id, kind, normalizedValue, observedAt (lastObservedAt in epoch milliseconds) }
  expectedMetadataVersion

TargetResolverSnapshotRepository.load(accountId, contactId)
  → coherent private eligibility snapshot | typed preflight failure

TargetResolutionService.prepare(accountId, contactId)
  → PREPARED(opaque one-shot PreparedResolverRequest) | terminal failure

PersonResolver.resolve(request, deadline)
GroupResolver.resolve(request, deadline)
  → private FOUND(candidate witness) | terminal failure

StableTargetResolver.openAndVerify(candidate witness, request)
  → VERIFIED(ResolutionWitness) | terminal failure
  (uses the owned directory adapter and the original budget)

TargetResolutionService.resolveCurrentChat(preparedRequest, ownedRuntime)
  → scan → DB recheck → open/reverify → DB/live-witness recheck
  → TargetResolutionResult

TargetResolutionService.revalidateCurrentChat(witness, sameOwnedRuntime)
  → null when still current | terminal failure (permanent witness invalidation)
```

The automation resolver receives no DB client, raw profile path, message text, Task/Template, sender, allowRealSend flag or alternate identity list. Narrow read/scroll/open/verify ports do not expose fill/type/press/send or a general-purpose callback capable of arbitrary DOM actions. The Playwright adapter keeps Page access private; only its documented allowlisted operations implement these ports.

An owned runtime must bind Account/profile marker, current global/profile lease token and generation, completed startup recovery and live supervised ownership. Its validity assertion is performed before browser access and again before open/final VERIFIED. An arbitrary raw Page or boolean “hasLease” supplied by a future route is not production authority. Test factories provide controlled local runtimes, never production profile access.

V4-5 **does not acquire/release leases, start Chromium or change startup/recovery**. A future authorized parent operation must use the V4-3/V4-4 ownership/admission model: one global browser operation including login/relogin/discovery/resolution; durable admission before launch; server-resolved Account-owned final profile; supervised worker and Chromium groups; invalid ownership fail closed; stop/prove both groups absent before release. Resolver timeout/error never releases those resources itself. A witness remains valid only while that owner's lease/runtime is held.

No discovery run is fabricated as a resolver reservation; no Page is exposed from discovery Manager, and its read-only worker is not extended to open chats. A future send worker/protocol integration is separately specified. Workers never acquire DB credentials merely to implement snapshot rechecks; a future parent/worker handshake must preserve the pre-open/final validation boundaries and local witness ownership.

**HTTP/UI: none added.** Account/Contact GET remains read-only and never opens a browser. No POST resolver, resolver status polling, resolve button or Test Send preview. Existing route inventories/CSRF guards and Contact UI meanings remain unchanged. Status/reason types are internal, suitable for future safe caller summaries, not new HTTP DTOs. No message, raw identity, profile path, candidate dump, private anchor, browser port or process ID is logged or exposed.

## 8. No-send and privacy boundary

- New resolver modules/service do not import/call MessageSender, DeliveryVerifier, DailyTaskRunner/ProductionDailyTaskAutomation or send execution APIs. Leave legacy compatibility tests/code separate; shared package barrels exporting legacy symbols do not authorize their use.
- Never query/use composer or send-control selectors, fill/type/edit a draft, press Enter, dispatch keyboard/click events toward sending, clear a draft or accept message input. Only the typed conversation control may be clicked.
- Existing drafts must remain unchanged; failure/success must not submit them. No automatic message, “probe”, typing test or send-based target verification.
- Reuse only normal Account self, directory and current-header identity projection. Do not read messages to prove who a chat belongs to. GROUP member links cannot identify the group.
- Allowlisted safe statuses/timing/counts may be recorded in future diagnostics, but no raw candidates, stable values, URLs, user-page data, serialized witnesses or browser exceptions. No new persisted telemetry is required by V4-5.
- Local HTML fixtures use fake identities and can observe their own synthetic click/send counters; this does not permit evaluating application page stores or extracting real message bodies.

## 9. Focused acceptance tests

No broad proof matrix, real site, logged-in profile or real sending. Tests use temporary DB, typed fake directory ports and controlled local HTML (offline routing/disposable test profile). Legacy name/index tests remain legacy evidence, not V4 acceptance.

| Boundary | Minimum focused evidence |
| --- | --- |
| Snapshot eligibility/version | Account/Contact/Identity association; zero/multiple/superseded preferred; unsupported type/name preference; PROVISIONING and unavailable risk states; preferred switch without Contact.updatedAt change and within same timestamp; DB failure before/final check. Reads make no DB changes. |
| Preferred-only matching | Same name/different strong key; changed name/same preferred key; missing preferred but another field matches; exact case/leading zeros; GROUP excludes member identity; no name/index fallback. |
| Complete uniqueness | First match then late duplicate; same anchor repeated vs distinct anchors; virtual index reuse/reorder; incomplete end/loading/gaps/missing fields/budgets cannot return FOUND/NOT_FOUND; explicit complete empty permits NOT_FOUND. |
| Stable open/header | Candidate recycled/disappeared between scan/click; two selectable controls; stale prior-chat/hidden header; selected anchor mismatch; missing/mismatched preferred field; GROUP same title/different ID. At most one open and no open on scan failure. |
| Live witness/ownership | Page/context/chat switch, expired budget, snapshot mutation, self identity mismatch, auth expiry/unknown, lost lease and forged/replayed witness all fail; no replacement launch or lease release by resolver. |
| Zero send/privacy | Real local DOM handlers count opens separately from synthetic sends; include a pre-existing draft and Enter-sensitive send control, assert draft unchanged/send count zero on success and failure. Safe result/error/JSON serialization excludes raw identity/anchor/DOM/message data. |

After separately authorized implementation, run affected database/automation/server focused tests and shared/database/automation/server typecheck proportionate to changed files. Build affected packages/server if module exports require it. No admin-web tests/build, migration/native/Docker work or new process-recovery fixture is required unless implementation changes those components, which this scope does not authorize. Stop rather than expanding the milestone to satisfy unrelated gates.

## 10. Planned files and fixed implementation order

Main implementation files:

- `packages/shared/src/TargetResolution.ts`, `src/index.ts`: safe status/reason/request types without Playwright/serializable witness internals.
- `packages/database/src/repositories/TargetResolverSnapshotRepository.ts`, repository exports and its focused test: coherent read-only eligibility/version snapshot. No schema/migrations.
- `packages/automation/src/douyin/resolver/{types,PersonResolver,GroupResolver,StableTargetResolver,DouyinTargetResolverPage,ResolutionWitness}.ts`: small cohesive ports, typed dispatcher/scan, scoped adapter, private witnesses. Avoid a general plugin/policy framework.
- `packages/automation/src/douyin/selectors.ts` and automation export files: versioned resolver-only selector additions, no legacy selector behavior rewrite or fixture markers as live proof.
- `apps/server/src/automation/TargetResolutionService.ts`: snapshot preparation and pre-open/final checks using an already owned runtime; no ApiApplication route/lifecycle wiring, worker/manager or process launch.
- Corresponding focused tests under `packages/database/test`, `packages/automation/test` and `apps/server/test`; no frontend files or API mutation tests unless legitimately impacted.
- V4 index/roadmap/API/architecture notes and this spec; preserve accepted V4-1…V4-4 contracts.

Fixed order:

1. Shared status/reason/request contracts and private automation port/witness boundaries.
2. Read-only DB snapshot aggregate, eligibility and complete metadata-version comparison; focused DB tests.
3. Scoped normal-page auth/self/typed row/current-header projection and explicit supported coverage/anchor contract; local fixtures before browser integration.
4. Separate PERSON/GROUP preferred-only bounded scan, independent-anchor dedup and complete uniqueness/failure tests.
5. Fresh stable control open, exact current-chat re-verification and opaque witness invalidation; local DOM no-send fixtures.
6. Internal application orchestration: prepare → resolve → snapshot check → open → final snapshot/live check. Keep all production triggers absent.
7. Tests/typecheck/build, review and limitations report. The later Milestone Owner authorization permits autonomous self-review/fixes and feature-branch commit/push/PR after verification; it does not authorize real-site access or merge/release/deploy.

## 11. Stop conditions and known limitations

Report SPEC_BLOCKER rather than implement private APIs, credential extraction, guessed type/anchor/end/header, name/position fallback, auto rebind/resync, resolver endpoint, independent runtime launch or send/Scheduler integration. Missing live evidence itself is not a blocker to a safe internal implementation: return UNAVAILABLE/UNVERIFIABLE and document the unsupported layout instead of weakening verification.

- Gate B remains unexecuted. Real Douyin DOM, directory completeness, current-chat stable fields and headless behavior are not validated by V4-4 or this planning.
- ShortId/UniqueId may be mutable or absent in the current header. Their persisted preferred role does not grant fallback to SEC_UID/name; lack of exact proof stops.
- Even complete uniqueness is a current-directory, current-epoch claim, not a permanent social identity guarantee. Witnesses expire and do not authorize later sending.
- Production runtime remains the accepted single-instance Linux ownership model. This milestone adds no independent runtime and makes no portability expansion.
- No migration, HTTP API or UI is necessary for the minimum resolver building block. Real usefulness and a new authorized consumer are later gates/specs, not implicit scope.

## 12. Implementation and offline verification record

Implemented on `feature/v4-5-stable-target-resolver` from the baseline above. The user explicitly authorized the complete V4-5 implementation/review/fix/verification/Git-delivery loop; Sections 1–11 retain the frozen product semantics.

- `TargetResolverSnapshotRepository` uses one short read transaction with zero contention wait. Its private content fingerprint binds Account eligibility/self identity, Contact metadata and the preferred Identity row, including same-millisecond preference changes. No schema or persistence mutation was added.
- `TargetResolutionService` consumes a private one-shot prepared snapshot and a registered existing-runtime capability. Ownership assertions verify the current coordinator token, Account-owned final profile marker and awaited recovered supervisor ownership before browser work. No admission, process launch, lease release or production trigger was added.
- PERSON/GROUP dispatch uses only the exact preferred kind/value. Full directory certification is required even after the first match. Repeated anchors are deduplicated only with equal typed identity projection; contradictory type/identity, late duplicates, unknown rows, missing fields and exceeded budgets fail closed.
- Candidate reacquisition and one conversation-open action share the original budget. The scoped adapter compares the fresh projection and coverage revision in the same browser JS turn before click. Current-chat type, anchor and preferred identity must match exactly; names and positions are not read as evidence.
- Opaque witnesses use private WeakMap state. DB metadata is checked before open, before final verification and after asynchronous live checks. Directory/header/self mutation observers, page/context/navigation, lease/generation, deadline and a new resolution invalidate authority. A final page observation follows the last asynchronous ownership check; observed A→B→A chat changes cannot revive a witness.
- `TARGET_RESOLVER_LOCAL_STATIC_V1` is loopback-only and requires an explicit exhaustive static directory whose direct children are typed conversation buttons. `TARGET_RESOLVER_DOM_V1` remains UNPROVEN and never clicks a live conversation. Synthetic completeness attributes cannot activate the production contract. No new public API/UI, migration, worker, send integration or credential/private-API access was introduced.

Self-review fixes covered immutable candidate observations, unknown/group-link type inference, same-anchor type conflicts, scope serialization under both tsc/tsx, page-directory epoch changes during auth/header checks, final asynchronous ownership races and prevention of fabricated NOT_FOUND from readiness/persistence failures. Focused regressions accompany those changes; no broad proof matrix was added.

Final affected-workspace verification:

| Workspace | Full tests | Typecheck | Build |
| --- | --- | --- | --- |
| shared | 30/30 PASS | PASS | PASS |
| database | 283/283 PASS | PASS | PASS |
| automation | 110/110 PASS | PASS | PASS |
| server | 452 PASS / 3 existing Linux-only SKIP / 0 FAIL (455 total) | PASS | PASS |

Changed-file ESLint/Prettier and `git diff --check` pass. Server's existing pretest/prebuild native-helper step also passes; no native source or packaging was changed. Admin-web, Docker/runtime packaging and process-recovery test additions were not needed for this internal-only milestone. Tests use fake identities, temporary DB/profile markers and intercepted local HTML; no real Douyin request, login/scan/send or Gate B was performed.

Remaining review findings: P0=0, P1=0, no new blocking P2. The previously recorded `SupervisorContract.start(): void` typing limitation is unchanged and outside this milestone. Real directory coverage/anchors/current-header identity and headless behavior remain unvalidated. Gate B is required before any live-site validation, and a separately authorized future consumer/runtime integration is required before production use. Offline verification and this witness never authorize sending.
