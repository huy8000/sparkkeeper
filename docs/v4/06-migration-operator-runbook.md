# V4 migration operator runbook (offline only)

This is an operator procedure, **not authorization to run a production migration or any live gate**. V4-9 development/rehearsal uses disposable synthetic data only. No browser is started by the CLI. Production scheduler/send remains closed.

## Preflight and complete backup

1. Record the deployed image digest/version and data volume location. Keep `SCHEDULER_ENABLED=false`, `SCHEDULER_ALLOW_REAL_SEND=false`, `MANUAL_RUN_ENABLED=false`. Do not use the legacy maintenance browser to migrate.
2. Stop app, maintenance and any host/dev browser workers. Confirm no containers/processes still use the volume; never delete a profile lock to bypass a running owner. The CLI also takes the same `browser-profile.lock` via native nonblocking flock, rejects persisted active runtime slots and ownership artifacts/SingletonLock. Host/dev processes must also be explicitly stopped: a checkbox is not process cleanup proof.
3. Back up **the entire stopped DATA_DIR** to a separate restricted location, including DB + any WAL/SHM, browser-profile(s), staging/quarantine, avatars and evidence. A SQLite-only copy is not a complete backup. Verify the copy, permissions, available disk space and checksum/inventory before proceeding. Do not dump profile or message contents to logs. Backup copies are sensitive (0700 directory, restricted storage); keep outside Git.
4. Use the same fixed canonical DATA_DIR (no symlink ancestors). Custom legacy `BROWSER_PROFILE_DIR` is deliberately unsupported; do not guess ownership or copy an external profile. Resolve that operator configuration offline before using the tooling.

Built application commands (local build: `pnpm --filter @sparkkeeper/server build`; dependencies must already be built):

```sh
DATA_DIR=/canonical/stopped/data node apps/server/dist/migration-cli.js preflight
DATA_DIR=/canonical/stopped/data node apps/server/dist/migration-cli.js migrate --stopped --full-backup-confirmed
DATA_DIR=/canonical/stopped/data node apps/server/dist/migration-cli.js audit
```

For a **stopped** Docker volume, use an operator-approved one-off app-runtime container with the regular app entrypoint bypassed (`--entrypoint node /app/server/dist/migration-cli.js ...`); do not run the normal service to perform this procedure. Preflight/audit open an existing DB read-only, never auto migrate. Output is safe counts/version/integrity/FK status and aggregate legacy-row fingerprints, not names, identities, messages, URLs or profile payload. Fresh-install schema creation remains the normal application's migration path, not this upgrade CLI.

Expected upgrade: 0000–0007 (V3), or a verified prefix through 0012, to **0000–0013 / 14 migrations**. Original legacy column values/fingerprints and rows must remain identical. Bridges are PENDING; no Contact/Task/Resolution is automatically created, and no migrated task is enabled. Current schema reopens/repeats idempotently. Nonzero exit means STOP; preserve backup/ownership and inspect safe diagnostics, do not continue by force.

## Legacy profile binding vs relogin

Only exactly one ACTIVE MIGRATION_REQUIRED Account with no recorded V4 identity can explicitly claim the fixed old directory:

```sh
DATA_DIR=/canonical/stopped/data node apps/server/dist/migration-cli.js bind-profile --account-id ACCOUNT_UUID --stopped --full-backup-confirmed
```

- CLI accepts no profile path. Account/operation UUID, source device/inode, PREPARED/COMPLETED intent and audit are persisted.
- PREPARED intent → ownership marker/fsync → dirfd atomic NOREPLACE same-filesystem rename → DB transaction publishes READY, **login UNKNOWN**. The legacy snapshot/profile is not authentication proof; use existing explicit RELOGIN before discovery/eligibility.
- Crash after preparation/marker/rename: repeat the same command with the same Account to reconcile only that intent. PREPARED prevents normal app startup and new login/discovery/send admission. Missing/mismatched marker/inode, both paths, destination collision, symlink, runtime ownership or unsupported atomic rename: fail closed; do not delete intent, markers, locks or destination. Restore the complete pre-operation backup if recovery cannot be proven. No override flag exists.
- Once COMPLETED, repetition verifies only the original final inode/marker; a later empty legacy directory is never rebound. If RELOGIN subsequently replaces that profile, do not reuse the old migration binding receipt to claim the replacement.
- Multi-account/unknown ownership: no automatic binding/copy. Keep MIGRATION_REQUIRED and relogin each Account individually through V4 onboarding; preserve the old profile offline. Only a separately authorized live Gate B may exercise actual login/discovery.

