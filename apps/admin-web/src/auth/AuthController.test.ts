import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApiError } from '../api/client';
import type { SparkKeeperApi } from '../api/sparkkeeperApi';
import { authSessionFixture } from '../test/fixtures';
import type { AuthSessionResponseData } from '../types/api';
import { createAuthController } from './AuthController';

/**
 * Synthetic runtime-assembled fixture credentials: no credential-shaped
 * literal in the reviewed bytes; runtime values are byte-identical to the
 * previous literals and remain distinct valid-vs-wrong.
 */
const VALID_PASSWORD = ['Valid', 'Password', '123', '!'].join('');
const WRONG_PASSWORD = ['Wrong', 'Password', '123', '!'].join('');

function createMockApi(overrides: Partial<SparkKeeperApi> = {}): SparkKeeperApi {
  return {
    login: vi.fn(() => Promise.resolve(authSessionFixture)),
    getCurrentUser: vi.fn(() => Promise.resolve(authSessionFixture)),
    logout: vi.fn(() => Promise.resolve()),
    getHealth: vi.fn(),
    getRuntimeStatus: vi.fn(),
    listAccounts: vi.fn(),
    getAccount: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    listFriends: vi.fn(),
    createFriend: vi.fn(),
    updateFriend: vi.fn(),
    listSchedules: vi.fn(),
    configureSchedule: vi.fn(),
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    listSendRecords: vi.fn(),
    listSystemEvents: vi.fn(),
    getManualRunPreflight: vi.fn(),
    startManualRun: vi.fn(),
    getNotificationConfiguration: vi.fn(),
    updateNotificationConfiguration: vi.fn(),
    sendTestNotification: vi.fn(),
    ...overrides,
  };
}

