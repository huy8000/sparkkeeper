# V4-10 Gate A Evidence — PASS / NO-SEND

日期：2026-10-04（Asia/Shanghai）。授权：当前 V4-10 Milestone Owner 工程/隔离测试/commit/push/PR；未授权真实账号、Douyin、发送、Gates B–F、生产迁移、merge/release/deploy。

## Verification object

- Baseline：`develop@f91e7247c7b6f84ed94b2d2dc1cf614a315e3f25`（V4-9 PR #49）。Branch：`feature/v4-10-ui-security-e2e`，本文随最终 PR 交付；验证时为 reviewed uncommitted working tree，非生产目录。
- 精确 source manifest SHA-256：`e9abb83dec41722d89ce7d7e2661d6f1c71f5fa5663bc476de51554153f58221`。涵盖相对基线的 65 个变更代码/测试/配置文件（tracked + untracked，排除 `docs/**` / `README.md`）；按路径排序，逐项 `path + NUL + SHA256(file bytes) + LF` 后再 SHA256。文档状态/evidence 不影响此验证对象。
- 环境：macOS arm64；Docker Linux arm64、Node 24 / pnpm 11.19.0、Playwright 1.62.1。Caddy 实际 binary v2.11.7；Nginx 实际 binary 1.30.5，均使用固定 base digest/官方 release 校验。
- Verified local image IDs（不是已发布 registry digest）：app `sha256:a4e914e544f00af513dd1e838f8f08c437753121f6018d50357de9a4ca5e9257`；admin `sha256:d053c9b5b20d6c1c041b8330dab1653414e649462ba68cc815ca846a55c4a310`；edge `sha256:76d1443c3a787f62bba5245e3a565e12aa91ec568eee658f85e7fc5c258654b8`。最终 Unicode UI test assertion 后仅测试文件变化，production sources 与所验证镜像一致。

## Commands / results

| Command / group | Result |
| --- | --- |
| `pnpm test` | PASS：shared 33/33、message-engine 21/21、notifier 13/13、automation 136/136、database 301/301、admin-web 398/398、server 488 PASS + 3 Linux-only skips（491 total）、Docker static 9/9 |
| `pnpm --filter admin-web test`（最终 Unicode UI assertion 后） | PASS 398/398 |
| `pnpm typecheck` / 最终 `pnpm --filter admin-web typecheck` | 全 workspace PASS / PASS |
| `pnpm build` / 最终 `pnpm --filter admin-web build` | 全 workspace production/native PASS / PASS |
| `pnpm lint` | ESLint + Prettier PASS |
| `pnpm --filter server v4:migration:smoke` | 5/5 PASS：populated legacy preservation、backup/restore/reopen、owned profile reconciliation、symlink/race、真实 competing-process lease |
| `docker compose config --quiet` | PASS；default 只有 edge TCP 80/443 published |
| `docker compose build app admin edge` | PASS：production app/admin/edge；三种 native helper 均可执行，无 compiler 留在 app runtime |
| Caddy `adapt --validate`（`--network none`，reference config） | PASS；未运行公网 ACME |
| `docker build --target build -t sparkkeeper-v410-test:local .` + `docker run --rm --init --network none ... pnpm --filter server exec tsx --test test/AccountLoginWorkerSupervisor.test.ts test/ContactDiscoverySupervisor.test.ts test/MigrationRecovery.test.ts` | 17/17 PASS，零 skip；补验 Linux persisted/detached Chromium group recovery 与 stop 后 late-proof race，无法验证则保留 ownership/lease |
| `pnpm gate:a --skip-build`（刚完成同 production source 的镜像构建） | PASS，结果见下；默认 `pnpm gate:a` 自动构建 |
| `git diff --check` / changed-path + private-key inspection | PASS；无真实 credentials/account/chat/profile/runtime/log/DB/CA artifacts；ignored operator files 保留 |

一次并行重跑触发合成 DOM fixture 的 250ms 短预算波动（保守返回 UNKNOWN，非错误 SUCCESS）。仅将合成测试的默认等待预算调整为 bounded 1500ms；显式 30ms timeout、至多一次 action、UNKNOWN 不 retry 的断言及生产 deadlines 不变。最终完整测试通过。3 个 onboarding/profile 文件仅补齐原先的 Prettier 格式，无生产语义变化。

