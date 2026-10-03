import { ApiClient, type ApiClientOptions } from './client';
export interface AdminSessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  sessionVersion: number;
  current: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function createSecurityApi(options: ApiClientOptions) {
  const c = new ApiClient(options);
  return {
    sessions: (signal?: AbortSignal) =>
      c.get(
        '/auth/sessions',
        (v) => {
          if (
            !Array.isArray(v) ||
            v.length > 50 ||
            !v.every(
              (r) =>
                object(r) &&
                typeof r.id === 'string' &&
                /^[0-9a-f-]{36}$/u.test(r.id) &&
                [r.createdAt, r.lastSeenAt, r.idleExpiresAt, r.absoluteExpiresAt].every(iso) &&
                (r.revokedAt === null || iso(r.revokedAt)) &&
                Number.isInteger(r.sessionVersion) &&
                (r.sessionVersion as number) >= 1 &&
                typeof r.current === 'boolean',
            )
          )
            return undefined;
          return v as AdminSessionSummary[];
        },
        signal,
      ),
    reauth: (password: string) =>
      c.mutate('POST', '/auth/reauth', { password }, (v) =>
        object(v) && iso(v.reauthenticatedUntil)
          ? { reauthenticatedUntil: v.reauthenticatedUntil as string }
          : undefined,
      ),
    changePassword: (currentPassword: string, newPassword: string) =>
      c.mutate('POST', '/auth/change-password', { currentPassword, newPassword }, () => true),
    revoke: (r: AdminSessionSummary) =>
      c.mutate(
        'POST',
        `/auth/sessions/${encodeURIComponent(r.id)}/revoke`,
        { expectedSessionVersion: r.sessionVersion },
        () => true,
      ),
  };
}
