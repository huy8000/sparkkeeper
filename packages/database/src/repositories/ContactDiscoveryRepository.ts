import { createHash, randomUUID } from 'node:crypto';
import {
  DISCOVERY_STABLE_KINDS,
  validateContactObservation,
  validateIdempotencyKey,
  type ContactObservation,
  type ContactSyncFailureCode,
  type ContactSyncRunStatus,
  type ContactType,
  type ContactAvailabilityStatus,
  type ContactIdentityStatus,
} from '@sparkkeeper/shared';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  accounts,
  accountLoginSessions,
  auditEvents,
  contactIdentities,
  contacts,
  contactSyncRuns,
  dailyRuns,
  executionRuns,
  scheduledRunSnapshots,
  type ContactSyncRunRow,
} from '../schema/index.js';
import { ACTIVE_LOGIN_SESSION_STATUSES } from './AccountLoginSessionRepository.js';

export class ContactDiscoveryError extends Error {
  constructor(
    readonly code:
      | 'ACCOUNT_NOT_FOUND'
      | 'ACCOUNT_NOT_READY'
      | 'PROFILE_BUSY'
      | 'IDEMPOTENCY_CONFLICT'
      | 'VALIDATION_ERROR',
  ) {
    super(code);
  }
}
export interface DiscoveryPublication {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'AUTH_EXPIRED';
  failureCode: ContactSyncFailureCode | null;
  observations: readonly ContactObservation[];
  issueCount: number;
  authChecked: boolean;
}
export interface ContactListOptions {
  limit: number;
  query?: string;
  type?: ContactType;
  availability?: ContactAvailabilityStatus;
  identityStatus?: ContactIdentityStatus;
  after?: { createdAt: number; id: string };
}
type Tx = Parameters<Parameters<DatabaseClient['orm']['transaction']>[0]>[0];
const active = ['PENDING', 'RUNNING'] as const;
const keyOf = (kind: string, value: string) => JSON.stringify([kind, value]);

export class ContactDiscoveryRepository {
  constructor(private readonly client: DatabaseClient) {}

  replay(accountId: string, adminId: string, key: string) {
    const digest = createHash('sha256')
      .update(`contact-sync\0${validateIdempotencyKey(key)}`)
      .digest('hex');
    const row = this.client.orm
      .select()
      .from(contactSyncRuns)
      .where(
        and(
          eq(contactSyncRuns.requestedByAdminUserId, adminId),
          eq(contactSyncRuns.idempotencyKeyDigest, digest),
        ),
      )
      .get();
    if (row && row.accountId !== accountId) throw new ContactDiscoveryError('IDEMPOTENCY_CONFLICT');
    return row;
  }