## Observed no-send / security proof

隔离随机 Compose project、专属 named volumes、合成 disabled Account（MIGRATION_REQUIRED / UNKNOWN，无 profile）；HTTPS origin `https://sparkkeeper.test:18443`、私有 CA，不使用真实域名/ACME。只绑定 loopback18080/18443；app/admin/maintenance 无 host publish。production scheduling/execution/manual gates false / hard closed。

- 中英两种语言，1440px / 390px，15 个只读页面：无 root overflow、无 browser runtime error；dialog Tab/Shift+Tab/Escape/restore、背景 inert、中文默认与 `html lang` 均通过。语言 parity/focus/realtime 的 unit regression 保留。
- Node HTTPS 私有 CA validation、HTTP→HTTPS 308、security headers / SPA CSP、Secure + HttpOnly + Strict + Path=/ 的 `__Host-` session cookie、JS 不可读 cookie。
- REST/SSE/console HTTP/WS 匿名拒绝；CSRF 缺失/伪造 Origin 拒绝；logout 后 REST/SSE 401。已有 server regressions覆盖持续 expiry/revocation/owner/profile lease、auth DB 故障 fail closed。
- 真实 Caddy→Nginx→app chain 不允许伪造 XFF/X-Real-IP/XFP/Forwarded/forwarded-host 决定 client IP/origin；不同 unknown username 与不同 spoof IP 仍命中同一真实 IP 限流，429 + Retry-After。
- 新 reauth/password/session 管理仍在既有 guards 内；事务末尾重验有效 session/version/hash，改密码原子撤销全部 session；Argon2 每个更强维度均不降级。credential 不匹配不伪装成 session loss，不 replay mutation。
- 常规请求及刻意 upstream failure 的日志，均不含 query/header privacy sentinel、随机密码、session cookie 值、CSRF。Nginx safe method/status access log、无不可脱敏 error log；Caddy默认 logger 删除完整 request/response-header 对象；应用 redaction regression 保留。
- `chromium-launcher` / `rename-noreplace` / `contact-files` 在最终 app runtime 可执行；profile 数=0，Chromium/Xvfb/Openbox/x11vnc/websockify runtime worker 进程数=0。

最终隔离 E2E 计数：

```json
{"gate":"A","result":"PASS","locales":2,"widths":[1440,390],"routes":15,"externalRequests":0,"businessMutations":0,"counts":{"dailyRuns":0,"executionRuns":0,"testSendIntents":0,"sendRecords":0,"targetSendRecords":0,"accountLoginSessions":0,"contactSyncRuns":0},"migrations":14,"profiles":0,"browserWorkerProcesses":0,"logRedaction":"PASS (normal + upstream failure)","tls":"private CA validated","gatesBF":"NOT EXECUTED"}
```

Migration：0000–0013，共 14；V4-10 无新增或修改 migration，发送/identity/discovery/migration 核心生产代码不变。统一 history 不覆盖机器结果，imports 不自动启用。安全事件 allowlist/日志敏感字段及 retention 原有 regression 保留；永久 audit/history/human resolution 不清除。隔离项目、volumes、临时 CA 在 finally 清理；真实用户 data / ignored notes 未动。

## Review / limitations / next permitted step

P0=0，P1=0。非阻断 inherited P2：`SupervisorContract.start()` 类型仍为 `void`，实际 production implementation 与 Manager 调用均 async/await；本 milestone 只做格式校正，不改其 lifecycle。

Gate A PASS 只证明 no-send 工程、安全/升级与合成 E2E，不是完整 WCAG 审计、全依赖 CVE 清零、生产部署或 live DOM 验证。Docker实际验证平台为 Linux arm64；公网 DNS/ACME renewal/HSTS长期启用、amd64 runtime、真实 Account/contact/delivery、Gates B–F 均未验。既有 single-target/preferred-only、未接入 live runtime factory、未实现 batch/unbind/auth-check/preferred mutation 继续有效；不允许环境变量绕过。

Permitted next：提交 feature PR → develop，独立 review/merge 另行处理。Release readiness：**NOT READY FOR RELEASE / DEPLOY**；必须先按 [Runbook](./07-release-security-runbook.md) 和 [Gate template](./08-gate-evidence-template.md) 获得各项独立授权，完成适用 live integration/evidence。未 merge/tag/release/deploy。
