# Release Gate Evidence Template

复制此模板填写单个 Gate，不要把模板当已通过。仅提交脱敏结果/内部 fixture ID；不提交真实账号身份、message/chats、cookie/token/password、profile/CA/private key、截图/trace/完整日志。

- Gate: A / B / C / D / E / F
- Explicit human authorization / scope / maximum send count:
- Revision + base / branch / clean or reviewed diff:
- Environment / OS / runtime / image digests / canonical origin (no secret):
- Production gates / isolated fixture / account-profile-global ownership:
- Commands / exit status / test counts / skip rationale and platform follow-up:
- Expected invariant → observed proof → failure/recovery outcome:
- Migration version / upgrade-preservation / backup-restore-reopen evidence:
- Network allowlist / external request count / business mutation/action count:
- Identity/witness/observer/action/bubble evidence (live only, privacy-safe summary):
- UNKNOWN/ambiguity/timeout/drift: fail closed, no retry/second send:
- Auth/session/CSRF/rate/proxy/TLS/CSP/cookie/SSE/console/ports:
- Runtime cleanup / zero orphan / ownership retained on unverifiable cleanup:
- Privacy/redaction/retention:
- P0 / P1 / nonblocking P2:
- Result: PASS / FAIL / BLOCKED, with explicit unmet criteria:
- Cleanup / working tree / artifacts excluded:
- Reviewer / date / permitted next step:

Gate A: real Douyin=0 / real send=0；B–F必须逐个另行授权。P0/P1未清零不得PASS。Gate A PASS不表示整个V4已可release，未验证liveadapter不允许通过配置绕过。