The V4 ownership marker retains its existing compatibility field `createdByLoginSessionId`; for this offline operation the UUID is the durable migration intent's ID, **not an interactive LoginSession or console authorization**. The marker is ownership metadata only. Legacy profile binding has no authenticated browser/console capability.

## Explicit Friend / Schedule / UNKNOWN operations

- `/operations/migration`: choose Account and discovered Contact IDs manually. The UI never auto matches displayName/list position. Binding/dismissal uses bridge UUID + expectedUpdatedAt + explicit confirmation and recent auth. No original Friend or history is changed.
- Schedule import explicitly chooses name/template/Contact IDs and preserves the stored window/retry snapshot. Task+targets+import+audit publish atomically, **disabled** even when old Schedule enabled=true. No enable action appears in the migration UI.
- `/history` unifies LEGACY_V3 and V4 run reads. Existing `/runs` keeps its legacy filtered view and links to mixed history. UUID collision across sources fails closed, never silently prefers one source.
- UNKNOWN resolution requires explicit recent-auth confirmation and current chain tail. HUMAN history is append-only, original machine status/message/action boundary unchanged. CONFIRMED_NOT_DELIVERED never schedules/retries a send. Optional note ≤500; do not paste credentials, raw identities or chat content. Notes only appear on protected resolution reads, not logs/audit/SSE/notifications.

## Restore / rollback

Keep all services/maintenance/workers stopped. Quarantine the failed entire root without deleting it, create an **empty separate restore root**, and restore the complete verified backup (DB/WAL/SHM/profiles together) with original restricted permissions. Use the original recorded image. Verify read-only integrity/FKs, original migration prefix and legacy fingerprints before considering an authorized restart. Never reverse SQL, `db push`, restore only SQLite while keeping a changed profile, overwrite a populated destination, or run an old image against the newly migrated DB. Keep restore artifacts outside Git. This milestone does not authorize production restart/deploy.

## Observability / privacy / retention

- Legacy SystemEvents retain their rows; API messages are fixed projections and error codes allowlisted. V4 safe system events are separate append-only enum/ID/time facts atomically emitted on run/record transitions. No change to historical V3 CHECK constraints.
- Relay starts at the current high-water mark: no restart notification replay. New facts produce best-effort safe SSE/notifications through existing authenticated stream and SSRF-safe notifier/cooldown. Observer failure never changes machine truth or retries business execution.
- Audit reads expose action/entity/internal IDs/outcome/time, not note/correlationDigest/raw exceptions. Default HTTP request logging omits raw URL/body/IP; existing credential redaction remains and note/identity fields are additionally redacted.
- Run/send/history/audit/resolution rows are never automatically deleted. Avatar bytes retain existing 30-day expiry/cache degradation. Evidence retention remains limited to configured screenshot/trace roots; never point evidence/log retention at profile, DB or avatar roots. No online profile quarantine cleanup is introduced: only an offline operator with complete backup confirmation may remove proven-owned quarantine older than30 days; ambiguity means retain, never delete active/final/staging profiles. Fully automated cleanup is not part of this milestone.

## Rehearsal

```sh
pnpm --filter @sparkkeeper/server v4:migration:smoke
```

Disposable populated V3 fixture: full-root backup → read-only preflight → schema upgrade/audit → exact legacy preservation/no automatic conversion → repeat/reopen → complete backup restore. Native profile fixture covers pinned inode/marker, no-overwrite/symlink rejection, crash after rename/recovery, multi-account refusal and real competing-process flock. No real browser/profile/Douyin or send is used.

Linux process-group fixtures must run with a reaping init (`docker run --init`, as already configured by Compose `init: true`). Without a reaper, killed detached children may remain zombies: supervisor correctly refuses to release ownership. This is not a reason to bypass cleanup proof or remove markers/leases.
