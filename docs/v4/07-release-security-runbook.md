# V4 Release / Public Security Runbook

本文件是 reference 操作指引，不是部署授权。当前只验 Gate A；B–F 未执行，production scheduling/send factory 仍 hard closed。不得因 UI/TLS/fixture PASS 打开真实执行。V4-7 单目标、preferred-only resolver、未实现的 unbind/auth-check/preferred mutation/batch 继续按已接受 milestone 限制执行。

## Public reference

`docker-compose.yml`：Internet → Caddy public TCP 80/443 → Nginx internal 8080 → app internal 8080。Caddy admin API off；HTTP/3 未开启。app/admin/maintenance/login worker 都没有默认 host publish。不要打开 8080/5900/6080，也不要用 `network_mode: host`、Docker socket 或全网 trusted proxy。

确定不冲突的网络：Caddy frontend `172.30.10.2`、Nginx frontend `.3`；Nginx backend `172.30.20.2`、app backend `.3`。Fastify 仅信任 `172.30.20.2/32`；Nginx 仅信任 `172.30.10.2` 的 client-IP/HTTPS proto。若网络冲突，必须同时修改 Compose、Nginx peer/map 与 Fastify CIDR 并重跑 spoof/rate evidence，不能只修改 subnet。CDN/其他代理没有默认信任；新增代理链需单独安全设计。

设置真实域名 `SPARKKEEPER_DOMAIN`（不含 scheme/path/port），canonical origin 由 Compose 固定为 `https://<domain>`。`.env.example` 的 loopback development 配置仅适用于直接源码开发；Compose 明确覆盖 production mode/origin/trust。DNS/公网防火墙/ACME/TLS renewal 须在获授权后独立验证。当前不存在实际公网部署。