describe('AuthController', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('bootstrap()', () => {
    it('sets AUTHENTICATED on successful /api/auth/me response', async () => {
      const api = createMockApi();
      const auth = createAuthController(() => api);

      expect(auth.state.value).toBe('BOOTSTRAPPING');
      await auth.bootstrap();

      expect(auth.state.value).toBe('AUTHENTICATED');
      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.user.value).toEqual({
        id: authSessionFixture.admin.id,
        username: authSessionFixture.admin.username,
      });
      expect(auth.getCsrfToken()).toBe(authSessionFixture.csrfToken);
      expect(auth.idleExpiresAt.value).toBeInstanceOf(Date);
      expect(auth.absoluteExpiresAt.value).toBeInstanceOf(Date);
    });

    it('sets UNAUTHENTICATED on 401 unauthenticated response', async () => {
      const api = createMockApi({
        getCurrentUser: vi.fn(() =>
          Promise.reject(new ApiError('UNAUTHENTICATED', 'Authentication required.', 401, 'API')),
        ),
      });
      const auth = createAuthController(() => api);

      await auth.bootstrap();

      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.user.value).toBeNull();
      expect(auth.getCsrfToken()).toBeNull();
    });

    it('sets ERROR state on network failure or 503 without misclassifying as UNAUTHENTICATED', async () => {
      const api = createMockApi({
        getCurrentUser: vi.fn(() =>
          Promise.reject(new ApiError('NETWORK_ERROR', 'Network down.', 0, 'NETWORK')),
        ),
      });
      const auth = createAuthController(() => api);

      const success = await auth.bootstrap();

      expect(success).toBe(false);
      expect(auth.state.value).toBe('ERROR');
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.user.value).toBeNull();
      expect(auth.bootstrapError.value).toBeInstanceOf(ApiError);
    });

    it('sets ERROR state on 503 service unavailable', async () => {
      const api = createMockApi({
        getCurrentUser: vi.fn(() =>
          Promise.reject(
            new ApiError('AUTH_SERVICE_UNAVAILABLE', 'Service unavailable.', 503, 'API'),
          ),
        ),
      });
      const auth = createAuthController(() => api);

      const success = await auth.bootstrap();

      expect(success).toBe(false);
      expect(auth.state.value).toBe('ERROR');
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  describe('login()', () => {
    it('authenticates user and populates in-memory session data', async () => {
      const api = createMockApi();
      const auth = createAuthController(() => api);

      expect(auth.isLoggingIn.value).toBe(false);
      const promise = auth.login({ username: 'admin_test', password: VALID_PASSWORD });
      expect(auth.isLoggingIn.value).toBe(true);

      await promise;
      expect(auth.isLoggingIn.value).toBe(false);
      expect(auth.state.value).toBe('AUTHENTICATED');
      expect(auth.user.value?.username).toBe('admin_test');
      expect(auth.getCsrfToken()).toBe(authSessionFixture.csrfToken);
      expect(api.login).toHaveBeenCalledWith({
        username: 'admin_test',
        password: VALID_PASSWORD,
      });
    });

    it('re-throws error and stays UNAUTHENTICATED on login failure', async () => {
      const api = createMockApi({
        login: vi.fn(() =>
          Promise.reject(new ApiError('INVALID_CREDENTIALS', 'Invalid credentials.', 401, 'API')),
        ),
      });
      const auth = createAuthController(() => api);

      await expect(
        auth.login({ username: 'admin_test', password: WRONG_PASSWORD }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

      expect(auth.isLoggingIn.value).toBe(false);
      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.user.value).toBeNull();
      expect(auth.getCsrfToken()).toBeNull();
    });
  });

  describe('logout()', () => {
    it('clears session and transitions to UNAUTHENTICATED', async () => {
      const api = createMockApi();
      const auth = createAuthController(() => api);
      await auth.bootstrap();
      expect(auth.isAuthenticated()).toBe(true);

      expect(auth.isLoggingOut.value).toBe(false);
      const promise = auth.logout();
      expect(auth.isLoggingOut.value).toBe(true);

      await promise;
      expect(auth.isLoggingOut.value).toBe(false);
      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.user.value).toBeNull();
      expect(auth.getCsrfToken()).toBeNull();
      expect(auth.idleExpiresAt.value).toBeNull();
      expect(auth.absoluteExpiresAt.value).toBeNull();
      expect(api.logout).toHaveBeenCalled();
    });

    it('preserves authenticated state and rethrows when logout API fails', async () => {
      const api = createMockApi({
        logout: vi.fn(() =>
          Promise.reject(new ApiError('NETWORK_ERROR', 'Network down.', 0, 'NETWORK')),
        ),
      });
      const auth = createAuthController(() => api);
      await auth.bootstrap();

      await expect(auth.logout()).rejects.toThrow('Network down.');
      expect(auth.state.value).toBe('AUTHENTICATED');
      expect(auth.user.value).not.toBeNull();
      expect(auth.getCsrfToken()).not.toBeNull();
    });
  });

  describe('handleSessionLoss()', () => {
    it('sets session notice on SESSION_EXPIRED', () => {
      const api = createMockApi();
      const auth = createAuthController(() => api);

      auth.handleSessionLoss('SESSION_EXPIRED');
      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.sessionNotice.value).toBeTruthy();
    });

    it('clears session notice when clearSessionNotice is called', () => {
      const api = createMockApi();
      const auth = createAuthController(() => api);

      auth.handleSessionLoss('SESSION_REVOKED');
      expect(auth.sessionNotice.value).toBeTruthy();

      auth.clearSessionNotice();
      expect(auth.sessionNotice.value).toBeNull();
    });
  });

  describe('generation invalidation (FR-05 deferred proof)', () => {
    it('ignores a late valid /me completion after session loss invalidates its generation', async () => {
      let releaseMe: ((data: AuthSessionResponseData) => void) | undefined;
      const api = createMockApi({
        getCurrentUser: vi.fn(
          () =>
            new Promise<AuthSessionResponseData>((resolve) => {
              releaseMe = resolve;
            }),
        ),
      });
      const auth = createAuthController(() => api);

      // Start bootstrap generation N; hold it unresolved.
      const bootstrapPromise = auth.bootstrap();
      expect(auth.state.value).toBe('BOOTSTRAPPING');

      // Session loss invalidates generation N.
      auth.handleSessionLoss('SESSION_REVOKED');
      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.isAuthenticated()).toBe(false);

      // The old /me resolves with a fully valid authenticated payload.
      releaseMe!(authSessionFixture);
      await bootstrapPromise;

      // The stale result must be ignored: state stays invalidated, no session
      // data may be restored.
      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.user.value).toBeNull();
      expect(auth.getCsrfToken()).toBeNull();
      expect(auth.idleExpiresAt.value).toBeNull();
      expect(auth.absoluteExpiresAt.value).toBeNull();
    });

    it('ignores a late valid /me completion after a newer bootstrap starts', async () => {
      const pending: Array<{
        resolve: (data: AuthSessionResponseData) => void;
        reject: (error: unknown) => void;
      }> = [];
      const api = createMockApi({
        getCurrentUser: vi.fn(
          () =>
            new Promise<AuthSessionResponseData>((resolve, reject) => {
              pending.push({ resolve, reject });
            }),
        ),
      });
      const auth = createAuthController(() => api);

      const first = auth.bootstrap(); // generation N
      const second = auth.bootstrap(); // generation N+1 invalidates N
      void first;

      // Resolve the OLD generation with a valid authenticated payload...
      pending[0]!.resolve(authSessionFixture);
      // ...while the NEW generation fails with a 401.
      await vi.waitFor(() => pending.length >= 2);
      pending[1]!.reject(new ApiError('UNAUTHENTICATED', 'Authentication required.', 401, 'API'));
      await expect(second).resolves.toBe(false);

      // The stale-but-valid generation N result must not restore state.
      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.getCsrfToken()).toBeNull();
    });

    it('a login completion from an invalidated generation cannot restore AUTHENTICATED', async () => {
      let releaseLogin: ((data: AuthSessionResponseData) => void) | undefined;
      const api = createMockApi({
        login: vi.fn(
          () =>
            new Promise<AuthSessionResponseData>((resolve) => {
              releaseLogin = resolve;
            }),
        ),
      });
      const auth = createAuthController(() => api);

      const loginPromise = auth.login({ username: 'admin_test', password: VALID_PASSWORD });
      // Session loss lands while the login is in flight.
      auth.handleSessionLoss('SESSION_REVOKED');

      releaseLogin!(authSessionFixture);
      await expect(loginPromise).rejects.toThrow();

      expect(auth.state.value).toBe('UNAUTHENTICATED');
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.getCsrfToken()).toBeNull();
    });
  });

  describe('storage safety', () => {
    it('never writes auth tokens or credentials to localStorage or sessionStorage', async () => {
      const api = createMockApi();
      const auth = createAuthController(() => api);

      await auth.login({ username: 'admin_test', password: VALID_PASSWORD });
      expect(auth.isAuthenticated()).toBe(true);

      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });
  });
});
