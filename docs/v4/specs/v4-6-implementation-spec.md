# V4-6 Implementation Specification — Delivery Verification

> Status: IMPLEMENTED / SELF-REVIEW AND OFFLINE VERIFICATION PASS
> Owner / implementer / self-reviewer: Codex (explicit user authorization)
> Baseline: `develop@d964fc4f8b3d8ead0f675a0d2c2477edb32eb5a5` (V4-5 merged by PR #45)
> Branch: `feature/v4-6-delivery-verification`
> Authority: current user → product requirements → this spec → architecture freeze/roadmap. Authorized planning, implementation, self-review/fix, offline verification and commit/push/PR; not merge/release/deploy or real-site access/sends.

## 1. Minimum scope and exclusions

Implement the roadmap's internal delivery verifier: bounded baseline and MutationObserver before action; one trusted persistence-boundary callback immediately before at most one control invocation; success only from a new outgoing plain-text bubble exactly matching the immutable known message under the same live target witness.

This is a building block, not a new send entry point. No HTTP/UI, TestSendIntent, batch coordinator, Template rendering, Run/SendRecord lifecycle, retry policy, Scheduler, worker/profile admission or migration. No real Douyin/profile/login/send, cookie/token/storage/private API, response introspection, screenshot/trace/full DOM dump or chat-body collection. Legacy MessageSender and production automation remain unchanged and gated; their count/marker/name verification is not reused.

No draft composition/clearing or Enter. The narrow adapter checks an already prepared composer for exact known text and invokes one supported button. Future V4-7 owns persisted immutable message selection/input preparation, durable boundary implementation, final persistence and admission. No production trigger is wired here.

## 2. Witness, identity and ownership

Require a genuine private-registry V4-5 ResolutionWitness, not a boolean, copied object, name/path/identity or arbitrary revalidation callback. Extend only private backing state with original page/context and immutable target/self projection; no serializable state, extended resolver deadline or relaxed resolver semantics.

Require adapter page/context equality. Revalidate before baseline/boundary and after action/evidence. The internal server wrapper also calls TargetResolutionService.revalidateCurrentChat on the same registered runtime: DB version/profile/global lease/recovered-process ownership remain binding. In the browser turn immediately before click, verify current typed header/preferred identity/anchor/self and armed mutation epoch. A→B→A changes invalidate the operation.

One witness participates in one invocation, including concurrent calls; consumed/failed/unknown authority never permits another click. Terminal truth is immutable and no retry is offered. Neither verifier nor resolver releases the owner's resources; parent cleanup proves groups stopped before release. Restart discards witnesses/observations.

## 3. Evidence contract and virtualization

Read only current mounted rows; never read inbound text. Outgoing plain text is compared in-browser against known text; retain match booleans, stable IDs/sequence/timestamp and minimal event fingerprints, not history text/DOM/node arrays or raw evidence in results/logs. Normalize only CRLF→LF; never trim/fuzzy/substring/Unicode-normalize. Sticker/rich text/unknown direction/conflicting projection cannot prove success.

The independently versioned controlled-local contract requires exhaustive static current-tail markup, ordered immutable page-provided message sequence anchors, canonical safe integers, unique IDs/sequences and a message list bound to the selected conversation anchor. Explicit current-tail evidence is necessary; counts/scroll-bottom are not evidence.

Newness requires a direct appended row observed after the adapter's action-start sequence, outgoing exact plain text, sequence strictly after the baseline/current-tail anchor, and either a new stable ID or an unseen matching fingerprint with reliable sequence/tail anchor plus append proof. Exactly one qualifying observation is required. New ID alone is insufficient when unloaded history/remount cannot be excluded. Same-text history without reliable ID/anchor is unknown.

Remounted baseline IDs/fingerprints and unseen historical rows behind the tail are not new. Count decreases do not suppress a genuine anchored bubble (V3 false-negative regression). Pre-click additions, including additions during the persistence callback, are drained into the baseline before click. Retain minimal immutable event evidence; once before timeout reconcile only current DOM against recorded append witnesses, never scroll/read history or manufacture an append proof. Ambiguity, conflicting anchors, observer overflow and uncertainty stay terminal unknown.

Production has no verified message/tail/action contract: its factory fails closed before callback/click. Fixture markers work only on controlled loopback `/chat`, never Douyin origin. Live support requires separately authorized evidence/contract work, not an offline fixture claim.

## 4. State machine, action boundary and deadline

```text
validate immutable known message + genuine live same-page/runtime witness
 → baseline + arm observer
 → exact prepared composer + unique supported control
 → witness/DB/DOM pre-boundary recheck
 → invoke one trusted durable boundary callback
 → witness/DB/DOM recheck + flush pre-click mutations
 → at most one control invocation
 → observe + bounded current-DOM reconciliation
 → final witness/DB/DOM check → SUCCESS | DELIVERY_UNKNOWN

Confirmed failure before callback invocation → FAILED
```

The callback is a deliberate internal persistence port, not public/test arbitrary Page/message/identity code. Future caller resolves it only after durable sendActionStartedAt/CAS success. Once invocation begins, persistence may have happened: rejection/hung/uncertain acknowledgement is DELIVERY_UNKNOWN, with no UI invocation. All failures after this boundary (including guard preventing click) are unknown, never FAILED/retry. Click rejection/timeout is unknown, not proof that no send occurred.

SUCCESS requires confirmed boundary callback, one UI invocation, exactly one qualifying post-action bubble and unchanged live target/runtime/snapshot. Click resolved, composer cleared, toast/network response, inbound/history/sticker/nonmatch do not establish success. Safe result exposes status, allowlisted reason, boundary state and invocation count 0/1; no raw evidence or retry authorization.

Default verification budget 15s, maximum 30s; controlled tests may shorten it. Overall caller deadline capped at 60s includes preparation/persistence/revalidation/browser waits, with monotonic as well as wall limits. Verification starts at boundary invocation, not click completion. All awaits and observer disposal are bounded; timeout forbids further actions. The browser closure also has a monotonic action deadline and disposed/one-shot state to reject queued/late clicks. Timeout does not release runtime leases.

## 5. Files and internal interface

- `packages/shared/src/DeliveryVerification.ts`: safe result/reasons/exact normalization, distinct from legacy types.
- `packages/automation/src/douyin/delivery/{types,DeliveryVerifier,DouyinDeliveryPage}.ts`: bounded action/observation ports, genuine witness checks, proven loopback adapter and unsupported live factory.
- Private witness registry and resolver issuance: page/context/target/self binding; backing state never exported through package barrels.
- `apps/server/src/automation/DeliveryVerificationService.ts`: existing runtime/witness DB revalidation wrapper, no main/ApiApplication/worker wiring or durable boundary implementation.
- Focused shared/automation/server tests; V4 spec/index/roadmap/API/architecture notes. No database/frontend/native/Docker implementation change.

## 6. Risk-focused invariants / acceptance evidence

| Invariant | Failure | Guard / focused proof |
| --- | --- | --- |
| Genuine same-page current target | forged/cross-page/stale witness, DB/lease drift | real resolver fixture, registry/application rechecks, temporary DB tests |
| Observer precedes action | synchronous click append, callback-period append | observer armed/drain-before-click; ordering/counter tests |
| New outgoing exact bubble only | inbound, whitespace mismatch, clearing/toast, sticker/history | strict direction/text/tail/append fixtures; zero false SUCCESS |
| Virtualization safety | baseline remount, unseen old ID, count drops, no-ID history | ID/fingerprint/sequence reconciliation; V3 regression |
| At most one boundary/control | concurrent/replayed request, uncertain persistence/click | one-shot authority, exact counters, no retry after boundary |
| Conservative terminal truth | timeout/close/navigation/auth/list/observer failure | pre-boundary FAILED vs post-boundary UNKNOWN, no later click |
| Bounded privacy/resources | hung await/unbounded rows/events/body leaks | caps/deadline/disposal and safe result serialization |

Tests use intercepted local HTML, disposable browser contexts, fake text/identities and temporary DB/profile markers. No broad proof matrix or real-site test. Final verification: full affected shared/automation/server tests/typecheck/build and changed-file lint/format/diff checks. Existing native pretest/prebuild may run; no unrelated admin-web/Docker/full-repository gate.

## 7. Fixed implementation order and delivery

1. Freeze spec and shared result/normalization contract.
2. Private live witness binding and bounded action/verification ports.
3. Baseline/observer, strict newness/virtualization evidence and scoped local adapter.
4. One-shot boundary orchestration and internal application wrapper.
5. Focused real local DOM/state tests, self-review/fix.
6. Affected workspace verification, scope/privacy checks and limitations record.
7. Commit `feat: add V4-6 delivery verification`, push feature branch, PR → develop; no merge.

STOP for changed frozen semantics/major architecture, expansion to Test Send/Scheduler, real-site/real sends or merge/release/deploy. Unsupported live evidence does not block safe internal delivery: keep it fail closed.

## 8. Implementation, review and verification record

Implemented on the branch/baseline above. Core contract (Sections 1–7) is unchanged.

- Shared safe summaries are strict SUCCESS / pre-boundary FAILED / post-boundary DELIVERY_UNKNOWN. Known text normalization is CRLF→LF only; reasons are frozen/allowlisted and results exclude message/identity/evidence.
- Witness backing binding is package-private; no backing getter/issuer is exported through package barrels. Verifier verifies the actual registry entry and page/context, preserving original resolver expiry. The server wrapper revalidates the existing runtime and read-only Account/Contact/preferred snapshot. No DB/schema/HTTP/UI/production wiring changed.
- Per-witness consumption and per-page active ownership prevent concurrent/replayed boundary/click. Canonical terminal summaries are historical results, not new authority; a different message cannot replay SUCCESS. Terminal replay state retains only a private message digest, not plaintext.
- Observer is armed before persistence/action and drained before click. Input/control/list are target-bound, unique and supported; the adapter reads but never fills/clears input or presses Enter. One browser-turn check precedes one click. Pre-click additions, inbound/rich/sticker/hidden/mismatched bubbles, reused IDs, historical/remounted sequence anchors and conflicting projections cannot create success.
- Evidence is independent of current counts. The matching new message remains provable when mounted history shrinks. No-ID success requires an unseen exact-match fingerprint plus trustworthy sequence/tail and append proof; unanchored history fails closed before action.
- Overall/verification/cleanup awaits are bounded. A delayed arm acknowledgement remains owned until its real observer handle is disconnected. Unproven teardown returns unknown and retains page reservation; no profile/global lease release is performed. Final live/DB checks follow the last asynchronous evidence and cleanup, preventing stale SUCCESS during those waits.
- Self-review fixes: final evidence/cleanup snapshot race, early canonical-result publication, callback-period mutation attribution, target-bound composer/control, hidden/rich-text proof rejection, structured browser error codes rather than parsing driver strings, and pending arm-handle ownership. Focused negative/concurrency fixtures cover these branches.

| Affected workspace | Full tests | Typecheck | Build |
| --- | --- | --- | --- |
| shared | 33/33 PASS | PASS | PASS |
| automation | 136/136 PASS | PASS | PASS |
| server | 456 PASS / 3 existing Linux-only SKIP / 0 FAIL (459 total) | PASS | PASS |

Changed-file ESLint/Prettier and git diff --check PASS. Existing server native-helper pretest/prebuild PASS; no helper/packaging change. Unchanged database/admin-web/Docker/full-repository tests were not run. Added high-risk tests: 3 shared + 9 verifier state/ownership + 17 real offline DOM + 4 server DB/ownership tests; accepted V4-5 tests remain green. Synthetic actions occur only on intercepted loopback HTML; no real Douyin/profile/login/discovery/send or Gate B was used.

Remaining findings: P0=0, P1=0, no new P2. Existing non-blocking SupervisorContract.start() void/async typing is unchanged. Limitations: production DOM/message IDs/sequences/current-tail/composer/control behavior are not live-verified; the live factory is intentionally unsupported and cannot invoke a boundary or click. Local static contract is not a claim of production virtualization support. Future V4-7 must supply a durable CAS boundary, persisted immutable message selection/input preparation and worker-local witness integration under existing admission/cleanup gates. Gate B permits no sends; real delivery validation requires separately authorized Gates C/D/E. No merge/release/deploy is part of this delivery.