Caddy 基于官方 pinned image digest，下载并校验官方 v2.11.7 发布 SHA-256（amd64/arm64；其他架构 fail closed）。Registry tag 滞后时不静默保留旧安全版本。升级前复核官方 release、校验和与 base digest；本 milestone 没有宣称全依赖供应链/CVE 清零。参考 [Caddy proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[TLS](https://caddyserver.com/docs/caddyfile/directives/tls)、[automatic HTTPS](https://caddyserver.com/docs/automatic-https)、[v2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)。

TLS 最低 1.2；HTTP 自动 HTTPS redirect。HSTS 默认 `max-age=0`，先验证域名长期 HTTPS、renewal 与恢复，再显式设置 `SPARKKEEPER_HSTS_MAX_AGE`（例如 31536000）；不默认 includeSubDomains/preload。CSP：SPA self-only scripts/no inline/eval；Vue styles 可 inline；no framing/object/base，no-referrer/nosniff/permissions policy。console 保持独立严格 CSP 与 AdminSession + LoginSession/TTL/profile lease + Origin 连续鉴权。SSE/console 使用 cookie，不向 URL 添加 credential/token。

Nginx access log 仅 method/status，无 URI/query/IP/body；其固定 error log 格式不能可靠删除请求字段，因此 reference关闭 Nginx error log，使用安全 status/app/SystemEvent 排障。Caddy不启用 access log，并从默认 runtime logger 删除整个 request/response headers 对象（避免 upstream错误带 query/header）。排障只保留 bounded/redacted 输出，不收集完整请求、认证 headers、浏览器 profiles、screenshots、chat 或 VNC frames 作为普通日志。

Nginx 使用官方 unprivileged `1.30.5-alpine` 固定 digest；替换原先已受安全通告影响的 1.29.1。版本复核依据 [Nginx security advisories](https://nginx.org/en/security_advisories.html)，镜像构建后检查实际 binary version；不把版本更新等同于全依赖 CVE 审计。

## Auth and operator setup

部署前完成下面步骤，但实际运行必须另获授权：

1. 从受信任 revision 构建：`docker compose config --quiet`、`docker compose build app admin edge`。确保全部 production send/scheduler/manual gates false，maintenance profile 未启用。
2. 准备专用 data root 0700，ownership 使用实际镜像 `pwuser` UID/GID（当前镜像是 1001，不硬编码1000）。不得 chmod 777。不要从开发 root 复制未知 live profile。
3. 按 [Migration Runbook](./06-migration-operator-runbook.md) 停止全部 runtime，执行 preflight/audit + 全 root backup，审查恢复结果。0000–0013 共14 migrations，V4-10不新增 migration。
4. Admin bootstrap 仅现有 operator CLI + TTY/stdin；不要 password argv/env/default/Web bootstrap。没有匿名配置 API。启动后只公共 `/api/health` 可匿名（READY 由 DB+migration probe 同时通过决定），详细 runtime/status 需要 AdminSession。
5. 登录后通过 Operations → Security 管理 sessions/reauth/password。reauth 不新建 session、不延长绝对 TTL、不 retry；改密码 atomically version++/撤销全部 session，需重新登录。revoke 有 expected version CAS。密码仅内存输入，不写 localStorage/日志。
6. 用独立已认证浏览器检查只读 health/account/migration，检查 published ports 和 console/SSE expiry/revocation。不要把 session cookie 复制到 shell history/log。

Account登录使用受监管、account-owned V4 worker。legacy maintenance 仅显式本地 debug override `docker/compose.maintenance-local.yml` /现有 wrapper，默认仍无 publish；即使 SSH tunnel 也不授权真实登录。不得通过 legacy全局profile路径为 V4 账号人工标 READY；绑定只能走审计离线 CLI/显式 relogin。

## Gate A reproducible lab

要求 Docker daemon、Compose 支持 `!override`、Node≥22、pnpm11与本地 Playwright browser 已安装。执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter server native:build
pnpm docker:config
pnpm --filter server v4:migration:smoke
pnpm gate:a
```

Gate A 自动构建 production images，创建随机 fixture project/专属 named data 与 Caddy volumes，私有 CA/TLS only、loopback18080/18443。bootstrap 使用随机内存 password 经 stdin；唯一 Account 为合成 MIGRATION_REQUIRED/UNKNOWN/disabled。浏览器 network allowlist 仅 `sparkkeeper.test`，任何业务 mutation/external request 都中止且 gate FAIL。只访问UI/只读 API与 auth 登录/退出，不运行 onboarding/discovery/send。Node HTTPS 校验私有CA；浏览器 fixture-only ignoreHTTPSErrors 不改变生产 TLS。

覆盖双语言/desktop1440+mobile390、15个只读页面、focus trap/restore、secure cookie/CSRF/Origin、匿名 REST/SSE/console/WS、真实 Caddy/Nginx forwarded spoof、跨用户名IP限流、logout后拒绝。最终 DB login/discovery/intent/run/action records 均零、gates false、内部无 published ports、native helpers 可执行。fixture失败也 finally 删除该随机项目/volumes/临时 CA；不操作用户 data root。`--skip-build` 仅限明确刚构建同 revision images的本地重复检查。

Linux process-group recovery/late-proof fixtures 必须在带 `--init` 的隔离 image 运行，以覆盖 macOS 无 `/proc` 的 skips；不能把 macOS skip 算 PASS。升级 rehearsal 仅合成 legacy DB/profile，完整 root backup→migration→restore→reopen、no-auto binding/enable/send。

旧 `docker:smoke` / `docker:maintenance:smoke` 命令现为 Gate A compatibility alias；不再执行已过期的匿名 API / host-port smoke，也不代表验证过 headed legacy maintenance。maintenance wrapper 的显式本地 debug 权限边界仍保留。

## Release / rollback / evidence

每个 Gate 单独授权并填写 [Gate evidence template](./08-gate-evidence-template.md)。Gate A仅证明工程与 no-send security；真实 DOM/headless/身份/发送证据未证明。Gate B 无发送，C/D/E 仅分别明确授权的最多一次单目标，F production-like scheduler 还需独立授权。任何 ambiguity、UNKNOWN、重复、越权、不解释的 verifier 结果即 FAIL，绝不自动 retry 或扩样碰运气。

所有 milestone合并 + A–E evidence 后才讨论 release candidate/main/tag；当前任务不执行这些动作。F 不能通过环境变量偷偷打开。发布后默认 scheduler false，先 read-only检查再考虑独立F授权。没有 validated live adapter/worker factory 前，即使授权 live gate也需先单独实现并审查对应安全集成，不可跳过 hard closed gate。

恢复：停 edge/admin/app/全部worker/maintenance →确认ownership/process tree退出→整root恢复到新的安全目录→匹配备份revision/image启动→只读检查。原 migrations immutable/forward-only，不能倒改 schema。TLS keys/cert Caddy volumes 同样敏感，应单独加密备份并保护 ownership。rollback不触发 UNKNOWN resend、自动 target绑定或Task启用。
