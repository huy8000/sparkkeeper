# V4-2 Implementation Specification — Admin Authentication

> Status: FROZEN / READY FOR IMPLEMENTATION  
> Spec owner / reviewer: Codex  
> Implementer: Development Agent  
> Starting branch: `develop`  
> Starting commit: `8a349add1e8d302faa256e7fe3db97d592320590`  
> Required implementation branch: `feature/v4-2-admin-authentication`  
> V4-1 state: `V4_1_MERGED` (`24bd692b14cc0dd72bfd6a8b9280f6aff8df251a` via PR #41)

## 1. Objective

Turn the accepted V4-1 `AdminUser`, `AdminSession`, and `AuditEvent` persistence foundation into the first production-oriented SparkKeeper Admin authentication vertical slice.

After V4-2, an operator can create the first Admin with a hidden-stdin CLI; a browser user can log in with username/password, receive a server-managed opaque session, bootstrap the current identity, use protected Admin API/SSE routes, log out, and be rejected after expiry, revocation, Admin disablement, or session-version invalidation.

V4-2 is planning and implementation for SparkKeeper authentication only. It performs no Douyin access, browser-profile work, external messaging, real send, Scheduler enablement, production deployment, Caddy rollout, or noVNC change.

Normative precedence remains [the V4 workflow](../00-development-workflow.md#1-权威顺序). This specification narrows the older V4-2 roadmap wording under the current explicit milestone instruction.

## 2. Scope

Included:

- exact Admin username and password input contracts;
- Argon2id hashing, verification, malformed-hash classification, and upward-only rehash support;
- one-time first-Admin bootstrap CLI with hidden stdin;
- DB-backed opaque Admin sessions and session-bound CSRF proof;
- login, current-session (`me`), and logout APIs;
- session validation, expiry, revocation, version/status invalidation, and recent-auth guard primitive;
- exact Origin, Host/protocol, Fetch Metadata, JSON, CSRF, cookie, trusted-proxy, and rate-limit contracts;
- protection of every non-public Fastify API route and SSE;
- minimal Login UI, authenticated bootstrap, route guard, logout, and expired-session handling;
- auth AuditEvents, allowlisted operational logs/metrics, and sensitive-value redaction;
- shared/database/server/admin-web tests and planning/implementation documentation.

Only these routes remain public at this milestone:

```text
GET  /api/health
POST /api/auth/login
```

Static SPA assets and the client-side `/login` route remain publicly loadable. Every other `/api/**` route, including `/api/runtime/status` and `/api/events/stream`, requires a valid AdminSession.

## 3. Explicit non-goals

- Web registration, Web setup, password reset, forgotten-password flow, password-change UI/API;
- session list UI/API or arbitrary-session revoke UI/API;
- a `/api/auth/reauth` endpoint or re-auth dialog (only the foundation is implemented now);
- multiple Admin roles, RBAC, MFA/TOTP/WebAuthn, OAuth, SSO, CAPTCHA, device fingerprinting, or geo-blocking;
- Douyin QR login, `AccountLoginSession` runtime, Account onboarding, Contact work, resolver, verifier, Test Send, Task runtime, or Scheduler;
- new V3 Friend/Schedule compatibility bridges or other V3 compatibility expansion;
- Caddy, public 80/443, HSTS/CSP deployment rollout, Nginx topology change, production environment mutation, deployment, release, or noVNC changes;
- a destructive migration or redesign of accepted V4-1 tables;
- session cleanup/retention automation beyond rejecting invalid rows. Later maintenance may purge safely after retention policy is frozen.

## 4. Existing V4-1 assets reused

The implementation must reuse, not parallel or replace:

- `packages/shared/src/Admin.ts`: `AdminUserStatus`, username validation/normalization seam;
- `packages/shared/src/Audit.ts`: frozen Audit action/entity/outcome allowlists;
- `admin_users`: username/hash/status/version/failure/lock/login/password timestamps and singleton ACTIVE constraint;
- `admin_sessions`: token/CSRF digests, version, reauth/lifetime/revocation fields and timeline constraints;
- `audit_events`: append-only allowlisted security facts with no metadata JSON;
- `AdminUserRepository`, `AdminSessionRepository`, `AuditEventRepository`, typed `RepositoryError`, and `DatabaseClient.withBusyTimeout()`;
- Fastify envelope/schema/error conventions, `ApiApplication` composition root, and Pino redaction;
- Vue router, hand-written API parsers, app context, existing AdminLayout, and Vitest/jsdom harness.

No V4-1 schema inconsistency blocks V4-2. The accepted schema supports the entire milestone without destructive migration. A normal implementation is expected to add **zero migrations**. If implementation proves that a migration is unavoidable, STOP with `SPEC_BLOCKER`; do not alter `0000`–`0008` or silently add/rebuild auth tables.

The accepted `failedLoginCount`, `lockedUntil`, and `lastFailedLoginAt` columns remain unchanged for schema/history compatibility but are deliberately unused by the V4-2 authentication runtime. V4-2 neither reads nor writes them and adds no replacement persistent unknown-user limiter store.

## 5. Architecture

Use a bounded vertical slice:

```text
Admin CLI / Login page
  → Password policy + Argon2id PasswordHasher
  → AdminAuthenticationService / AdminSessionService
  → focused transactional AdminAuthRepository
  → accepted admin_users/admin_sessions/audit_events

Fastify request
  → public-login guard OR session guard
  → mutation Origin/Fetch-Metadata/JSON/CSRF guard
  → existing route handler
```

The focused database adapter is a deep aggregate boundary, not a generic service. It owns the transactions that must atomically update AdminUser/AdminSession/AuditEvent state. It may be named `AdminAuthRepository` and must expose typed outcomes rather than raw Drizzle rows/ORM access.

Required aggregate operations:

1. `bootstrapInitialAdminWithAudit` — atomically prove zero AdminUsers, insert one ACTIVE user, and insert `ADMIN_INITIALIZED`;
2. `completeAuthenticatedLogin` — compare the verified hash/version/status, optionally apply upward-only hash rehash without incrementing `sessionVersion`, update `lastLoginAt`, revoke a valid current-browser session when replacing it, create the new session, and audit success atomically;
3. `validateSession` — classify missing/revoked/expired/user-disabled/version-mismatch/valid using one caller-provided `now`, with a guarded write-throttled touch;
4. `logoutCurrentSession` — revoke an unrevoked current session and create `LOGOUT` atomically.

Credential admission/failure windows belong entirely to the bounded process-memory limiter, not this database aggregate. A known-user `LOGIN_FAILED` AuditEvent may still use the accepted Audit repository, but it must not update or consult the three legacy failure/lock columns.

Authentication services own password/session policy and translate typed repository outcomes. Routes own HTTP mapping/cookies only. Repository/infrastructure failures must never be converted to credential, CSRF, conflict, or unauthenticated business facts.

## 6. First-admin bootstrap

### 6.1 Selected design

Implement a dedicated compiled server CLI, separate from the legacy database maintenance CLI:

```text
node dist/admin-cli.js bootstrap --username <username>
```

Development invocation may be exposed as:

```text
pnpm --filter @sparkkeeper/server admin:bootstrap -- --username <username>
```

Container invocation:

```text
docker compose exec app node dist/admin-cli.js bootstrap --username <username>
```

The password and confirmation are read from stdin. With a TTY, input is read in raw/no-echo mode with backspace and Ctrl-C handling and terminal state restored in `finally`. With non-TTY stdin, read exactly two newline-terminated values without echoing or printing them. Passwords are forbidden in argv, environment variables, command output, errors, logs, shell examples, and committed defaults.

### 6.2 Exact behavior

- Run the normal database migration/inspection before bootstrap.
- Accept only `bootstrap` and `--username`; reject unknown/repeated options.
- Validate username and both password entries before hashing; mismatch exits nonzero with safe text.
- Hash once with the production PasswordHasher.
- In one `BEGIN IMMEDIATE` transaction with the auth DB contention budget, require `AdminUserRepository.count() === 0`, create exactly one ACTIVE AdminUser, and append:

```text
action=ADMIN_INITIALIZED
entityType=ADMIN_USER
entityId=<new internal id>
actorAdminUserId=<same new id>
outcome=SUCCESS
reasonCode=null
correlationDigest=null
```

- Concurrent/repeated bootstrap: exactly one can commit; every later attempt exits nonzero as `ADMIN_ALREADY_INITIALIZED` with zero mutation.
- Output only `SparkKeeper Admin initialized.` on success. Never echo username, password, hash, DB row, path, or stack.
- Bootstrap creates no session. The user must log in normally.

No reset/change/rotation command is part of V4-2. A future explicit operator flow will reuse password policy, increment `sessionVersion`, and revoke sessions.

## 7. Password and Argon2id contract

### 7.1 Username

- Stored display username is the validated input; no surrounding whitespace is accepted or silently removed at the HTTP/CLI boundary.
- Format: 3–64 ASCII characters, first character alphanumeric, remaining characters alphanumeric or `.`, `_`, `-`.
- Exact regex: `^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$`.
- Normalization: ASCII lowercase only. Authentication is case-insensitive; `Admin_1` and `admin_1` are the same username.
- Update `validateAdminUsername`/`normalizeAdminUsername` and their tests so repository and CLI/API behavior share one rule.
- The login error remains uniform; the response never says whether a well-formed username exists.

### 7.2 Password input

- Minimum 14 and maximum 256 Unicode code points.
- Do not trim, normalize, case-fold, reject spaces, or require arbitrary character classes.
- Empty, too short, too long, or non-string input is `VALIDATION_ERROR` at bootstrap; public login returns the same schema-level `VALIDATION_ERROR` for an out-of-contract body before credential lookup.
- Route body limit: 4 KiB. Schemas are strict with `additionalProperties:false`.
- Password is request-local only and is cleared from frontend state after every completed attempt and on unmount.

### 7.3 Hasher

Add server dependency `argon2` (current Node-22-compatible `node-argon2`; pin through the lockfile). Use:

```text
algorithm       Argon2id
PHC version     v=19
memoryCost      19456 KiB
timeCost        2
parallelism     1
hashLength      32 bytes
salt            crypto.randomBytes(16) per new hash
encoding        PHC string stored verbatim
```

These values match the accepted architecture and the current [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). They cap each active operation near 19 MiB, which is suitable for the intended small self-hosted VPS while still using a memory-hard password hash. Two concurrent operations therefore consume roughly 38 MiB plus library/runtime overhead.

The PasswordHasher must:

- call the library asynchronously so the JS event loop is not synchronously blocked;
- accept only an Argon2id v19 PHC string with structurally valid salt/hash and bounded parameters;
- return typed `MATCH`, `NO_MATCH`, `MATCH_REHASH_NEEDED`, `MALFORMED_HASH`, or `OPERATION_FAILED` outcomes;
- use an in-source **non-credential dummy PHC hash** with identical parameters for unknown usernames and call exactly one real Argon2 verify for every admitted login attempt;
- never include the password or PHC string in a thrown message/cause selected for logging;
- apply rehash only after a successful verify and only when any accepted security dimension is below the current floor or format is superseded; never downgrade a hash whose dimensions all meet/exceed the floor;
- update a rehash in the login transaction without changing `passwordChangedAt` or `sessionVersion` because the credential did not change.

Malformed/unsupported stored PHC and Argon2 internal/resource failure are integrity/infrastructure failures: no session, safe `AUTH_SERVICE_UNAVAILABLE`, operational error code, and never `INVALID_CREDENTIALS`.

### 7.4 Cost and DoS boundary

- A process-wide credential-work gate permits 2 active Argon2 operations and at most 8 queued operations.
- Queue wait is capped at 2 seconds; saturation returns `RATE_LIMITED` with `Retry-After: 1` before hashing.
- IP/username admission limits run before the expensive verify.
- The Development Agent must benchmark at least 20 hashes and 20 verifies in the actual development/target container available to it, print no passwords, and record median, p95, CPU/memory/container environment, Node version, and `argon2` version.
- That measurement characterizes only the recorded environment; it does **not** prove intended production/VPS latency. `p95 <=750 ms` remains the intended deployment target.
- If either observed local/container p95 exceeds 750 ms, report `PERFORMANCE_RISK / SPEC_DEVIATION`; do not lower the frozen parameters and do not access production to obtain a better measurement. Actual intended production/VPS acceptance belongs to a later explicitly authorized deployment/release gate.
- There is no false claim of a hard Argon2 execution timeout: the native operation is not safely cancellable. See §18 for the full observable budget.

Library basis: [node-argon2 README](https://github.com/ranisalt/node-argon2/blob/master/README.md) and [releases](https://github.com/ranisalt/node-argon2/releases).

## 8. Session and token contract

### 8.1 Raw values and digests

- Generate session token bytes with `crypto.randomBytes(32)` (256 bits).
- Encode raw cookie value as unpadded base64url: exactly 43 characters matching `^[A-Za-z0-9_-]{43}$`.
- Persist `tokenDigest = hex(SHA-256(rawSessionTokenBytes))`: exactly 64 lowercase hex characters.
- Never persist, log, audit, return in JSON, place in a URL, or expose in frontend JS the raw session token. Its only client delivery is the HttpOnly cookie.
- A cookie containing the DB digest cannot authenticate: it is decoded/hashed as a new raw candidate, yielding a different lookup digest.

The CSRF synchronizer value must survive page reload without raw persistence. Derive it transiently:

```text
rawCsrfToken = base64url(HMAC-SHA-256(
  key = rawSessionTokenBytes,
  data = UTF8("sparkkeeper-admin-csrf-v1")
))
csrfTokenDigest = hex(SHA-256(rawCsrfToken ASCII bytes))
```

Store only `csrfTokenDigest`. Return `rawCsrfToken` from successful login and `/api/auth/me`; frontend keeps it only in memory. Exposure of the derived proof does not reveal the 256-bit session bearer. Validate a submitted CSRF token by strict shape check, SHA-256, and `timingSafeEqual` over equal-length digest buffers.

DB token lookup is indexed equality over a SHA-256 digest. There is no raw secret comparison at that boundary; token entropy, strict input shape, and digest lookup prevent a useful timing oracle.

### 8.2 Creation, rotation, and concurrency

- Login never accepts a caller-supplied session ID/token/CSRF value.
- Successful login sets `createdAt = lastSeenAt = reauthenticatedAt = now`, `idleExpiresAt = now + 30m`, `absoluteExpiresAt = now + 12h`, and copies the current AdminUser `sessionVersion`.
- Multiple browsers may hold independent sessions. No speculative device/session cap is added.
- If the login request contains a currently valid old SparkKeeper session cookie, successful login atomically revokes that one old session as `LOGIN_REPLACED` before creating the new session. Invalid/random/expired cookies are simply overwritten after successful credential verification.
- Digest uniqueness collision is an integrity failure; generate no replacement loop that can hide RNG/DB failure.

### 8.3 Extraction and request context

- Add `@fastify/cookie` version compatible with Fastify 5 (10+), registered before auth hooks. Do not sign the cookie.
- Before parsed-cookie use, scan the raw Cookie header and reject duplicate occurrences of the selected session cookie name as `UNAUTHENTICATED`; do not accept first/last ambiguity.
- Missing, malformed, random, or unknown cookie → `UNAUTHENTICATED`.
- Auth request context contains only `adminUserId`, `username`, `sessionId`, `reauthenticatedAt`, `idleExpiresAt`, `absoluteExpiresAt`, and the one request `now`. It exposes no raw token, token digest, CSRF token/digest, password hash, IP, or User-Agent to route business handlers.

## 9. Cookie contract

Cookie mode is selected only by explicit validated `SPARKKEEPER_ADMIN_SECURITY_MODE`; never by Host, forwarded headers, TLS observation, or `NODE_ENV`.

| Attribute | Production | Development |
|---|---|---|
| Mode | `production` | `development` |
| Name | `__Host-sparkkeeper_session` | `sparkkeeper_dev_session` |
| Secure | `true` | `false` |
| HttpOnly | `true` | `true` |
| SameSite | `Strict` | `Strict` |
| Path | `/` | `/` |
| Domain | absent | absent |
| Max-Age | `43200` seconds | `43200` seconds |
| Expires | exact session `absoluteExpiresAt` | exact session `absoluteExpiresAt` |

Production mode requires an `https:` canonical origin. Development mode requires an `http:` canonical origin whose hostname is exactly `127.0.0.1`, `[::1]`, or `localhost`; any other combination fails startup. Development never uses a `__Host-` name and production never downgrades `Secure`.

On successful logout, clear with the same name/Secure/HttpOnly/SameSite/Path/no-Domain scope, `Max-Age=0`, and `Expires=Thu, 01 Jan 1970 00:00:00 GMT`. On a 401 caused by a presented invalid/expired/revoked cookie, send the same clearing cookie. Auth responses use `Cache-Control: no-store` and `Pragma: no-cache`.

Use [the Fastify cookie plugin](https://github.com/fastify/fastify-cookie) only for parsing/serialization; SparkKeeper owns token/session semantics.

## 10. Expiry and revocation

### 10.1 Lifetime

- Absolute lifetime: 12 hours from creation; never extended.
- Idle lifetime: 30 minutes from the last persisted touch, capped by absolute expiry.
- Touch throttle: 5 minutes. A valid protected request writes only when `now - lastSeenAt >= 5m`.
- Touch uses `lastSeenAt=now` and `idleExpiresAt=min(now+30m, absoluteExpiresAt)` in a guarded atomic update.
- Expiry comparison is exclusive validity: `now >= idleExpiresAt` or `now >= absoluteExpiresAt` is expired.
- Every request samples the injected UTC wall clock once. Tests use exact `Date` values; no production decision uses `Date.now()` in a second layer.

Fastify handles only API/SSE, so static assets never touch a session. SSE validates on connection and every 60 seconds; the same 5-minute write throttle applies.

### 10.2 Classification and invalidation

| Fact | Result | Server action |
|---|---|---|
| no/malformed/unknown token | `UNAUTHENTICATED` | clear only if a cookie was presented |
| idle or absolute deadline reached | `SESSION_EXPIRED` | reject, clear cookie; no attacker-amplified audit row |
| `revokedAt` set | `SESSION_REVOKED` | reject and clear |
| AdminUser DISABLED | `SESSION_REVOKED` | reject, best-effort mark row `ADMIN_DISABLED`, clear |
| `sessionVersion` mismatch | `SESSION_REVOKED` | reject, best-effort mark row `SESSION_VERSION_CHANGED`, clear |
| valid | authenticated context | optional throttled touch |

Logout revokes only the current session as `LOGOUT`. A second logout has no valid authenticated session and returns 401 while clearing the cookie again. Password change/reset and arbitrary compromised-session revocation are not exposed in V4-2, but the accepted version/revoke primitives and validation path already reject them correctly when later operator/UI flows use them.

Do not delete expired/revoked rows during request authentication; deletion would destroy useful classification/audit linkage. Cleanup is a separate bounded maintenance concern.

## 11. Auth APIs

All paths are under `/api`. JSON schemas use `additionalProperties:false`.

### 11.1 `POST /api/auth/login`

Guard: public Login guard (`L`): exact configured authority/protocol/Origin, `Sec-Fetch-Site: same-origin`, JSON, body limit, limiter; no session or CSRF required.

Request:

```json
{ "username": "Admin_1", "password": "<14-256 code points>" }
```

Success `200` + Set-Cookie:

```json
{
  "success": true,
  "data": {
    "admin": { "id": "<uuid>", "username": "Admin_1" },
    "csrfToken": "<43-char base64url>",
    "idleExpiresAt": "<ISO timestamp>",
    "absoluteExpiresAt": "<ISO timestamp>",
    "recentlyReauthenticated": true
  }
}
```

Rate: §14. Audit: success `LOGIN_SUCCEEDED`; admitted known-user credential failure `LOGIN_FAILED`. Unknown-user failures are bounded operational security events, not durable rows.

Errors: `VALIDATION_ERROR` 400, `ORIGIN_REJECTED` 403, `INVALID_CREDENTIALS` 401, `RATE_LIMITED` 429 with integer `Retry-After`, `SERVICE_NOT_INITIALIZED` 503, `AUTH_SERVICE_UNAVAILABLE` 503.

Unknown username and wrong password have identical 401 code/message/body shape, no cookie, the same process-memory limiter classes, and exactly one real Argon2 verification using dummy vs stored PHC. Do not claim perfect wall-clock equality: a known-user failure may write its accepted AuditEvent while an unknown-user failure deliberately does not create unbounded durable data. Neither path reads or writes persisted AdminUser lock/failure state.

### 11.2 `GET /api/auth/me`

Guard: valid session (`S`). No Origin/CSRF requirement; it has no business mutation.

Success `200`: the same `data` shape as login, with `recentlyReauthenticated = (now - reauthenticatedAt) <= 5m`. It re-derives the same session-bound CSRF token, performs only a throttled session touch, and never rotates the raw session token.

Errors: `UNAUTHENTICATED`, `SESSION_EXPIRED`, or `SESSION_REVOKED` as 401; `AUTH_SERVICE_UNAVAILABLE` as 503.

### 11.3 `POST /api/auth/logout`

Guard: mutation (`M`): valid session + exact Origin/authority/protocol + `Sec-Fetch-Site: same-origin` + JSON + valid session-bound `X-SparkKeeper-CSRF`.

Request: exact empty object `{}`. Success: `204` with empty body and clearing Set-Cookie. Side effect: current session revoke + `LOGOUT` AuditEvent in one transaction.

Errors: session 401 codes; `ORIGIN_REJECTED` 403; `CSRF_REJECTED` 403; `AUTH_SERVICE_UNAVAILABLE` 503. On DB/audit failure, do not claim logout success or clear a still-valid cookie; UI remains authenticated and may retry.

### 11.4 Deferred auth APIs

Do not implement `/api/auth/reauth`, `/api/auth/change-password`, `/api/auth/sessions`, or `/api/auth/sessions/:id/revoke` in V4-2. Their older API draft entries remain future contracts and must be implemented by a later milestone/spec.

## 12. Auth middleware and route guards

Replace the local static mutation header as an authorization mechanism. `X-SparkKeeper-Admin-Request: 1` may be tolerated if an old caller sends it, but it grants nothing and the new frontend need not send it. V4 production correctness does not add a compatibility bridge for this unused V3 behavior.

Required route classes:

| Class | Routes | Checks |
|---|---|---|
| `P` | health | none beyond schema/safe response |
| `L` | login | authority/protocol/Origin/fetch metadata/JSON/rate |
| `S` | protected GET/HEAD + SSE | valid session and expiry/version/user checks |
| `M` | protected POST/PATCH/PUT/DELETE | `S` + authority/protocol/Origin/fetch metadata/JSON/CSRF |
| `R` | future sensitive action | `M` + recent-auth primitive |

Use Fastify route config/encapsulation or equivalent compile-visible metadata. A new route defaults protected; public classification must be explicit. Tests enumerate every registered `/api` route and fail if a route is unclassified.

The auth service returns a typed outcome. Only that outcome creates the HTTP auth error. A DB read/write failure, busy exhaustion, hasher failure, invalid persisted PHC, or unexpected integrity state maps to `AUTH_SERVICE_UNAVAILABLE`, never to `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `CSRF_REJECTED`, or `CONFLICT`.

## 13. CSRF and Origin model

### 13.1 Mutations

For every `L` or `M` request:

- `Host`/effective request authority must equal the configured canonical origin authority;
- effective protocol must equal canonical origin protocol;
- `Origin` is mandatory and byte-for-byte equal to the canonical origin after configuration canonicalization;
- there is **no Referer fallback**;
- `Sec-Fetch-Site` is mandatory and exactly `same-origin`;
- content type media type is exactly `application/json` (parameters allowed);
- no wildcard or credentialed CORS headers are emitted.

For `M`, additionally require one `X-SparkKeeper-CSRF` header with strict 43-character base64url shape and session-bound digest equality. Missing, duplicate, malformed, cross-session, or wrong proof is `CSRF_REJECTED`. Login is protected against login CSRF by the exact Origin/authority/fetch/JSON checks and does not require a pre-session token.

`GET`/`HEAD` must not perform business mutations. The bounded `/api/auth/me` last-seen touch and SSE liveness touch are explicitly security bookkeeping, not business state changes.

### 13.2 Trusted origin and proxy configuration

Add validated configuration:

```text
SPARKKEEPER_ADMIN_SECURITY_MODE=production|development     # required
SPARKKEEPER_ADMIN_CANONICAL_ORIGIN=<absolute origin>       # required
SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS=<comma list>         # optional in dev; required in production
```

Canonical origin must contain only scheme + host + optional port: no path other than `/`, userinfo, query, or fragment. Production requires HTTPS. Development requires loopback HTTP.

Construct Fastify with `trustProxy=false` when the CIDR list is empty; otherwise pass the exact validated IP/CIDR array. Never pass `true`, accept wildcard CIDRs, use arbitrary `Forwarded`/`X-Forwarded-*` manually, or infer trust from request headers. Rate-limit IP is Fastify `request.ip` after this trust policy. See the [Fastify v5 trustProxy contract](https://fastify.dev/docs/v5.6.x/Reference/Server/#trustproxy).

V4-10 will supply the Caddy/public HTTPS topology. V4-2 supplies the application contract and fails safely if production mode is configured without a valid HTTPS/proxy boundary.

## 14. Login rate limiting and admission policy

Rate limiting has three layers:

1. future edge per-IP limits (documented assumption; not deployed here);
2. process-memory 15-minute windows for trusted-IP and normalized-username correlation keys;
3. the process-wide Argon2 active/queue gate from §7.4.

Generate an ephemeral process HMAC key with `randomBytes(32)`. Keys and audit correlation are:

```text
ipKey       = hex(HMAC-SHA-256(key, "ip\0" + request.ip))
usernameKey = hex(HMAC-SHA-256(key, "username\0" + normalizedUsername))
```

Never log/audit raw IP. Username is not placed in failure logs/audit payloads; known-user AuditEvent references only internal AdminUser ID.

Exact memory policy:

- each IP and username dimension admits five attempts in a 15-minute window beginning with that dimension's first admitted attempt;
- reserve the attempt before Argon2 so concurrent requests cannot all pass;
- a successful login clears both relevant memory windows;
- a blocked dimension returns `RATE_LIMITED` and `Retry-After` equal to the ceiling seconds until its window expires;
- prune expired entries on bounded intervals/insertion; maximum 10,000 combined entries. At capacity after prune, fail closed with `RATE_LIMITED` rather than allocate unbounded memory;
- process restart clears both memory dimensions for known and unknown usernames equally;
- `failedLoginCount`, `lockedUntil`, and `lastFailedLoginAt` are not read, written, reset, or enforced by V4-2 runtime.

Unknown usernames run the dummy Argon2 verify and use the identical bounded username/IP admission policy; they create no AdminUser/Audit row and no persistent limiter row. This preserves restart behavior parity and avoids a persistent username-existence oracle and persistent account-lock denial surface. Multi-process/distributed enforcement is deferred to a future edge/deployment spec; V4-2 does not add Redis, CAPTCHA, device fingerprinting, or another persistent store.

## 15. Recent-auth foundation

- Login creates the session with `reauthenticatedAt=now`.
- Add reusable `requireRecentAuthentication(maxAgeMs)` middleware/service primitive; default/frozen high-risk window is 5 minutes.
- It uses the request's single sampled `now` and existing session `reauthenticatedAt`.
- Failure is `403 REAUTH_REQUIRED`; infrastructure failure remains `AUTH_SERVICE_UNAVAILABLE`.
- No V4-2 route uses `R`, and no re-auth endpoint/UI is added merely to demonstrate it.
- V4-3+ may add `/api/auth/reauth` and apply `R` to an actual sensitive operation under its own spec.

## 16. Audit, logging, and redaction

### 16.1 Durable audit

| Fact | Audit event |
|---|---|
| initial bootstrap commit | `ADMIN_INITIALIZED / ADMIN_USER / SUCCESS` |
| successful login | `LOGIN_SUCCEEDED / ADMIN_SESSION / SUCCESS`, actor=user, entity=new session |
| admitted wrong password for known user | `LOGIN_FAILED / ADMIN_USER / REJECTED / INVALID_CREDENTIALS`, actor null |
| malformed stored hash/rehash failure | `LOGIN_FAILED / ADMIN_USER / FAILED / CREDENTIAL_INTEGRITY_FAILURE` only if the same transaction can safely persist it; otherwise operational log only |
| successful logout | `LOGOUT / ADMIN_SESSION / SUCCESS`, actor=user |
| explicit future/admin/version revoke | `SESSION_REVOKED / ADMIN_SESSION / SUCCESS` when that operation exists |

Unknown-user failures, missing/random cookies, automatic expiry, CSRF/Origin bot rejections, and pre-admission rate rejections do not create one durable row per request. Record bounded allowlisted logs/metrics with safe reason code and HMAC correlation only.

AuditEvent never stores password, raw/digest hash, raw/digest session or CSRF, cookie/header, username, IP, User-Agent, request body, stack, SQL, path, or arbitrary metadata.

### 16.2 Operational logs

Extend Pino redaction for at least:

```text
req.headers.cookie
req.headers.authorization
req.headers.x-sparkkeeper-csrf
res.headers.set-cookie
request.body.password
password / passwordHash / token / tokenDigest / csrfToken / csrfTokenDigest
cookie / setCookie / authorization and nested variants
```

Auth code logs only allowlisted fields: `eventType`, safe `reasonCode`, HMAC `correlationDigest`, HTTP status, and optional internal session/admin ID where the event is authenticated. Never pass raw `Error`/cause or request body into Pino. Error responses remain safe envelope text.

Tests must capture real Pino output and inspect AuditEvent rows and thrown/HTTP error serialization for fixture passwords, PHCs, raw tokens, digests, cookies, CSRF values, usernames used as sentinels, raw IP, and stack/SQL strings.

## 17. Minimal Admin UI and frontend security

Required UI only:

- `/login` outside `AdminLayout` with username, password, submit, loading/disabled state;
- errors for invalid credentials, rate limiting (respect/display Retry-After when present), service not initialized (operator CLI guidance), and generic network/server failure;
- one application auth controller with `BOOTSTRAPPING | AUTHENTICATED | UNAUTHENTICATED` state, current safe Admin DTO, in-memory CSRF, and expiry timestamps;
- initial `/api/auth/me` before any protected runtime request or EventSource connection;
- protected router metadata/guard; safe relative post-login redirect;
- username display and Logout button in the existing topbar;
- session-expiry/revocation handling: clear auth/CSRF state, stop SSE/protected refresh, and redirect to Login with a safe localized notice.

Frontend contracts:

- every fetch explicitly uses `credentials:'same-origin'`;
- `X-SparkKeeper-CSRF` is added only to protected mutations and never login/GET;
- no password/session token/CSRF value in localStorage, sessionStorage, URL, console, analytics, error text, or client logs;
- the HttpOnly session cookie is never read by JS;
- no automatic retry of login, logout, or other mutation;
- centralized 401 handling runs once, avoids recursion on `/api/auth/me`, and preserves the attempted protected path only as a validated local route;
- logout understands 204 without trying to parse JSON;
- password `ref` is cleared after a completed request and on unmount;
- existing runtime/SSE initialization moves behind authenticated mount. Logout/session loss unmounts/disconnects it.

Test harness defaults may perform a real-shaped `/api/auth/me` fixture so ordinary page tests remain focused, but production route guards/auth state execute normally. No `disableAuthForTest`, arbitrary decision callback, magic header, environment bypass, or public testing API is permitted.

## 18. Error model and complete-stack budgets

### 18.1 Typed HTTP matrix

| HTTP | Code | Business/security fact |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | strict input/schema bound failed |
| 401 | `INVALID_CREDENTIALS` | admitted login did not verify; unknown/wrong parity |
| 401 | `UNAUTHENTICATED` | no syntactically valid token or digest lookup miss |
| 401 | `SESSION_EXPIRED` | known session crossed idle/absolute deadline |
| 401 | `SESSION_REVOKED` | known revoked, disabled-user, or version-mismatched session |
| 403 | `ORIGIN_REJECTED` | authority/protocol/Origin/fetch-site proof failed |
| 403 | `CSRF_REJECTED` | session-bound CSRF proof missing/malformed/mismatched |
| 403 | `REAUTH_REQUIRED` | valid session is outside a route's recent-auth window |
| 429 | `RATE_LIMITED` | IP/username memory window or global-crypto capacity denied admission |
| 503 | `SERVICE_NOT_INITIALIZED` | zero AdminUsers; operator bootstrap required |
| 503 | `AUTH_SERVICE_UNAVAILABLE` | DB busy/read/write, invalid persisted auth state/PHC, RNG, Argon2, or atomic audit failure |
| 500 | `INTERNAL_ERROR` | unexpected non-auth-classified failure |

Messages never reveal username existence, stored-hash state, DB state, session/token value, or cause. `CONFLICT` is never fabricated from a DB busy/integrity failure.

### 18.2 Timeout/cost budget

Authentication adds bounded lower-level waits to the existing application stack:

- every auth-specific synchronous DB read/transaction uses `DatabaseClient.withBusyTimeout(500)` and no retry; BUSY/LOCKED exhaustion is infrastructure failure;
- failed login normally performs at most one 500 ms lookup scope + 2 s crypto queue + one actual Argon2 verify + an optional 500 ms known-user audit write;
- successful login uses the same maximum scopes plus session generation/finalization;
- session validation/touch is one repository operation with at most 500 ms DB contention wait;
- existing protected handler DB/network/browser budgets begin **after** the auth guard and remain owned by their milestones;
- no nominal hard request timeout is claimed for the non-cancellable native Argon2 call. Intended login budget is <=3.75 s when the observed environment meets the 750 ms p95 deployment target, but the Development Agent's local/container benchmark is not production acceptance; OS scheduling/native failure can exceed it and must surface as operational latency, not a false security error;
- proxy/network timeouts are deployment-layer V4-10 work and must exceed the measured auth budget. They cannot be documented as enforcement in V4-2.

Tests prove DB busy classification with a real second SQLite connection and measured repository-call elapsed around the 500 ms budget. They do not use timing luck to prove credential parity; parity proof is structural (same route/status/body/cookie absence and exactly one real Argon2 verify).

## 19. Invariant / Failure / Proof Matrix

All 31 rows are HIGH-risk acceptance invariants. Implementation and review must not defer their guards/tests until review.

| ID | Invariant and failure mode | Implementation guard / production behavior | Required deterministic proof |
|---|---|---|---|
| A01 | Password plaintext is never persisted. Failure: DB/repository/audit receives it. | Password exists only in CLI/form/request-local memory; repository input accepts PHC only. | Exercise bootstrap/login, inspect every auth/audit DB column and serialized repository input; plaintext sentinel absent. |
| A02 | Passwords, PHCs, raw/digest tokens/CSRF, cookies, raw IP and stack/SQL are absent from logs, audit, SSE and errors. | Allowlist + Pino redaction + safe typed errors; never pass raw cause/body. | Capture real Pino/Audit/HTTP/SSE output for success and every injected failure; assert all sentinels absent. |
| A03 | One normalized username maps to one Admin. Failure: case/whitespace/Unicode ambiguity. | Exact ASCII regex, no trimming at boundary, ASCII lowercase, DB unique. | Shared + CLI + HTTP + repository tests at 2/3/64/65 chars, invalid chars/space, and case duplicate. |
| A04 | Repository contains no default credential/setup route. Failure: fresh DB is publicly claimable. | Operator hidden-stdin CLI only; zero Admin makes login 503; route inventory. | Fresh DB route enumeration + source/diff scan + CLI integration; no seed/default/public setup. |
| A05 | Bootstrap creates exactly one Admin+audit and repeat/concurrent execution cannot rotate it. | Immediate atomic zero-count/create/audit transaction and singleton constraints. | Two-connection concurrent bootstrap: one success, one `ADMIN_ALREADY_INITIALIZED`, SQL count user=1/audit=1, original hash unchanged. |
| A06 | Wrong password cannot create/rotate/touch a session. | Real verify must return MATCH before final login transaction. | Real Argon wrong-password HTTP test; session count/digests/login timestamp unchanged and no Set-Cookie. |
| A07 | Unknown username and wrong password do not reveal existence. | Same 401 code/message/body, one real verify (dummy vs stored), same cookie absence and limiter class. | Production-route pair with a hasher observation that records operation count/type but never controls result; identical response fields, exactly one verify each. No wall-clock equality claim. |
| A08 | Malformed/unsupported stored PHC is not an invalid-credentials fact. | Typed PasswordHasher `MALFORMED_HASH` → 503; no session or AdminUser limiter-field mutation. | Insert malformed PHC through real DB fixture, hit login route, assert 503/no session/no plaintext/error leakage and actual verify/parser path executed. |
| A09 | DB read/write/BUSY/audit failure is not `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `CONFLICT`, or `CSRF_REJECTED`. | Repository preserves `INTEGRITY_ERROR`; service maps 503 only. | Real closed DB and second-connection persistent writer on lookup/finalize/logout/session validation; assert 503 and unchanged business rows. |
| A10 | Raw session token is never stored. | Persist SHA-256 hex digest only; raw goes directly to Set-Cookie. | Parse cookie after real login; SQL scan proves raw absent and stored digest equals SHA-256(decoded raw). |
| A11 | Session digest cannot authenticate as a raw token. | Every cookie candidate is strict-decoded and rehashed. | Send stored digest as cookie through `/api/auth/me`; 401 and no touch. |
| A12 | Missing, duplicate, malformed, random, and tampered tokens cannot authenticate. | Strict extractor + duplicate rejection + digest miss. | Table-driven real middleware/API tests prove handler spy count=0 and clearing-cookie policy. |
| A13 | `now >= idle` or `now >= absolute` cannot authenticate. | Single-time validation with exclusive deadline checks before touch. | Exact boundary tests at -1 ms, equal, +1 ms for idle and absolute through `/me` and one protected business route. |
| A14 | Revoked session cannot authenticate. | `revokedAt` classified before handler; clear cookie. | Revoke DB row, call `/me`, protected REST and SSE; all reject/close, handler/subscriber count=0. |
| A15 | Disabled Admin or sessionVersion mismatch invalidates the session. | Validation joins current ACTIVE/version; classify revoked and optionally mark reason. | Real repository state mutation followed by `/me`/protected route/SSE tests; no handler execution. |
| A16 | Logout invalidates the current session. | Authenticated CSRF-protected atomic revoke+audit; clear only after commit. | Login → logout → same cookie `/me` 401; SQL revoked reason/audit exact; second logout cannot authenticate. |
| A17 | Successful login never accepts/fixes a caller session and rotates a valid current-browser session. | CSPRNG only; valid old current session revoked `LOGIN_REPLACED`; unrelated sessions untouched. | Login with valid old cookie; assert new raw/digest, old revoked, other browser still valid, caller token/body ignored/rejected by schema. |
| A18 | Production Set-Cookie flags/name are exact. | Production config hard-codes `__Host-`, Secure, HttpOnly, Strict, `/`, no Domain, 12h/absolute. | Parse raw Set-Cookie from real login and clear responses; assert every attribute and absence of Domain; snapshot is semantic, not order-dependent. |
| A19 | Local HTTP never silently weakens production cookie. | Explicit development mode + loopback origin + distinct cookie; invalid mode/origin fails startup. | Config matrix: production/http fails, development/nonloopback fails, Host cannot change mode; exact development cookie proof. |
| A20 | Cross-origin/authority/protocol mutation and login are rejected. | Exact canonical comparison before credentials/handler. | Spoof-like origins/hosts, ports, schemes, `null`, comma/multiple values; 403 and hasher/handler/session counts prove target path not executed. |
| A21 | Missing Origin or invalid/missing/cross-site Fetch Metadata is rejected; Referer cannot substitute. | Mandatory Origin + exactly `Sec-Fetch-Site:same-origin`; no fallback. | Table-driven L/M production-hook tests with a valid Referer but missing Origin; 403 and zero downstream calls. |
| A22 | Missing, duplicate, malformed, wrong CSRF is rejected on every mutation. | Strict single header + shape + timing-safe digest compare. | Enumerate all registered mutation routes with valid session and invalid proof; handler spies remain zero. |
| A23 | CSRF proof is bound to exactly one session and reload-safe without raw persistence. | HMAC derivation from session token; only digest DB; `/me` re-derives same proof. | Two real sessions: each `/me` equals its login CSRF; cross-use rejected; raw CSRF absent from DB/cookies/storage. |
| A24 | Valid same-origin authenticated requests succeed. | Correct L/S/M classification and guard order. | Real login cookie+CSRF drives `/me`, representative protected GET/mutation/SSE and logout through normal registration. |
| A25 | Bounded rate admission trips before excessive Argon work and cannot become a persistent account lock. | Atomic in-memory IP/username reservations with common 15m expiry + global crypto gate; legacy failure/lock columns unused. | Inject clock (not decisions), run 5 allowed + 6th denied; observe exactly five real verifies and deterministic Retry-After; expire/reset/success/restart both known and unknown buckets identically; concurrent burst bounded; DB columns unchanged. |
| A26 | Client-IP keys cannot be spoofed with forwarded headers. | Fastify trustProxy false or exact CIDRs; request.ip only. | Direct untrusted XFF cannot change bucket; configured one-proxy fixture resolves intended client; wildcard/`true` config rejected. |
| A27 | Session expiry math uses one time source per request. | One injected clock sample passed through guard/repository/response/recent-auth. | Advancing/spying clock proves exactly one sample and exact persisted/returned deadlines; no Date.now in security modules. |
| A28 | Active use avoids per-request writes and can never extend beyond absolute expiry. | 5m touch throttle + atomic cap + validity predicate. | SQL update observation/count at 0, 4:59, 5:00, near absolute; exact values and no write on ordinary repeated reads. |
| A29 | Recent-auth guard accepts only a valid session authenticated within 5m. | Login sets `reauthenticatedAt`; reusable guard uses request now. | Exact -1/equal/+1 ms guard tests with real session context; no V4-2 public action/semantic bypass. |
| A30 | SSE cannot start or remain active beyond session validity. | Session check before hijack; 60s revalidation; close on failure/server close. | Real stream with valid cookie, then revoke/expire and advance clock; subscriber count reaches zero and no later event is received. |
| A31 | Test seams/resource/timeout behavior cannot alter security decisions or escape scopes. | Production hasher/RNG/guards used in integration; injected clock/observer only; sync DB timeout rejects PromiseLike; async crypto gate owns `finally` release. | Typecheck + runtime thenable rejection + forced throw/abort/cancel tests prove lease release; busy elapsed/classification proof; route tests verify real target path markers. |

## 20. Failure injection matrix

| Failure injected through production path | Expected classification/state | Required evidence |
|---|---|---|
| wrong password | 401 `INVALID_CREDENTIALS`; no session; legacy failure/lock columns unchanged; accepted known-user audit may append | real Argon verify observed; SQL and HTTP inspected |
| unknown username | same 401/body/cookie; dummy verify; no persistent row | real dummy verify observed; DB count unchanged |
| malformed username/body/oversized body | 400/413 safe validation; no hasher/repository credential action | route hook markers |
| Admin disabled | login never succeeds; existing session 401 `SESSION_REVOKED` | DB status fact + handler count zero |
| malformed PHC | 503 `AUTH_SERVICE_UNAVAILABLE` | actual library/parser rejection; no session |
| Argon2 hash/verify/rehash failure where the real adapter can safely produce it | 503; no auth business error/session | wrapper error contract; no arbitrary production callback |
| credential lookup DB failure | 503; no dummy `INVALID_CREDENTIALS` fabrication | closed DB/real repository path |
| login finalize/audit DB failure | 503; transaction rollback, no session/login-success state | real writer/constraint failure + row snapshot |
| missing cookie | 401 `UNAUTHENTICATED` | protected handler not called |
| duplicate/malformed/random/tampered cookie | 401 `UNAUTHENTICATED`; clear presented cookie | extractor and middleware path markers |
| digest used as cookie | 401 `UNAUTHENTICATED` | digest-of-digest lookup miss |
| idle/absolute exact expiry | 401 `SESSION_EXPIRED` | fixed-clock boundary rows |
| revoked/sessionVersion/disabled user | 401 `SESSION_REVOKED` | each distinct DB fact injected |
| logout DB/audit failure | 503; session/cookie remain valid for retry | transaction snapshot and no clear header |
| logout twice | first 204/revoked; second 401/clear | SQL count/reason + two HTTP results |
| cross-origin/bad Host/protocol | 403 `ORIGIN_REJECTED` | hasher/handler count zero |
| missing Origin with valid Referer | 403 `ORIGIN_REJECTED` | no fallback marker |
| missing/bad Fetch Metadata | 403 `ORIGIN_REJECTED` | no downstream marker |
| missing/duplicate/bad/cross-session CSRF | 403 `CSRF_REJECTED` | mutation handler count zero |
| per-IP/per-username/global crypto limit | 429 `RATE_LIMITED` | deterministic count, queue and Retry-After |
| short DB writer contention | success only if within 500ms; never false credential result | acquired-writer handshake + elapsed |
| persistent DB writer contention | 503 around 500ms; business rows unchanged | acquired-writer handshake + elapsed |
| touch race with revoke/expiry | revoked/expired/stale outcome; never revived | two-connection ordered race and SQL state |
| SSE revoke/expiry | stream closes; no post-invalid event | subscriber and client read proof |
| frontend `/me` 401 during bootstrap | Login route only; no runtime/SSE started | fetch/EventSource call order |
| frontend protected API 401 | auth/CSRF cleared, SSE stopped, safe redirect | controller/router/component test |

Do not add concurrency tests merely for volume. Required races are bootstrap uniqueness, successful-login finalize, guarded touch vs revoke/expiry, rate reservation, and SSE invalidation.

## 21. Test plan

### 21.1 Shared/domain tests

- username exact regex, boundaries, normalization, case-insensitive uniqueness;
- password code-point bounds with no trim/normalization/complexity classes;
- token/CSRF encoding/digest/derivation known vectors;
- session lifetime/touch/recent-auth pure calculations;
- rate admission/window/expiry/reset/capacity pure policy.

### 21.2 Database repository tests

- every new `AdminAuthRepository` typed outcome and transaction rollback;
- bootstrap zero/one/concurrent two-connection proof;
- successful-login finalize and proof that legacy failure/lock columns remain unchanged;
- session create/replace, raw-vs-digest, classify/touch/revoke/logout;
- rehash update preserves passwordChangedAt/sessionVersion;
- DB BUSY deadline uses a writer-acquired handshake and real connection;
- infrastructure errors remain `INTEGRITY_ERROR`, not business facts;
- accepted V4-1 schema/migrations remain unchanged and all existing auth foundation tests pass.

### 21.3 Server integration/security tests

Prefer `Fastify.inject()` through the production route registration, real temporary SQLite, real PasswordHasher and real cookie serialization. Cover:

- bootstrap CLI core with controlled stdin/stdout streams and real hasher/repository;
- login/me/logout happy path and exact response/cookie/cache headers;
- every HTTP error/failure-injection row;
- every existing business read/mutation/SSE route unauthenticated rejection;
- authenticated migration of existing API suites using a real-login fixture helper;
- route classification inventory;
- Origin/Host/protocol/fetch/JSON/CSRF order with downstream call counters;
- redaction from real Pino output/error handler/Audit rows;
- SSE initial/continuous auth and cleanup;
- public health minimal shape and protected runtime detail.

Do not mock cookie parsing, auth middleware, session repository, CSRF comparison, or rate admission in HIGH-risk integration tests. A unit test may observe hasher operation names/counts, but it may not inject a callback that returns MATCH or changes a production security decision.

### 21.4 Admin-web tests

- auth parsers reject extra/internal/hash/digest/token fields;
- API client `credentials:'same-origin'`, CSRF mutation-only, 204 logout, no retry, centralized 401;
- bootstrap ordering: `/api/auth/me` before runtime/SSE;
- Login field/loading/error/clear-password states in Chinese and English;
- router protected/public/redirect sanitization;
- logout success/failure and expired/revoked session transitions;
- existing page tests continue through an authenticated, real-shaped `/api/auth/me` fixture;
- local/session storage and URLs contain no password/session/CSRF sentinels.

### 21.5 Security/privacy scans

- inspect complete diff and tracked/untracked implementation for default passwords, PHCs tied to a user, tokens, cookies, raw IPs, `.env`, DB/profile/log artifacts, and real data;
- dummy PHC is explicitly identified as unreferenced non-credential test/equality work and no raw preimage/default user is present;
- run dangerous-file audit before any later Git delivery.

## 22. Security acceptance gates

Implementation is not ready for review until all are true:

1. `develop` baseline/branch is exact and no migration `0000`–`0008` byte changes exist;
2. no new migration or destructive schema operation exists;
3. all 31 invariant proofs pass through the specified target paths;
4. production/development cookie semantic snapshots pass;
5. wrong/unknown/malformed-hash/DB-failure classifications pass;
6. all registered routes are P/L/S/M/R-classified and protected as specified;
7. CSRF/Origin/fetch/proxy/rate/expiry/revocation/SSE matrices pass;
8. real Pino/Audit/HTTP/frontend secret-absence assertions pass;
9. the Argon2 20-hash/20-verify benchmark records median, p95, and environment without claiming production acceptance; any p95 above 750 ms is reported as `PERFORMANCE_RISK / SPEC_DEVIATION` and parameters remain unchanged;
10. dependency lockfile contains reviewed `argon2` and Fastify-5-compatible `@fastify/cookie`; any additional direct production dependency has prior Planning Owner approval recorded as `SPEC_DEVIATION`;
11. implementation remains within the bounded scope or reports a blocker before expansion;
12. commands pass:

```bash
pnpm install --frozen-lockfile
pnpm --filter @sparkkeeper/shared test
pnpm --filter @sparkkeeper/database test
pnpm --filter @sparkkeeper/database db:smoke
pnpm --filter @sparkkeeper/server test
pnpm --filter @sparkkeeper/admin-web test
pnpm docker:test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
git status --short
git ls-files -- task_plan.md findings.md progress.md
```

No BrowserSession, Docker production smoke, maintenance browser, production, Douyin, send, Scheduler, commit, push, or PR action is authorized for the Development Agent.

## 23. Development Agent self-review matrix

Before returning work, the Development Agent must include a Self-Review Matrix with **one row for every A01–A31 invariant**:

| Invariant ID | Implementation location | Production-path test location | Failure injection | Proof result/actual command |
|---|---|---|---|---|
| A01–A31 | file:line | file:test name | exact fact injected | PASS/FAIL + evidence |

The report must explicitly answer:

- Did each test prove the intended hasher/repository/hook/handler/failure path actually ran?
- Does any proof depend on wall-clock timing luck rather than a barrier, fixed clock, or exact state?
- Does any test seam execute arbitrary callbacks or change a security decision, error classification, or production timing semantics?
- Does any synchronous resource scope accept a Promise/Thenable, or can an async crypto/queue/SSE lease escape `finally` cleanup?
- Are DB busy waits, crypto queue/cost, handler waits, and proxy/network assumptions all included in claimed budgets?
- Can any infrastructure error be reported as invalid credentials, unauthenticated, CSRF, rate-limit, or conflict?
- Can passwords, PHCs, tokens, cookies, CSRF, digests, raw IP/User-Agent, request body, stack, or SQL appear in logs/audit/errors/SSE/frontend storage?
- Did implementation add a default credential, public setup, V3 bridge, out-of-scope auth management, deployment, Douyin, send, or Scheduler behavior?

Required implementation report begins `IMPLEMENTATION_COMPLETE` and includes baseline/branch, files, dependencies, migrations (must be zero), exact test counts/commands, benchmark result, deviations/blockers, Self-Review Matrix, working tree, and zero Git/production/Douyin/send actions.

## 24. Codex review and delivery gates

Future Codex review is risk-tiered:

- HIGH: password/PHC verification, bootstrap, session creation/validation, cookie, CSRF/Origin/proxy, memory limiter/crypto gate, revocation/expiry, redaction;
- NORMAL: Login form layout, loading copy, ordinary route presentation.

Review must reread this complete specification and inspect the entire V4-2 diff. If any P0/P1 is found:

1. continue static inspection of the remaining V4-2 scope and collect all reasonably discoverable P0/P1 findings in the same round;
2. skip expensive regression when a blocking defect makes it pointless;
3. do not stage, commit, push, or create/update a PR;
4. return one consolidated `CHANGES_REQUESTED` report with priority, file/behavior/fact, expected contract, and deterministic verification.

Only after P0=0 and P1=0 may Codex run the complete required regression, dangerous-file audit, staged-diff review, commit, push, and unmerged PR workflow. No merge occurs without separate authorization.

V3 compatibility is `BEST_EFFORT_ONLY / NO NEW BRIDGES`. Existing API presentation tests may be updated to authenticate; no static-header auth bridge is required for hypothetical unused clients.

## 25. Files/modules expected to change

This is an estimate, not authorization to edit unrelated files.

### Expected existing files (about 32–36 of the candidate surfaces below)

```text
pnpm-lock.yaml
packages/shared/src/Admin.ts
packages/shared/test/V4Domain.test.ts
packages/database/src/repositories/index.ts
packages/database/src/index.ts
packages/database/test/V4Repositories.test.ts (or focused replacement)
apps/server/package.json
apps/server/src/http/ApiApplication.ts
apps/server/src/http/createServer.ts
apps/server/src/http/config/HttpConfig.ts
apps/server/src/http/errors/ApiError.ts
apps/server/src/http/plugins/MutationGuard.ts (replace/remove as authority)
apps/server/src/http/routes/statusRoutes.ts
apps/server/src/http/routes/realtimeRoutes.ts
apps/server/src/http/schemas/contracts.ts
apps/server/src/http/services/ApiServices.ts
apps/server/src/http/services/StatusService.ts
apps/server/src/observability/RuntimeLogger.ts
apps/server/test/{ApiFoundation,ConfigurationApi,ManualRunApi,NotificationApi,RealtimeApi}.test.ts
apps/admin-web/src/{App.vue,appContext.ts,style.css}
apps/admin-web/src/router/{index.ts,router.test.ts}
apps/admin-web/src/api/{client.ts,client.test.ts,sparkkeeperApi.ts,parsers.ts}
apps/admin-web/src/types/api.ts
apps/admin-web/src/layouts/AdminLayout.vue
apps/admin-web/src/i18n/locales/{zh-CN,en-US}.ts
apps/admin-web/src/test/{fixtures.ts,http.ts,mountAdmin.ts}
```

### Expected new files (about 14–18)

```text
packages/database/src/repositories/AdminAuthRepository.ts
packages/database/test/AdminAuthRepository.test.ts
apps/server/src/admin-cli.ts
apps/server/src/security/PasswordPolicy.ts
apps/server/src/security/PasswordHasher.ts
apps/server/src/security/LoginRateLimiter.ts
apps/server/src/security/AdminAuthenticationService.ts
apps/server/src/security/AdminSessionService.ts
apps/server/src/http/plugins/AdminAuthGuards.ts
apps/server/src/http/routes/authRoutes.ts
apps/server/src/http/schemas/authContracts.ts
apps/server/test/AdminAuthApi.test.ts
apps/server/test/AdminBootstrapCli.test.ts
apps/server/test/authFixture.ts
apps/admin-web/src/auth/AuthController.ts
apps/admin-web/src/pages/LoginPage.vue
apps/admin-web/src/auth/AuthController.test.ts
apps/admin-web/src/pages/LoginPage.test.ts
```

Expected total implementation scope after expanding grouped paths and removing persisted-lock behavior: approximately **46–54 files**, one focused database aggregate with four atomic operations, 7–8 cohesive server security/HTTP modules, 2–4 frontend auth modules/components, and five test areas. The range includes updates to existing protected-route test suites and frontend harness/localization files; it is still one vertical slice, not a new foundation. Expected production dependencies are `argon2` and `@fastify/cookie`; any additional direct production dependency requires `SPEC_DEVIATION` and Planning Owner approval. Expected migrations: 0.

If implementation requires more than 54 files, any migration, a new package/service/store, or broad Caddy/Nginx/Compose redesign, STOP and request re-scoping. An additional direct production dependency also requires `SPEC_DEVIATION` and Planning Owner approval; this planning amendment authorizes none. Do not allow this to become another 60+ file foundation milestone.

## 26. Implementation sequence

### Phase A — Shared/security contracts

1. create feature branch from exact baseline;
2. add/pin dependencies and review lockfile/native build support;
3. implement username/password/token/time/config pure contracts and tests;
4. implement PasswordHasher and target-container benchmark.

### Phase B — Atomic persistence and bootstrap

1. add focused `AdminAuthRepository` typed outcomes/transactions;
2. implement hidden-stdin bootstrap core/CLI;
3. prove zero/repeat/concurrent bootstrap, login finalize, unchanged legacy failure/lock columns, session classification/touch/logout and DB busy behavior.

### Phase C — Authentication/session services

1. implement crypto work gate and limiter;
2. implement login enumeration/malformed/infrastructure semantics;
3. implement token/CSRF derivation, validation, lifetime, touch, revocation, recent-auth primitive;
4. add service-level failure matrix tests using real policy/hasher where required.

### Phase D — Fastify HTTP security

1. extend validated config/trustProxy/redaction/error/schema contracts;
2. register cookie support and route classification/auth context;
3. implement login/me/logout;
4. protect existing REST/mutations, minimize health, protect/revalidate SSE;
5. migrate existing server tests through the real login helper and complete security integrations.

### Phase E — Minimal Admin auth flow

1. add allowlisted auth DTO/parsers/client methods and auth controller;
2. add public Login page and protected router guard;
3. delay runtime/SSE until authenticated;
4. add topbar identity/logout and expired/revoked handling;
5. update bilingual strings/styles and focused tests without redesigning Admin IA.

### Phase F — Proof and self-review

1. run A01–A31 and failure-injection matrices;
2. run package tests, DB smoke, offline Docker config tests, lint/typecheck/full test/build;
3. inspect migration history, dependency/dangerous files, secret/privacy/redaction and complete diff;
4. produce the required Self-Review Matrix and `IMPLEMENTATION_COMPLETE` report with uncommitted working tree.

No phase may access Douyin, start a browser/profile, send, enable Scheduler/Manual Run/real-send gates, deploy, or perform Git delivery.

## 27. Definition of Done

V4-2 implementation is ready for independent review only when:

- exact first-Admin CLI works with hidden stdin, no defaults, atomic audit, and safe repeat/concurrency behavior;
- password/username/Argon2id/dummy verify/rehash contracts are exact and benchmarked;
- raw password/session/CSRF values are absent from persistence/log/audit/error/SSE/frontend storage;
- login/me/logout and exact production/development cookies pass production-route tests;
- every non-public API and SSE is protected; expired/revoked/disabled/version-invalid sessions cannot reach handlers;
- session idle 30m, absolute 12h, touch 5m, recent auth 5m and one-time-source math pass exact boundaries;
- Origin/authority/protocol/fetch/JSON/CSRF/proxy trust checks pass valid and negative matrices;
- bounded in-memory IP/username admission and global crypto capacity pass deterministic expiry/reset/restart/capacity tests, with legacy failure/lock columns unchanged;
- wrong/unknown/malformed-PHC/DB-failure semantics remain distinct and safe;
- minimal Login/bootstrap/guard/logout/expiry UI works in both locales with no storage/token leakage;
- all 31 high-risk invariant proofs and 26 failure-injection rows are complete;
- zero migrations, production changes, Douyin accesses, browser sessions, real sends, Scheduler enablement, commits, pushes, PRs, merges, tags, releases, and deployments occurred;
- implementation scope remains bounded and Development Agent returns the complete Self-Review Matrix with an uncommitted working tree.
