# V4-3 Implementation Specification — Douyin Account Onboarding

> Status: MERGED / ACCEPTED (PR #43; merge commit `e5a3e925c0a6b2436a68679d0ca44d804c2e5a2f`)
> Spec owner / reviewer: Codex
> Implementer: Development Agent
> Starting branch: `develop`
> Starting commit: `154156299be06ecb77ab643e459cda8d2e337c58`
> Required implementation branch: `feature/v4-3-account-onboarding`
> V4-1 state: `V4_1_MERGED` (`8a349addf932bc868b7f10011684791c9157aa3f` via PR #41)
> V4-2 state: `V4_2_MERGED` (`154156299be06ecb77ab643e459cda8d2e337c58` via PR #42)

## 1. Objective

Implement the first complete Douyin Account onboarding vertical slice on top of the accepted V4-1 data foundation and V4-2 Admin authentication foundation.

After V4-3, an authenticated Admin can start exactly one global ADD_ACCOUNT or RELOGIN flow, open a same-origin authenticated noVNC console, complete Douyin QR login manually, cancel while the flow remains interactive, and observe a durable terminal result. A successful ADD_ACCOUNT flow produces one Account-owned persistent browser profile and one READY `DouyinAccount`; a successful RELOGIN flow refreshes the explicitly selected Account without creating another Account.

V4-3 is onboarding only. It creates no Contact, resolves no target, sends no message, enables no Scheduler, and does not use a private Douyin API or extract credentials.

Normative precedence remains [the V4 workflow](../00-development-workflow.md#1-权威顺序). This document is the milestone authority for V4-3. V4-1 and V4-2 are accepted dependencies and are not reopened.

## 2. Scope

Included:

- Account-owned persistent-profile locator, marker, preparation, exclusive lease, quarantine and reconciliation;
- durable `AccountLoginSession` admission, idempotency, runtime, TTL, cancel and restart recovery;
- one global login/relogin flow at a time across all Accounts and Admin users;
- one supervised worker process per active LoginSession;
- headed Chromium plus loopback-only Xvfb/Openbox/x11vnc/websockify orchestration;
- same-origin authenticated console HTML/assets/WebSocket gateway;
- user-driven QR login and ordinary challenge handling through the remote console;
- READY detection and minimum public account-identity extraction;
- atomic database boundaries around the non-transactional same-filesystem profile rename;
- ADD_ACCOUNT, RELOGIN, status, active-session, cancel and console APIs;
- minimal Accounts/LoginSession UI;
- focused state-machine, concurrency, crash-recovery, process and security tests;
- required container/runtime packaging and documentation.

## 3. Explicit non-goals

The Development Agent must not implement or begin:

- Contact Discovery, Contact Sync, Avatar/Streak ingestion or Contact UI;
- Stable Target Resolver or any identity-to-chat target resolution;
- Test Send, Manual Run, real send, Delivery Verification or message composition;
- Scheduler, SendTask execution or release-gate enablement;
- `/accounts/:accountId/auth-checks` or any background auth-check operation;
- user-facing unbind, hard-delete, profile-delete or quarantine-purge API;
- private/undocumented Douyin HTTP APIs;
- cookie, token, localStorage, sessionStorage, credential or browser-storage extraction;
- network interception, CDP storage inspection, HAR capture or response-body scraping;
- CAPTCHA solving, automated challenge handling, SMS retrieval, risk-control bypass, password filling or automatic login;
- real Douyin access in automated tests;
- public exposure of VNC, websockify, X11 or application-internal ports;
- multi-instance coordination, Docker socket access or per-login dynamic containers;
- production TLS/Caddy rollout, deployment or release.

`SCHEDULER_ENABLED`, Manual Run and real-send gates remain false. V4-3 does not change their semantics.

## 4. Accepted foundation and bounded schema change

V4-3 reuses the accepted V4-1 entities and transitions:

- `DouyinAccount` profile states: `PROVISIONING | READY | MIGRATION_REQUIRED | MISSING | QUARANTINED`;
- login statuses: `READY | AUTH_EXPIRED | UNKNOWN`;
- `AccountLoginSession` purposes: `ADD_ACCOUNT | RELOGIN`;
- session statuses: `PENDING | STARTING | AWAITING_USER | READY_DETECTED | COMPLETING | COMPLETED | EXPIRED | CANCELLED | FAILED`;
- the V4-1 active-session transaction and failure-code allowlist;
- append-only `AuditEvent` actions.

V4-3 requires migration `0009` only to make start-request idempotency durable:

```text
account_login_sessions.idempotency_key_digest TEXT NULL
UNIQUE(created_by_admin_user_id, idempotency_key_digest)
  WHERE idempotency_key_digest IS NOT NULL
```

The request value is 1–128 printable ASCII characters after exact validation. Persist only its SHA-256 digest; never log the raw key. It is scoped by Admin user and this endpoint. A repeated key with the same canonical `{purpose, accountId?}` returns the canonical session; the same key with a different canonical request returns `409 IDEMPOTENCY_CONFLICT`.

No Account/Profile state, session status, failure code or audit-action enum is added in V4-3. If implementation proves another persistent column or enum is required, stop with `SPEC_BLOCKER` rather than extending the model ad hoc.

## 5. Architectural boundary

V4-3 must form one deep application module:

```text
HTTP routes / SparkKeeper lifecycle
               │
               ▼
      AccountOnboardingManager
       ├─ AccountOnboardingRepository
       ├─ AccountProfileStore
       ├─ BrowserOperationCoordinator
       ├─ LoginWorkerSupervisor
       └─ DouyinAccountIdentityExtractor
```

### 5.1 AccountOnboardingManager

The manager is the only application-level owner of LoginSession runtime and exposes cohesive operations equivalent to:

- `start(request, actor, idempotencyKey)`;
- `findActiveFor(actor)`;
- `get(sessionId, actor)`;
- `cancel(sessionId, actor, expectedUpdatedAt)`;
- `recoverOnStartup()`;
- `stopForShutdown()`.

Routes do not manipulate processes, profiles or repository transitions directly. The manager receives interfaces through composition-root injection; it does not construct concrete database, Playwright or child-process dependencies internally.

### 5.2 AccountOnboardingRepository

This focused database adapter owns the atomic operations that span LoginSession, Account and AuditEvent. It may compose accepted repository behavior internally, but callers see aggregate outcomes, not ordered low-level writes.

Required atomic operations:

1. admit or replay one idempotent session while serializing the global active-session check;
2. compare-and-set cancel or expire from a cancellable state plus Audit;
3. compare-and-set READY detection;
4. begin ADD completion by inserting the reserved Account as `PROVISIONING` and moving the session to `COMPLETING`;
5. finish ADD completion as Account `READY` plus session `COMPLETED` plus Audit;
6. begin/finish RELOGIN completion without creating another Account;
7. classify a recovery snapshot and persist one safe repair result;
8. fail a session with an allowlisted failure code and safe Audit reason.

Generic `AccountRepository.create()`, which generates another UUID, must not be used for ADD completion. The aggregate inserts the session's reserved `pendingAccountId`.

### 5.3 AccountProfileStore

The profile store accepts identifiers and operation intent only. No HTTP DTO, route or worker message may supply an arbitrary filesystem path.

It owns path derivation, boundary checks, directory permissions, marker I/O, same-filesystem rename, quarantine and reconciliation inspection. It never opens Chromium.

### 5.4 LoginWorkerSupervisor

The supervisor starts, observes and stops one child worker; translates typed worker events into manager calls; and guarantees bounded teardown of all descendants. It never writes database state by itself.

### 5.5 DouyinAccountIdentityExtractor

The extractor is implemented in `@sparkkeeper/automation`. It returns a validated domain result or a typed unavailable/conflict result. It has no persistence, Account selection or filesystem responsibility.

## 6. Account-owned persistent-profile lifecycle

### 6.1 Fixed paths

All paths are below one configured and resolved root:

```text
<DATA_DIR>/browser-profiles/
  <accountId>/
  .onboarding/<loginSessionId>/
  .quarantine/<accountId>-<UTC timestamp>-<random suffix>/
```

Rules:

- `accountId` and `loginSessionId` are canonical UUIDs before path construction;
- `realpath`/resolved-parent boundary checks prevent traversal and symlink escape;
- the root, staging root and quarantine root must be on one filesystem;
- directories are private (`0700` where supported); ownership-marker files are `0600`;
- finalization uses one atomic rename; `EXDEV`, copy fallback and merge-over-existing are forbidden;
- final path must be absent before a staging rename;
- Account A can never open Account B's final path;
- only a held profile lease may start a browser on that directory.

### 6.2 Ownership marker

Every V4-managed profile contains `.sparkkeeper-profile.json`, atomically written and replaced:

```json
{
  "version": 1,
  "accountId": "uuid",
  "createdByLoginSessionId": "uuid"
}
```

The marker contains ownership identifiers only. It must never contain Douyin identity, URL, cookie, token, credentials, timestamps derived from page activity or browser contents.

For ADD_ACCOUNT, staging begins with the reserved `pendingAccountId`. The marker remains valid after rename. For an existing Account, the final marker's `accountId` must exactly match the requested Account.

A missing, malformed, mismatched or symlinked marker is not repaired by guessing. The profile is unavailable and the flow fails closed or moves the directory to quarantine where the exact owning operation makes that move safe.

### 6.3 ADD_ACCOUNT

ADD always uses `.onboarding/<loginSessionId>`. It never opens the V3 global profile or another final Account profile.

The staging directory is created only after the durable session exists and the global browser slot is held. On terminal cancel/expire/failure, a non-empty staging profile is closed and atomically moved to quarantine using the reserved Account ID. Empty directories may be removed only after verified boundary/marker checks.

### 6.4 RELOGIN

RELOGIN is bound to one existing active Account.

- `profileState=READY`: validate marker and open the final profile in place under its exclusive lease.
- `profileState=MISSING` or `MIGRATION_REQUIRED`: create an isolated staging replacement; never claim or copy the legacy global profile. On success it follows the same `PROVISIONING`/rename/`READY` protocol without creating another Account.
- `profileState=PROVISIONING`: reject ordinary start and require startup reconciliation first.
- `profileState=QUARANTINED` or lifecycle `UNBOUND`: reject with `STATE_CONFLICT`.

If an expected final path exists but cannot prove ownership, move it to quarantine only through a safe, audited recovery/preparation operation, then use new staging. Never overwrite it.

### 6.5 Lease and retention

The process-wide `BrowserOperationCoordinator` supplies:

- one global browser-operation lease for all login/relogin/send/sync operation classes;
- one account/profile lease for final profiles;
- one session lease for staging profiles;
- ownership tokens required for release, preventing one operation from releasing another's lease.

The database active-session invariant is durable admission truth; in-memory leases protect live processes and paths. Both are required.

Quarantine retention remains the frozen default of 30 days. V4-3 does not add automatic deletion or a public purge path.

## 7. LoginSession runtime and state machine

### 7.1 TTL

- TTL is exactly 15 minutes from durable `createdAt` to `expiresAt`.
- It is not sliding and is never extended by status polling, console access, QR progress, worker restart or server restart.
- The worker and every console request compare the database `expiresAt` with the injected server clock.
- At expiry, the manager wins one compare-and-set transition to `EXPIRED` only from `PENDING`, `STARTING` or `AWAITING_USER`.
- After `READY_DETECTED`, completion is allowed to finish beyond the interactive TTL; console access is already closed.

### 7.2 Normative transition graph

```text
PENDING ──start──> STARTING ──console ready──> AWAITING_USER
   │                  │                            │
   ├─cancel/expire    ├─cancel/expire             ├─cancel/expire
   └─failure          └─failure                   └─failure
                                                   │
                                                   └─READY CAS
                                                        ▼
                                                READY_DETECTED
                                                        │
                                                close worker/profile
                                                        ▼
                                                   COMPLETING
                                                        │
                                                 DB/rename/DB
                                                        ▼
                                                   COMPLETED

Any non-terminal operational error on an allowed edge ──> FAILED
```

`COMPLETED`, `EXPIRED`, `CANCELLED` and `FAILED` are terminal.

### 7.3 Cancel-versus-READY race

Cancel is accepted only from `PENDING`, `STARTING` or `AWAITING_USER`, with `expectedUpdatedAt` compare-and-set semantics.

- If cancel commits first, the worker is stopped and a later READY event is ignored.
- If READY commits first, cancel returns `409 STATE_CONFLICT`; the manager closes the console and continues completion.
- UI button state is advisory only; database compare-and-set determines the winner.

### 7.4 Global admission

At most one active LoginSession exists across all purposes, Accounts and Admins. Start admission occurs in the existing immediate SQLite transaction before any directory or process is created.

If another active session exists:

- return `409 LOGIN_SESSION_ACTIVE` with its safe session summary only when it belongs to the current Admin;
- otherwise return the same conflict code without exposing owner or target Account details.

An idempotent replay of the same canonical request is returned before reporting a global conflict. No duplicate worker is started. Until later browser-operation milestones adopt the shared coordinator, V4-3 start also fails `503 RELEASE_GATE_CLOSED` if Scheduler, Manual Run or real-send gates are enabled.

## 8. Worker and process orchestration

### 8.1 Process model

One Node child worker is spawned per live LoginSession after `PENDING` is durable and both leases are acquired. It receives one validated immutable startup message:

```text
sessionId, purpose, accountId/reservedAccountId,
validated AccountProfileStore-derived profile path/kind,
expiresAt, controlled feature flags
```

It does not receive raw Admin cookie/session/CSRF values, database credentials, arbitrary commands, arbitrary paths or external callback URLs.

The worker owns this process tree:

```text
worker
├─ Xvfb (dynamic display, loopback/local socket only)
├─ Openbox
├─ x11vnc (loopback dynamic port)
├─ websockify (loopback dynamic port)
└─ headed Chromium through BrowserSession
```

Use argument arrays and controlled environment variables; no shell interpolation. Dynamic display/ports are collision-checked, bounded and retained only in supervisor memory.

### 8.2 Typed IPC

Allowed worker-to-parent events are a discriminated union such as:

- `WORKER_STARTED`;
- `CONSOLE_READY` with a validated loopback endpoint descriptor retained only in supervisor memory, never a public URL;
- `AWAITING_USER`;
- `READY_DETECTED`;
- `IDENTITY_EXTRACTED` with the typed minimum result;
- `WORKER_FAILED` with an allowlisted failure code;
- `WORKER_EXITED`.

The parent validates message shape, session ID, expected current state and monotonic event order. Unknown, oversized or out-of-order messages terminate the worker and fail safely.

### 8.3 Start and teardown

Start sequence:

1. durable `PENDING` session;
2. acquire global and profile/session leases;
3. prepare/validate profile and marker;
4. compare-and-set `STARTING`;
5. spawn display, window manager, VNC bridge and Chromium;
6. publish in-memory console endpoint;
7. compare-and-set `AWAITING_USER`;
8. monitor readiness until READY, cancel, expiry or failure.

Teardown is idempotent and bounded: close Playwright context, terminate Chromium descendants, stop websockify/x11vnc/Openbox/Xvfb, wait a short bounded grace period, force only known child PIDs if needed, clear endpoint handles, then release leases. It never uses broad `pkill`, PID-name matching or host-wide process cleanup.

On controlled application shutdown, the manager stops live processes but leaves the durable active session non-terminal for startup recovery. An unexpected worker/process exit while the application remains running transitions to `FAILED/PROCESS_EXITED`.

### 8.4 Runtime packaging

The application runtime image must contain the existing noVNC/Openbox/websockify/x11vnc/Xvfb capabilities. The maintenance image may inherit them; packages must not be duplicated unnecessarily.

Do not stop the SparkKeeper app to expose a console. Do not publish 5900/6080. Do not mount the Docker socket. The existing process-lifetime legacy global-profile flock remains a deployment guard but is not the V4 Account lease implementation.

## 9. Authenticated console gateway

### 9.1 Routes and authorization

Console shell, assets and WebSocket are same-origin application routes. Every request/upgrade verifies:

- a currently valid V4-2 AdminSession;
- LoginSession existence;
- `createdByAdminUserId` equals the authenticated Admin ID;
- status is `STARTING` or `AWAITING_USER`;
- interactive TTL has not expired;
- supervisor endpoint and required leases still belong to that LoginSession;
- exact configured Host/authority and Origin;
- for WebSocket, `Sec-Fetch-Site: same-origin` where supplied and the expected subprotocol/path.

The gateway proxies the browser's WebSocket to the loopback websockify endpoint. It never redirects to websockify and never returns an internal port, display ID, VNC password or bearer token.

### 9.2 Browser shell

The shell serves a pinned local noVNC client asset set. It has:

- `Cache-Control: no-store` for HTML and authenticated private asset delivery;
- strict CSP limited to same-origin scripts/styles/connect plus required local resources;
- `frame-ancestors 'none'` and `X-Frame-Options: DENY`;
- `Referrer-Policy: no-referrer`;
- no analytics, CDN, remote font or third-party script;
- no credential form, clipboard automation, file upload or download UI.

One console WebSocket is allowed per LoginSession. A new valid owner connection replaces and closes the previous connection so refresh/reopen remains recoverable. The server revalidates auth/session/TTL/ownership at least every 5 seconds and closes immediately on terminal transition, logout/session invalidation, lease loss or worker exit.

### 9.3 noVNC boundary

x11vnc and websockify bind loopback only. VNC-layer credentials are not sent to the browser because the authenticated application gateway is the access-control boundary. Internal endpoints exist only in supervisor memory.

QR screenshots, video, framebuffer dumps, VNC frames, console URLs and internal endpoints are never persisted in database, files, logs, AuditEvent or frontend storage.

## 10. READY detection and Douyin identity extraction

### 10.1 Readiness

Reuse `AuthDetector` classification and safe selectors where valid. Do not use `DouyinChatPage.open()` as the onboarding controller because it assumes a production automation/navigation contract rather than an interactive login loop.

The worker may inspect the normal rendered page at a bounded interval. READY requires positive authenticated-page evidence. Absence of a login QR alone is insufficient. Ambiguous evidence remains `UNKNOWN` until TTL; explicit login-page evidence remains unauthenticated without mutating an existing Account until terminal outcome.

### 10.2 Allowed identity source

After READY, extract only from normal, already-rendered public account UI/DOM or page state already required to render that UI:

```text
displayName: required
douyinSecUid: one of secUid/uniqueId is required
douyinUniqueId: one of secUid/uniqueId is required
douyinShortId: optional
avatarRemoteUrl: optional, validated http/https URL
```

No cookies, authorization headers, token-like values, local/session storage, IndexedDB, service-worker storage, network interception, response-body scraping or private endpoints may be read.

Validate and bound each value before it leaves the worker. Failure to establish `displayName` and at least one stable identifier yields `FAILED/PROFILE_IDENTITY_UNAVAILABLE`.

### 10.3 Identity ownership rules

ADD_ACCOUNT:

- exact existing `douyinSecUid` collision fails;
- when secUid is absent, exact existing non-null `douyinUniqueId` collision fails at the aggregate boundary;
- a collision never updates the existing Account or claims its profile;
- the staging profile is quarantined and the session fails `PROFILE_IDENTITY_CONFLICT`.

RELOGIN:

- when the Account already has `douyinSecUid`, extracted secUid must match exactly;
- otherwise, when it has `douyinUniqueId`, extracted uniqueId must match exactly;
- when a legacy Account has neither, the explicitly targeted RELOGIN may establish the first stable identity;
- weaker/optional values never override a conflicting stable value;
- successful metadata refresh is atomic with completion.

Identity values and remote avatar URLs never enter logs, list DTOs, AuditEvent metadata or failure messages.

## 11. Completion and filesystem reconciliation

### 11.1 ADD_ACCOUNT happy path

After READY and successful extraction:

1. close console and browser; prove no process holds the staging profile;
2. transaction A:
   - compare-and-set session `READY_DETECTED → COMPLETING`;
   - insert Account using `pendingAccountId`;
   - set `profileState=PROVISIONING`, `loginStatus=UNKNOWN`, lifecycle `ACTIVE`;
   - store validated identity metadata;
3. fsync marker/directory where supported and atomically rename staging to final;
4. transaction B:
   - verify session/Account/identity still match the completion intent;
   - set Account `profileState=READY`, `loginStatus=READY`, `lastLoginAt` and `lastAuthCheckAt`;
   - set session `COMPLETED` and `completedAt`;
   - append `ACCOUNT_CREATED` successful AuditEvent;
5. release leases and expose `resultAccountId`.

The Account is not returned in normal READY lists while `PROVISIONING`.

### 11.2 RELOGIN happy path

In-place READY profile:

1. close browser and console;
2. one aggregate transaction moves session through `COMPLETING` to `COMPLETED`, refreshes validated metadata, sets `loginStatus/profileState=READY`, updates auth/login timestamps, and appends `ACCOUNT_RELOGIN_COMPLETED`;
3. release leases.

Staging replacement for `MISSING`/`MIGRATION_REQUIRED` uses the same transaction A → rename → transaction B protocol as ADD, but updates the existing Account and never creates another Account or changes history ownership.

### 11.3 Rename rules

- Rename occurs only after browser teardown and transaction A commit.
- The destination must not exist.
- No copy-then-delete fallback exists.
- Failure does not roll back transaction A; it leaves an explicit `PROVISIONING/COMPLETING` recovery point.
- Transaction B never runs unless final ownership is proven by the marker.

### 11.4 Recovery matrix

On server startup, before accepting a new LoginSession, recover the one durable active session under the global coordinator:

| Durable state | Filesystem/process observation | Required result |
| --- | --- | --- |
| `PENDING` | before expiry | acquire leases and start worker |
| `STARTING` / `AWAITING_USER` | before expiry; profile marker valid | stale processes are presumed dead; restart one worker on the same profile |
| `PENDING` / `STARTING` / `AWAITING_USER` | expired | transition `EXPIRED`; quarantine staging; never start worker |
| `READY_DETECTED` | profile valid, before completion | restart a bounded completion worker if identity must be re-extracted; otherwise continue only from durable/provable data |
| `COMPLETING` | staging exists, final absent, matching marker | retry the atomic rename, then transaction B |
| `COMPLETING` | staging absent, final exists, matching marker | treat rename as completed; run transaction B |
| `COMPLETING` | neither path exists | Account `MISSING`, session `FAILED/FINALIZE_FAILED` |
| `COMPLETING` | both paths exist | fail closed; do not overwrite; quarantine only paths whose ownership is provable; Account `QUARANTINED` or `MISSING`, session failed |
| any active state | marker/path mismatch or symlink escape | fail `INTEGRITY_ERROR`; no browser start, rename or deletion |

Recovery must be idempotent: interrupting recovery at the same boundary and restarting again converges to the same terminal/provisioning result. It never declares READY based only on a directory name.

For ADD, identity required by transaction A is already stored on the PROVISIONING Account. Before transaction A there is no durable identity payload by design; a recovered `READY_DETECTED` session must safely reopen the owned staging profile and re-extract it.

## 12. Cancel, expiry and failure cleanup

Cancellation and expiry share a cleanup orchestrator but retain distinct terminal statuses and Audit outcomes.

Order:

1. win the durable compare-and-set;
2. deny/close new and existing console connections;
3. request worker stop and perform bounded teardown;
4. prove the profile is no longer open;
5. quarantine non-empty staging data under marker/boundary checks;
6. clear supervisor endpoint and release leases;
7. append the matching safe AuditEvent in the aggregate transaction where defined.

Cleanup is retryable and idempotent. A terminal session never becomes active again. Cleanup failure is logged only with session ID and allowlisted reason; it does not rewrite `CANCELLED`/`EXPIRED` to another terminal status. Startup housekeeping retries safe quarantine for a terminal session whose staging directory remains.

Failure mapping uses existing codes:

| Boundary | Failure code |
| --- | --- |
| display/browser spawn | `START_FAILED` |
| global/profile lease | `PROFILE_LEASE_CONFLICT` |
| marker/path/staging preparation | `PROFILE_PREPARE_FAILED` or `INTEGRITY_ERROR` |
| VNC/websockify/console endpoint | `CONSOLE_START_FAILED` |
| TTL before READY | terminal `EXPIRED` (`READY_TIMEOUT` only for an internal non-TTL readiness timeout if retained) |
| explicit non-ready classification at required boundary | `AUTH_NOT_READY` |
| required identity absent | `PROFILE_IDENTITY_UNAVAILABLE` |
| stable identity collision/mismatch | `PROFILE_IDENTITY_CONFLICT` |
| unexpected live worker exit | `PROCESS_EXITED` |
| transaction/rename reconciliation cannot safely complete | `FINALIZE_FAILED` |
| impossible state, malformed IPC or ownership mismatch | `INTEGRITY_ERROR` |

## 13. API contract

All JSON envelopes and V4-2 S/M/I guards remain normative. Safe summaries contain no profile path, identity value, page URL, process ID or internal endpoint.

### 13.1 DTOs

```ts
type AccountLoginSessionSummary = {
  id: string;
  purpose: 'ADD_ACCOUNT' | 'RELOGIN';
  accountId: string | null;
  status:
    | 'PENDING'
    | 'STARTING'
    | 'AWAITING_USER'
    | 'READY_DETECTED'
    | 'COMPLETING'
    | 'COMPLETED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'FAILED';
  expiresAt: string;
  startedAt: string | null;
  readyDetectedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  consoleAvailable: boolean;
  cancellable: boolean;
  failureCode: string | null;
  resultAccountId: string | null;
};
```

`resultAccountId` is non-null only for `COMPLETED`. For ADD it is the reserved Account ID; for RELOGIN it is the target Account ID.

### 13.2 Endpoints

| Method / path | Guard | Request | Success | Notes |
| --- | --- | --- | --- | --- |
| `POST /api/account-login-sessions` | M + I | header `Idempotency-Key`; `{purpose:'ADD_ACCOUNT'}` or `{purpose:'RELOGIN',accountId}` | `202` summary plus relative `consolePath` | no client auto-retry; durable session precedes worker |
| `GET /api/account-login-sessions/active` | S | — | `200 {session:null|summary}` | returns only the current Admin's active summary; a foreign active flow returns `null` |
| `GET /api/account-login-sessions/:id` | S | — | `200` summary | owner only; foreign and unknown use the same `404 LOGIN_SESSION_NOT_FOUND` |
| `POST /api/account-login-sessions/:id/cancel` | M | `{expectedUpdatedAt}` | `200` summary | owner only; pre-READY CAS |
| `GET /api/account-login-sessions/:id/console` | S | HTML | console shell | owner + active + TTL + live endpoint |
| `GET /api/account-login-sessions/:id/console/assets/*` | S | fixed allowlisted path | pinned local asset | no traversal/directory listing/source map |
| `GET /api/account-login-sessions/:id/console/ws` | S + WS checks | upgrade | proxied binary stream | continuous revalidation and terminal close |

Start request validation:

- ADD rejects `accountId` and reserves a server-generated Account UUID;
- RELOGIN requires a canonical Account UUID and an `ACTIVE` Account in an allowed profile state;
- client cannot submit Account name, identity, profile path, TTL, status or console configuration;
- successful response may initially be `PENDING` or `STARTING`;
- uncertain POST outcome is resolved with active/status GET; the frontend never automatically repeats a mutation with a new key.

### 13.3 Error mapping

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 400 | `VALIDATION_ERROR` | malformed purpose, UUID, key or expected timestamp |
| 401/403 | accepted V4-2 auth/CSRF/Origin codes | Admin/session guard failed |
| 404 | `ACCOUNT_NOT_FOUND`, `LOGIN_SESSION_NOT_FOUND` | owner-safe absence |
| 409 | `LOGIN_SESSION_ACTIVE` | global active flow exists |
| 409 | `IDEMPOTENCY_CONFLICT` | key reused for a different canonical request |
| 409 | `STATE_CONFLICT`, `VERSION_CONFLICT`, `PROFILE_BUSY` | state, CAS or lease conflict |
| 410 | `LOGIN_SESSION_EXPIRED` | console/status action no longer interactive |
| 422 | `IDENTITY_UNAVAILABLE`, `IDENTITY_CONFLICT` | safe domain refusal |
| 503 | `RUNTIME_UNAVAILABLE`, `RELEASE_GATE_CLOSED` | required local runtime unavailable or unsafe gate state |

Error messages never include identity values, absolute paths, browser errors or process output.

## 14. Minimal Admin UI

V4-3 adds only the UI required to operate and observe onboarding:

### AccountsPage

- Replace legacy manual Account creation with `Add Douyin Account`.
- Generate one idempotency key per deliberate click and retain it for that pending request.
- Start ADD_ACCOUNT once, then route to the LoginSession page.
- On load/refresh, query the active-session endpoint and offer `Continue login` when owned by the current Admin.
- Display a safe global-busy message without another Admin's identity/account details.

### Account detail/overview

- Add `Relogin` only for active Accounts in an allowed state.
- The action states which Account is targeted and starts one RELOGIN request.
- Do not add auth-check, Contact Sync or unbind controls in V4-3.

### LoginSessionPage

- route: `/account-login-sessions/:id`;
- show purpose, Account context when allowed, status, fixed expiry countdown and safe failure reason;
- show `Open login console` only while `consoleAvailable`;
- open console in a separate same-origin tab; do not embed it in an iframe;
- show Cancel only while `cancellable`, submit `expectedUpdatedAt`, and handle READY race conflict;
- poll status approximately every 2 seconds while visible and slow/pause while hidden;
- stop polling on terminal state;
- on completion, link/navigate to the resulting Account;
- on reload, recover solely from server status; no browser-stored secret/runtime state.

The client does not persist CSRF, VNC information, page identity or profile data. No mutation is automatically retried after network uncertainty.

The legacy `AccountForm`/manual `POST /api/accounts` create path must be removed from V4 navigation and disabled as a V4 creation bypass. Existing read/update behavior may remain only where it does not permit a client to fabricate an onboarded Account.

## 15. Security, privacy and observability

### 15.1 Required controls

- use accepted V4-2 session, CSRF, Origin/Host and trusted-proxy behavior;
- owner-check every status, cancel, console and WebSocket access;
- exact same-origin WebSocket Origin validation; cookie authentication only, no query token;
- bound IPC payload, process output, DOM strings, identity values and URLs;
- `spawn`/equivalent with argument arrays and controlled environment;
- reject symlinks and boundary escapes before every destructive filesystem action;
- close browser before rename/quarantine;
- redact `cookie`, `set-cookie`, authorization, CSRF, token-like keys, identity, profile path, QR/frame/page data and child stderr;
- keep browser profile, DB, process scratch and console assets under ignored/runtime roots;
- prohibit screenshots, traces, HAR, video and downloads for onboarding contexts.

### 15.2 Logs and metrics

Allowed operational fields:

```text
loginSessionId, purpose, status, failureCode,
workerPhase, durationBucket, recoveryOutcome
```

Account ID may be present only where existing safe structured-log policy already permits it; no identity or path accompanies it. Raw child stdout/stderr is not forwarded to application logs. If private temporary diagnostics are required for local implementation debugging, they are disabled by default, mode-restricted, bounded and deleted on teardown; they are not acceptance evidence.

Suggested bounded metrics:

- active login session gauge (0/1);
- starts/completions/cancels/expires/failures by purpose and safe failure code;
- worker start/teardown duration;
- recovery outcome count;
- console connection count without client identity.

## 16. Legacy reuse and replacement

| Existing component | Decision | V4-3 contract |
| --- | --- | --- |
| `BrowserSession` persistent-context lifecycle | REUSE + HARDEN | inject AccountProfileStore-derived path; sanitize errors; add onboarding-safe context options |
| `AuthDetector` READY/AUTH_EXPIRED/UNKNOWN | REUSE | retain evidence semantics; use through bounded onboarding monitor |
| Douyin selectors/types | SELECTIVE REUSE | only reviewed public rendered-page selectors; add focused identity extractor |
| `DouyinChatPage` production open flow | DO NOT REUSE AS ORCHESTRATOR | it navigates/throws under send-oriented assumptions |
| `ProductionDailyTaskAutomation` | DO NOT REUSE | global profile and sending lifecycle are outside onboarding |
| `resolveBrowserSessionConfig()` global `browser-profile` | REPLACE FOR V4 | V4 callers receive a derived Account/staging profile configuration |
| maintenance Xvfb/Openbox/x11vnc/websockify/noVNC setup | REUSE IMPLEMENTATION INGREDIENTS | move capabilities into app runtime and supervise per session |
| maintenance fixed 6080 + VNC password + app stop | REPLACE | dynamic loopback endpoints behind authenticated gateway; app stays running |
| app process-lifetime `browser-profile.lock` | KEEP AS LEGACY DEPLOYMENT GUARD | not sufficient for Account/global operation leases |
| V4-1 AccountLoginSession repository/FSM | REUSE + AGGREGATE | preserve transitions; add durable idempotency and cross-table operations |
| V4-2 Admin guards/API client/auth bootstrap | REUSE | no second auth/session mechanism |
| legacy AccountForm/manual create route | REMOVE/DISABLE FOR V4 | all new Accounts come from successful ADD onboarding |

## 17. Focused test design

The implementation must use controlled local fixtures, temporary data roots and temporary SQLite databases. It must not contact Douyin or require a real browser login.

### 17.1 Database and state machine

- migration 0009 fresh/upgrade/reopen and partial unique-index proof;
- same idempotency key/same request returns one session; different request conflicts;
- concurrent start attempts across two database connections produce exactly one active session;
- all legal V4-1 transitions remain legal and illegal transitions fail;
- cancel-versus-READY compare-and-set has one winner;
- ADD completion uses reserved Account ID and atomically updates Account/session/Audit at each database boundary;
- RELOGIN updates the target and never creates another Account;
- stable identity collision/mismatch fails without overwriting an Account.

### 17.2 Manager, TTL and process lifecycle

- frozen-clock 15-minute non-renewable TTL;
- start failure, cancel, expiry, worker exit and graceful server shutdown cleanup;
- one worker only on idempotent replay/recovery;
- global coordinator rejects overlapping login/relogin and an injected other browser operation;
- process fixture proves typed IPC and bounded descendant teardown;
- no broad process kill and no lease leak after each terminal outcome.

### 17.3 Profile and crash recovery

Use a fake/temporary profile tree and inject crash points:

1. before transaction A;
2. after transaction A, before rename;
3. after rename, before transaction B;
4. after transaction B, before in-memory cleanup;
5. both paths present;
6. neither path present;
7. marker mismatch, malformed marker, symlink escape and simulated `EXDEV`.

Run recovery twice for each fixture and assert convergence. Verify there is no copy fallback, overwrite, cross-Account open or unsafe deletion.

### 17.4 Console security

- unauthenticated, foreign owner, expired, terminal and lease-lost HTTP/WS access denied;
- exact Origin/Host required for upgrade;
- no internal port/password/token in HTML, API or error output;
- strict headers and fixed asset allowlist; traversal/source-map access denied;
- WebSocket closes after terminal transition or Admin session invalidation;
- binary proxy uses only the session's in-memory loopback endpoint;
- serialized logs contain none of the seeded cookie/token/CSRF/identity/path/QR/process-output fixtures.

### 17.5 UI

- ADD and RELOGIN deliberate-click flows use one stable idempotency key and no automatic mutation retry;
- active flow recovery after page reload;
- countdown does not extend TTL;
- Cancel handles success and READY-race conflict;
- terminal completion navigates to Account;
- no manual Account-create form remains in reachable V4 UI.

### 17.6 Verification boundary

Required implementation verification is focused package tests plus normal lint/typecheck/build for touched workspaces and the repository's proportionate regression command. Do not create a giant proof matrix duplicating V4-1/V4-2. Real Douyin QR login is a later separately authorized manual Gate B and is not a condition for automated V4-3 acceptance.

## 18. Expected implementation surface

Exact filenames may be cohesively adjusted, but the implementation should stay within these boundaries.

### Shared

- existing account/login domain validators and API DTO types;
- only narrow additions for safe session summaries and idempotency validation.

### Database

- `packages/database/migrations/0009_*.sql` and Drizzle metadata;
- `packages/database/src/schema/accountLoginSessions.ts`;
- `packages/database/src/repositories/AccountLoginSessionRepository.ts` where compatible;
- new `packages/database/src/repositories/AccountOnboardingRepository.ts`;
- repository exports and focused migration/repository/concurrency tests.

### Automation

- `packages/automation/src/browser/BrowserSession.ts` and configuration seam;
- `packages/automation/src/douyin/AuthDetector.ts` selective reuse;
- new bounded identity extractor/readiness monitor and focused fixture tests;
- no changes to MessageSender, ContactResolver or send behavior.

### Server

- application module: manager, profile store, operation coordinator and worker supervisor;
- worker entrypoint/process protocol;
- console gateway and login-session routes/contracts;
- composition/lifecycle integration and safe observability;
- `apps/server/package.json` only for reviewed WebSocket/process dependencies;
- focused manager/API/security/process tests.

The expected WebSocket implementation may use the Fastify 5-compatible `@fastify/websocket` plugin and a reviewed `ws` client for the loopback proxy. Register WebSocket support before dependent routes so V4-2 hooks still protect the upgrade lifecycle. The implementation report must record exact selected versions and lockfile changes.

### Admin web

- API DTO/parser/client methods;
- AccountsPage onboarding action;
- Account detail/overview relogin action;
- new LoginSession page and router entry;
- removal/disablement of the manual create UI;
- focused UI tests and localization strings.

### Runtime packaging/docs

- Docker application-runtime packages/assets for Xvfb/Openbox/x11vnc/websockify/noVNC;
- no public port or Compose network expansion;
- `.env.example` only if a non-secret, bounded runtime setting is unavoidable;
- README/runbook notes for local runtime requirements and separately authorized manual Gate B.

Expected scope is approximately 28–40 changed files including focused tests, migration metadata, lockfile and docs. More than 40, a new service/process topology, a new persistent entity, or changes to Contact/send/Scheduler modules require re-scope before implementation continues.

## 19. Implementation sequence

1. **Contract slice** — add safe shared DTO/validators and migration 0009; keep V4-1 statuses unchanged.
2. **Database aggregate** — implement idempotent admission, atomic ADD/RELOGIN completion, cancel/expiry and recovery snapshots; prove concurrency first.
3. **Profile store/coordinator** — implement fixed paths, marker, leases, quarantine and crash matrix with filesystem fixtures.
4. **Automation seam** — harden BrowserSession path/error contract and add rendered-page readiness/identity extraction fixtures.
5. **Worker supervisor** — implement typed IPC, process tree, TTL/stop behavior and controlled fixture worker.
6. **Console gateway** — add authenticated HTML/assets/WebSocket proxy with continuous ownership/session checks.
7. **Manager/lifecycle** — connect admission, worker events, completion, cancellation, graceful stop and startup recovery.
8. **HTTP API** — expose start/active/status/cancel/console; disable the manual Account creation bypass.
9. **Minimal UI** — Accounts ADD, Account RELOGIN and LoginSession status/console/cancel flows.
10. **Focused security/recovery verification** — run only the bounded suites in §17, then touched-workspace lint/typecheck/build and proportionate regression.
11. **Independent review** — review Spec and Standards axes; no commit/push/PR/merge until separately authorized by the workflow.

Each step should leave the branch buildable. Filesystem finalization and public console access must not be wired before their fail-closed tests exist.

## 20. Acceptance criteria

V4-3 implementation is acceptable only when all are true:

- one global durable login/relogin flow is enforced under real SQLite contention;
- start idempotency survives uncertain responses and process restart;
- no Account is client-fabricated; successful ADD uses the reserved Account ID;
- every final profile has a valid matching ownership marker and exclusive Account path;
- rename interruption at either transaction boundary converges safely on restart;
- cancel and expiry stop all known child processes and cannot beat a committed READY transition;
- RELOGIN never silently changes a conflicting stable Douyin identity;
- console HTTP/WS is same-origin, authenticated, owner-bound, TTL/state-bound and loopback-backed;
- no VNC/internal port/password/query bearer is exposed;
- no token/cookie/storage/private API/CAPTCHA bypass capability exists;
- no Contact, resolver, send or Scheduler behavior is introduced or enabled;
- focused tests, touched-workspace checks and required review pass;
- implementation report lists migration, dependency, profile/recovery, security and test evidence without sensitive data.

## 21. Stop conditions

Stop and report `SPEC_BLOCKER` before implementation continues if any of these is discovered:

- the runtime cannot place staging/final/quarantine on one filesystem;
- a secure same-origin console would require publishing VNC/websockify or exposing a browser credential;
- rendered public UI cannot reliably provide `displayName` plus secUid or uniqueId without a forbidden source;
- V4-1 state/check constraints cannot express the specified crash recovery;
- V4-2 authentication hooks cannot protect WebSocket upgrades without weakening existing security;
- the existing V3 global profile must be copied/claimed automatically to make RELOGIN work;
- completion would require overwriting a final path or guessing profile ownership;
- implementation scope crosses into Contact, resolver, send, Scheduler, unbind or auth-check;
- a real Douyin account or credential is proposed as automated test input.

## 22. Implementation report contract

The Development Agent's final report must include:

- exact starting and ending commits/branch;
- changed files grouped by shared/database/automation/server/admin-web/runtime/docs;
- migration and idempotency behavior;
- state transitions and cancel-versus-READY outcome;
- process tree/teardown and console gateway behavior;
- ADD and RELOGIN profile flows;
- crash points exercised and reconciliation outcomes;
- security/privacy negative tests;
- exact test/lint/typecheck/build commands and counts;
- dependency/lockfile changes with reasons;
- explicit confirmation that no real Douyin, Contact, resolver, send, Scheduler, private API, credential extraction or risk-control bypass occurred;
- remaining limitations and whether separately authorized Gate B manual verification is still pending.

## 23. Upstream implementation references

- [Fastify WebSocket plugin](https://github.com/fastify/fastify-websocket)
- [noVNC RFB API](https://github.com/novnc/noVNC/blob/master/docs/API.md)
- [websockify](https://github.com/novnc/websockify)

These references establish integration capabilities only. Repository contracts and this Spec remain authoritative.
