# V4-10 UI / Public Deployment Security / E2E

状态：IMPLEMENTED / VERIFIED（Gate A PASS；待 PR review/merge）。基线 `develop@f91e7247c7b6f84ed94b2d2dc1cf614a315e3f25`；V4-9 MERGED / ACCEPTED（PR #49）。当前用户授权 Milestone Owner 完成实现、自审、验证与 PR；不授权 merge/release/deploy。证据见 [Gate A](../09-gate-a-evidence.md)。

## Scope and frozen boundaries

完成现有 V4 功能的 IA、中英文与可访问性/响应式整合，Caddy 80/443 reference deployment、TLS/headers/proxy trust、Admin credential/session operations、no-send security/E2E/upgrade/release evidence。既有 single-target Test Send、production factory/gate hard closed、不确定发送不 retry、preferred-only identity 与显式 migration 语义完全不变。不会增加 unbind/auth-check/preferred mutation/batch 或任何 live gate。

- V4 nav：Overview / Accounts / Templates / Tasks / Runs / Operations。Account tabs 严格 Overview → Contacts → Test Send → Tasks → History。legacy Friend/Schedule/Manual Run 不在主导航，保留 read compatibility route。
- Runs 与 Account History 使用已有 unified read model；不改 machine/human truth。V4-9 migration/audit/history copy 完整中英；中文默认、切语言不产生业务 mutation/reload/SSE reconnect。所有交互有可访问名称、focus 可见、dialog trap/restore focus、mobile layout 与 reduced motion。
- 补齐冻结 Auth draft：POST reauth(M)、change-password(R)、GET sessions(S)、POST sessions/:id/revoke(R)。复用 password policy/Argon2 work gate/trusted-IP+username admission；hash work 在事务外，最终事务重新核对 ACTIVE/user version/hash/session validity。password change 原子 sessionVersion++ + revoke all + audit，成功 clear cookie/console；reauth 仅更新当前有效 session，不延长 absolute expiry，不创建 session。
- 不需要 migration：复用既有 AdminUser/AdminSession/Audit action。无开放注册、default password 或 Web bootstrap；输入/响应不回显 password/token/digest/IP。
- 公网仅 Caddy 80/443，app/admin/login worker 无 host port。明确固定 proxy peer：Caddy frontend → Nginx backend → app；Caddy 拒绝外部 forwarded spoof，Nginx只信任 Caddy、重新构造 client IP 并保留 HTTPS proto；Fastify只信任 Nginx exact /32。无全网/private-range/hop-count trust。
- Caddy 自动 ACME/HTTPS redirect，TLS ≥1.2；HSTS 默认 max-age=0，永久 HTTPS 域名经 operator 确认后才能提高。SPA CSP self script/no eval、frame deny/nosniff/no-referrer；console 保持既有严格 CSP/owner/TTL/lease auth，不用 SPA policy 覆盖它。访问日志不记录 URI/query/IP/body/credentials；无公开 Caddy admin API。
- legacy maintenance 仅显式本地 operator debug override 可 publish loopback，不在 public deployment publish 5900/6080。

## Risk-focused invariant / failure / proof

| Invariant | Failure | Guard | Proof |
| --- | --- | --- | --- |
| External forwarded headers never choose rate key/proto | spoof XFF/XFP/Host | exact peer + sanitizing proxies | HTTPS reverse-proxy smoke + existing trusted/untrusted inject tests |
| Credential proof cannot outlive session/version/password | logout/password change during hash | final immediate transaction CAS/expiry | overlap fixture/state snapshot + auth API tests |
| Credential failure ≠ infrastructure failure | malformed hash/DB contention | safe 503, no fabricated credentials result | existing V4-2 proof + new management focused failures |
| No public worker/app port or console bypass | direct/expired console access | isolated networks + app owner/TTL/lease | parsed compose + real proxy 401/WS + existing continuous console tests |
| Gate A never sends/opens Douyin | implicit execute/browser/network | production gates closed + loopback allowlist | real browser E2E network/POST inventory + zero run/worker evidence |
| UI language/focus does not mutate business state | stale selection/replay/keyboard escape | no automatic POST; confirmation + CAS retained | bilingual/IA/dialog tests + browser mobile/keyboard smoke |
| Upgrade keeps original data and disabled imports | schema/backfill change | existing 0013 + offline CLI | populated V3 full-root restore rehearsal |

## Implementation / verification

Spec/status → security management aggregate/API → public reference config → V4 IA/i18n/a11y → focused tests → complete workspace lint/typecheck/tests/build → native/Docker validation → isolated HTTPS browser no-send E2E + migration rehearsal → Gate A evidence/runbook → self-review/fix → commit/push/PR.

Gate A evidence must record exact revision, commands/results, skips with Linux follow-up, network/send/runtime counts and limitations. Disposable local Docker containers are test fixtures, not production deploy; local CA only, no public DNS/ACME/real account. No Gates B–F or release readiness claim beyond no-send engineering. Release templates require separate explicit authorization for each live gate.