  start(
    accountId: string,
    adminId: string,
    key: string,
    now = new Date(),
  ): { replay: boolean; run: ContactSyncRunRow } {
    const digest = createHash('sha256')
      .update(`contact-sync\0${validateIdempotencyKey(key)}`)
      .digest('hex');
    return this.client.withBusyTimeout(500, () =>
      this.client.orm.transaction(
        (tx) => {
          const replay = tx
            .select()
            .from(contactSyncRuns)
            .where(
              and(
                eq(contactSyncRuns.requestedByAdminUserId, adminId),
                eq(contactSyncRuns.idempotencyKeyDigest, digest),
              ),
            )
            .get();
          if (replay) {
            if (replay.accountId !== accountId)
              throw new ContactDiscoveryError('IDEMPOTENCY_CONFLICT');
            return { replay: true, run: replay };
          }
          const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
          if (!account || account.profileState === 'PROVISIONING')
            throw new ContactDiscoveryError('ACCOUNT_NOT_FOUND');
          if (
            account.lifecycleStatus !== 'ACTIVE' ||
            account.profileState !== 'READY' ||
            account.loginStatus !== 'READY'
          )
            throw new ContactDiscoveryError('ACCOUNT_NOT_READY');
          if (
            tx
              .select({ id: contactSyncRuns.id })
              .from(contactSyncRuns)
              .where(inArray(contactSyncRuns.status, [...active]))
              .get() ||
            tx
              .select({ id: accountLoginSessions.id })
              .from(accountLoginSessions)
              .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
              .get() ||
            this.executionBusy(tx)
          )
            throw new ContactDiscoveryError('PROFILE_BUSY');
          const run = tx
            .insert(contactSyncRuns)
            .values({
              id: randomUUID(),
              accountId,
              requestedByAdminUserId: adminId,
              idempotencyKeyDigest: digest,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          this.audit(tx, run, 'CONTACT_SYNC_STARTED', now);
          return { replay: false, run };
        },
        { behavior: 'immediate' },
      ),
    );
  }
  executionBusy(tx: Tx | DatabaseClient['orm'] = this.client.orm): boolean {
    return (
      !!tx
        .select({ id: scheduledRunSnapshots.runId })
        .from(scheduledRunSnapshots)
        .where(eq(scheduledRunSnapshots.activeSlot, 1))
        .get() ||
      !!tx
        .select({ id: executionRuns.id })
        .from(executionRuns)
        .where(inArray(executionRuns.status, ['PENDING', 'RUNNING']))
        .limit(1)
        .get() ||
      !!tx
        .select({ id: dailyRuns.id })
        .from(dailyRuns)
        .where(eq(dailyRuns.status, 'RUNNING'))
        .limit(1)
        .get()
    );
  }
  find(id: string) {
    return this.client.orm.select().from(contactSyncRuns).where(eq(contactSyncRuns.id, id)).get();
  }
  findActive() {
    return this.client.orm
      .select()
      .from(contactSyncRuns)
      .where(inArray(contactSyncRuns.status, [...active]))
      .all();
  }
  latest(accountId: string) {
    return this.client.orm
      .select()
      .from(contactSyncRuns)
      .where(eq(contactSyncRuns.accountId, accountId))
      .orderBy(desc(contactSyncRuns.createdAt), desc(contactSyncRuns.id))
      .limit(1)
      .get();
  }
  account(id: string) {
    const value = this.client.orm.select().from(accounts).where(eq(accounts.id, id)).get();
    return value?.profileState === 'PROVISIONING' ? undefined : value;
  }
  running(id: string, now = new Date()) {
    return this.client.orm
      .update(contactSyncRuns)
      .set({ status: 'RUNNING', startedAt: now, updatedAt: now })
      .where(and(eq(contactSyncRuns.id, id), eq(contactSyncRuns.status, 'PENDING')))
      .returning()
      .get();
  }
  interrupt(id: string, now = new Date()) {
    return this.publish(
      id,
      {
        status: 'FAILED',
        failureCode: 'PROCESS_INTERRUPTED',
        observations: [],
        issueCount: 0,
        authChecked: false,
      },
      now,
    );
  }

  publish(
    id: string,
    publication: DiscoveryPublication,
    now = new Date(),
  ): ContactSyncRunRow | undefined {
    if (
      publication.observations.length + publication.issueCount > 500 ||
      !Number.isSafeInteger(publication.issueCount) ||
      publication.issueCount < 0 ||
      (publication.status === 'COMPLETE') !== (publication.failureCode === null) ||
      (['COMPLETE', 'PARTIAL', 'AUTH_EXPIRED'].includes(publication.status) &&
        !publication.authChecked)
    )
      throw new ContactDiscoveryError('VALIDATION_ERROR');
    const observations = publication.observations.map(validateContactObservation);
    if (observations.some((o) => o.observedAt > now.getTime()))
      throw new ContactDiscoveryError('VALIDATION_ERROR');
    return this.client.withBusyTimeout(500, () =>
      this.client.orm.transaction(
        (tx) => {
          const run = tx.select().from(contactSyncRuns).where(eq(contactSyncRuns.id, id)).get();
          if (!run || !active.includes(run.status as (typeof active)[number])) return run;
          const account = tx.select().from(accounts).where(eq(accounts.id, run.accountId)).get();
          let status: ContactSyncRunStatus = publication.status;
          let failureCode = publication.failureCode;
          let issueCount = publication.issueCount;
          let createdCount = 0,
            updatedCount = 0,
            staleCount = 0,
            unavailableCount = 0,
            candidateCount = 0;
          const seen = new Set<string>();
          if (
            !account ||
            account.lifecycleStatus !== 'ACTIVE' ||
            account.profileState !== 'READY' ||
            account.loginStatus !== 'READY'
          ) {
            status = 'FAILED';
            failureCode = 'PROFILE_UNAVAILABLE';
          }
          const eligible = status === 'COMPLETE' || status === 'PARTIAL';
          if (eligible) {
            // Connect by stable values AND existing stable identity owners. Never by names.
            const nodes = observations.map((o) => {
              const clauses = Object.entries(o.identities).map(([kind, value]) =>
                and(
                  eq(contactIdentities.kind, kind as (typeof DISCOVERY_STABLE_KINDS)[number]),
                  eq(contactIdentities.normalizedValue, value),
                ),
              );
              const rows = tx
                .select()
                .from(contactIdentities)
                .where(and(eq(contactIdentities.accountId, run.accountId), or(...clauses)))
                .all();
              return {
                o,
                rows,
                keys: [
                  ...Object.entries(o.identities).map(([k, v]) => keyOf(k, v)),
                  ...rows.filter((r) => r.state === 'ACTIVE').map((r) => `owner:${r.contactId}`),
                ],
              };
            });
            const parent = nodes.map((_, i) => i);
            const root = (i: number): number =>
              parent[i] === i ? i : (parent[i] = root(parent[i]!));
            const owner = new Map<string, number>();
            nodes.forEach((n, i) =>
              n.keys.forEach((k) => {
                const j = owner.get(k);
                if (j === undefined) owner.set(k, i);
                else parent[root(i)] = root(j);
              }),
            );
            const groups = new Map<number, typeof nodes>();
            nodes.forEach((n, i) => {
              const r = root(i);
              const group = groups.get(r) ?? [];
              group.push(n);
              groups.set(r, group);
            });
            candidateCount = groups.size + publication.issueCount;
            for (const group of groups.values()) {
              const sorted = [...group].sort((a, b) => a.o.observedAt - b.o.observedAt);
              const latest = sorted.at(-1)!.o;
              const identities: ContactObservation['identities'] = {};
              let conflict = group.some(
                (n) => n.o.type !== latest.type || n.rows.some((r) => r.state === 'SUPERSEDED'),
              );
              for (const n of group)
                for (const [k, v] of Object.entries(n.o.identities)) {
                  const kind = k as (typeof DISCOVERY_STABLE_KINDS)[number];
                  if (identities[kind] !== undefined && identities[kind] !== v) conflict = true;
                  identities[kind] = v;
                }
              const matched = [
                ...new Set(
                  group.flatMap((n) =>
                    n.rows.filter((r) => r.state === 'ACTIVE').map((r) => r.contactId),
                  ),
                ),
              ];
              const existing =
                matched.length === 1
                  ? tx
                      .select()
                      .from(contacts)
                      .where(
                        and(eq(contacts.id, matched[0]!), eq(contacts.accountId, run.accountId)),
                      )
                      .get()
                  : undefined;
              if (matched.length > 1 || (existing && existing.type !== latest.type))
                conflict = true;
              if (conflict) {
                issueCount++;
                const implicated = [
                  ...new Set(group.flatMap((n) => n.rows.map((r) => r.contactId))),
                ];
                if (implicated.length)
                  tx.update(contacts)
                    .set({ identityStatus: 'AMBIGUOUS', updatedAt: now })
                    .where(
                      and(eq(contacts.accountId, run.accountId), inArray(contacts.id, implicated)),
                    )
                    .run();
                continue;
              }
              const contactId = existing?.id ?? randomUUID();
              const preferred = existing
                ? tx
                    .select()
                    .from(contactIdentities)
                    .where(
                      and(
                        eq(contactIdentities.contactId, contactId),
                        eq(contactIdentities.state, 'ACTIVE'),
                        eq(contactIdentities.isPreferred, true),
                      ),
                    )
                    .get()
                : undefined;
              const initialKind =
                latest.type === 'PERSON'
                  ? (['SEC_UID', 'UNIQUE_ID', 'SHORT_ID'] as const).find(
                      (k) => identities[k] !== undefined,
                    )
                  : latest.type === 'GROUP'
                    ? 'CONVERSATION_ID'
                    : undefined;
              let identityStatus: ContactIdentityStatus =
                existing?.identityStatus ?? (initialKind ? 'READY' : 'UNAVAILABLE');
              if (existing && !['CHANGED', 'AMBIGUOUS'].includes(identityStatus)) {
                if (
                  preferred &&
                  identities[preferred.kind as (typeof DISCOVERY_STABLE_KINDS)[number]] !==
                    preferred.normalizedValue
                )
                  identityStatus = 'CHANGED';
                else if (!preferred) identityStatus = 'UNAVAILABLE';
              }
              const observedAt = new Date(
                Math.max(latest.observedAt, existing?.lastSeenAt.getTime() ?? 0),
              );
              const metadata = {
                displayName: latest.displayName,
                remarkName: latest.remarkName,
                avatarRemoteUrl: latest.avatarRemoteUrl,
                availabilityStatus: 'AVAILABLE' as const,
                identityStatus,
                lastSeenAt: observedAt,
                missedFullSyncCount: 0,
                firstMissingAt: null,
                updatedAt: now,
                ...(latest.streakDays === null
                  ? {}
                  : {
                      streakDays: latest.streakDays,
                      streakUpdatedAt: new Date(latest.observedAt),
                    }),
              };
              if (existing) {
                tx.update(contacts).set(metadata).where(eq(contacts.id, contactId)).run();
                updatedCount++;
              } else {
                tx.insert(contacts)
                  .values({
                    id: contactId,
                    accountId: run.accountId,
                    type: latest.type,
                    discoveredAt: observedAt,
                    createdAt: now,
                    ...metadata,
                  })
                  .run();
                createdCount++;
              }
              seen.add(contactId);
              for (const [kind, value] of [
                ...Object.entries(identities),
                ['DISPLAY_NAME', latest.displayName],
                ...(latest.remarkName ? [['REMARK_NAME', latest.remarkName]] : []),
              ]) {
                const typedKind = kind as typeof contactIdentities.$inferInsert.kind;
                const old = tx
                  .select()
                  .from(contactIdentities)
                  .where(
                    and(
                      eq(contactIdentities.contactId, contactId),
                      eq(contactIdentities.kind, typedKind),
                      eq(contactIdentities.normalizedValue, value!),
                      eq(contactIdentities.state, 'ACTIVE'),
                    ),
                  )
                  .get();
                if (old)
                  tx.update(contactIdentities)
                    .set({
                      lastObservedAt: new Date(
                        Math.max(old.lastObservedAt.getTime(), latest.observedAt),
                      ),
                      updatedAt: now,
                    })
                    .where(eq(contactIdentities.id, old.id))
                    .run();
                else {
                  if (kind === 'DISPLAY_NAME' || kind === 'REMARK_NAME')
                    tx.update(contactIdentities)
                      .set({ state: 'SUPERSEDED', supersededAt: now, updatedAt: now })
                      .where(
                        and(
                          eq(contactIdentities.contactId, contactId),
                          eq(contactIdentities.kind, typedKind),
                          eq(contactIdentities.state, 'ACTIVE'),
                        ),
                      )
                      .run();
                  tx.insert(contactIdentities)
                    .values({
                      id: randomUUID(),
                      accountId: run.accountId,
                      contactId,
                      kind: typedKind,
                      value: value!,
                      normalizedValue: value!,
                      source: 'DOM',
                      state: 'ACTIVE',
                      isPreferred: !existing && kind === initialKind,
                      firstObservedAt: new Date(latest.observedAt),
                      lastObservedAt: new Date(latest.observedAt),
                      createdAt: now,
                      updatedAt: now,
                    })
                    .run();
                }
              }
            }
            if (issueCount > 0) {
              status = 'PARTIAL';
              failureCode = 'PARSER_CONTRACT_FAILURE';
            }
            if (status === 'COMPLETE') {
              const directory = tx
                .select()
                .from(contacts)
                .where(eq(contacts.accountId, run.accountId))
                .all();
              for (const contact of directory) {
                if (seen.has(contact.id)) {
                  tx.update(contacts)
                    .set({ lastFullSyncId: id })
                    .where(eq(contacts.id, contact.id))
                    .run();
                  continue;
                }
                const count = contact.missedFullSyncCount + 1;
                const first = contact.firstMissingAt ?? now;
                const unavailable = count >= 3 && now.getTime() - first.getTime() >= 86400000;
                if (unavailable) unavailableCount++;
                else staleCount++;
                tx.update(contacts)
                  .set({
                    missedFullSyncCount: count,
                    firstMissingAt: first,
                    lastFullSyncId: id,
                    availabilityStatus: unavailable ? 'UNAVAILABLE' : 'STALE',
                    updatedAt: now,
                  })
                  .where(eq(contacts.id, contact.id))
                  .run();
              }
            }
          }
          const result = tx
            .update(contactSyncRuns)
            .set({
              status,
              isComplete: status === 'COMPLETE',
              failureCode,
              createdCount,
              updatedCount,
              staleCount,
              unavailableCount,
              issueCount: eligible ? issueCount : 0,
              candidateCount,
              finishedAt: now,
              updatedAt: now,
            })
            .where(and(eq(contactSyncRuns.id, id), inArray(contactSyncRuns.status, [...active])))
            .returning()
            .get();
          if (!result) throw new Error('Discovery CAS failed.');
          if (account && (eligible || publication.authChecked))
            tx.update(accounts)
              .set({
                ...(eligible ? { lastContactSyncAt: now } : {}),
                ...(publication.authChecked ? { lastAuthCheckAt: now } : {}),
                ...(failureCode === 'AUTH_UNKNOWN' ? { loginStatus: 'UNKNOWN' as const } : {}),
                ...(status === 'AUTH_EXPIRED' ? { loginStatus: 'AUTH_EXPIRED' as const } : {}),
                updatedAt: now,
              })
              .where(eq(accounts.id, account.id))
              .run();
          this.audit(tx, result, 'CONTACT_SYNC_FINISHED', now);
          return result;
        },
        { behavior: 'immediate' },
      ),
    );
  }
  contact(id: string) {
    const row = this.client.orm.select().from(contacts).where(eq(contacts.id, id)).get();
    return row && this.account(row.accountId) ? row : undefined;
  }
  identities(id: string) {
    return this.client.orm
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, id))
      .orderBy(desc(contactIdentities.isPreferred), desc(contactIdentities.lastObservedAt))
      .limit(100)
      .all();
  }
  list(accountId: string, options: ContactListOptions) {
    const clauses = [eq(contacts.accountId, accountId)];
    if (options.type) clauses.push(eq(contacts.type, options.type));
    if (options.availability) clauses.push(eq(contacts.availabilityStatus, options.availability));
    if (options.identityStatus) clauses.push(eq(contacts.identityStatus, options.identityStatus));
    if (options.query) {
      const pattern = `%${options.query.replace(/[\\%_]/gu, '\\$&')}%`;
      clauses.push(
        sql`(${contacts.displayName} like ${pattern} escape '\\' or ${contacts.remarkName} like ${pattern} escape '\\')`,
      );
    }
    if (options.after)
      clauses.push(
        or(
          gt(contacts.createdAt, new Date(options.after.createdAt)),
          and(
            eq(contacts.createdAt, new Date(options.after.createdAt)),
            gt(contacts.id, options.after.id),
          ),
        )!,
      );
    return this.client.orm
      .select()
      .from(contacts)
      .where(and(...clauses))
      .orderBy(asc(contacts.createdAt), asc(contacts.id))
      .limit(Math.min(200, Math.max(1, options.limit)) + 1)
      .all();
  }
  private audit(
    tx: Tx,
    run: ContactSyncRunRow,
    action: 'CONTACT_SYNC_STARTED' | 'CONTACT_SYNC_FINISHED',
    now: Date,
  ) {
    tx.insert(auditEvents)
      .values({
        id: randomUUID(),
        actorAdminUserId: run.requestedByAdminUserId,
        action,
        entityType: 'CONTACT_SYNC_RUN',
        entityId: run.id,
        outcome:
          action === 'CONTACT_SYNC_FINISHED' && ['FAILED', 'AUTH_EXPIRED'].includes(run.status)
            ? 'FAILED'
            : 'SUCCESS',
        reasonCode: run.failureCode,
        createdAt: now,
      })
      .run();
  }
}
