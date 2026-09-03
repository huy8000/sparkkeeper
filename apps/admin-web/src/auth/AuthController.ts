import { readonly, ref, type Ref } from 'vue';

import { ApiError } from '../api/client';
import type { AdminUserDto, AuthSessionResponseData, LoginInput } from '../types/api';
import type { SparkKeeperApi } from '../api/sparkkeeperApi';

export type AuthState = 'BOOTSTRAPPING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'ERROR';

export interface AuthController {
  readonly state: Readonly<Ref<AuthState>>;
  readonly user: Readonly<Ref<AdminUserDto | null>>;
  readonly csrfToken: Readonly<Ref<string | null>>;
  readonly idleExpiresAt: Readonly<Ref<Date | null>>;
  readonly absoluteExpiresAt: Readonly<Ref<Date | null>>;
  readonly sessionNotice: Readonly<Ref<string | null>>;
  readonly bootstrapError: Readonly<Ref<ApiError | Error | null>>;
  readonly isLoggingIn: Readonly<Ref<boolean>>;
  readonly isLoggingOut: Readonly<Ref<boolean>>;
  readonly isAuthenticated: () => boolean;
  readonly getCsrfToken: () => string | null;
  bootstrap(): Promise<boolean>;
  login(input: LoginInput): Promise<AuthSessionResponseData>;
  logout(): Promise<void>;
  handleSessionLoss(reason?: string): void;
  clearSessionNotice(): void;
}

export function createAuthController(apiProvider: () => SparkKeeperApi): AuthController {
  const state = ref<AuthState>('BOOTSTRAPPING');
  const user = ref<AdminUserDto | null>(null);
  const csrfToken = ref<string | null>(null);
  const idleExpiresAt = ref<Date | null>(null);
  const absoluteExpiresAt = ref<Date | null>(null);
  const sessionNotice = ref<string | null>(null);
  const bootstrapError = ref<ApiError | Error | null>(null);
  const isLoggingIn = ref(false);
  const isLoggingOut = ref(false);

  /**
   * Monotonic generation identity for every async authentication operation
   * (bootstrap / login / logout). Session loss, a new bootstrap, or a logout
   * invalidates the current generation; late completions from an invalidated
   * generation are ignored and can never restore AUTHENTICATED state, CSRF,
   * or the admin DTO.
   */
  let generation = 0;

  function setSessionData(data: AuthSessionResponseData): void {
    user.value = data.admin;
    csrfToken.value = data.csrfToken;
    idleExpiresAt.value = new Date(data.idleExpiresAt);
    absoluteExpiresAt.value = new Date(data.absoluteExpiresAt);
    state.value = 'AUTHENTICATED';
    sessionNotice.value = null;
    bootstrapError.value = null;
  }

  function clearSessionData(): void {
    user.value = null;
    csrfToken.value = null;
    idleExpiresAt.value = null;
    absoluteExpiresAt.value = null;
    state.value = 'UNAUTHENTICATED';
    bootstrapError.value = null;
  }

  function clearProtectedFields(): void {
    user.value = null;
    csrfToken.value = null;
    idleExpiresAt.value = null;
    absoluteExpiresAt.value = null;
  }

  async function bootstrap(): Promise<boolean> {
    // A new bootstrap attempt invalidates every prior async operation.
    const current = ++generation;
    state.value = 'BOOTSTRAPPING';
    bootstrapError.value = null;
    try {
      const data = await apiProvider().getCurrentUser();
      if (current !== generation) {
        // Late completion from an invalidated generation: ignore entirely.
        return false;
      }
      setSessionData(data);
      return true;
    } catch (error) {
      if (current !== generation) {
        return false;
      }
      if (
        error instanceof ApiError &&
        (error.httpStatus === 401 || error.code === 'UNAUTHENTICATED')
      ) {
        clearSessionData();
        return false;
      }
      clearProtectedFields();
      state.value = 'ERROR';
      bootstrapError.value = error instanceof Error ? error : new Error(String(error));
      return false;
    }
  }

  async function login(input: LoginInput): Promise<AuthSessionResponseData> {
    const current = ++generation;
    isLoggingIn.value = true;
    try {
      const data = await apiProvider().login(input);
      if (current !== generation) {
        // Session was lost or a new bootstrap started while logging in:
        // never restore AUTHENTICATED state from the stale generation.
        throw new ApiError('REQUEST_ABORTED', 'Login result discarded.', 0, 'ABORT');
      }
      setSessionData(data);
      return data;
    } catch (error) {
      if (current === generation) {
        clearSessionData();
      }
      throw error;
    } finally {
      isLoggingIn.value = false;
    }
  }

  async function logout(): Promise<void> {
    const current = generation;
    isLoggingOut.value = true;
    try {
      await apiProvider().logout();
      // Logout succeeded: invalidate in-flight generations and clear state.
      if (current === generation) {
        generation += 1;
      }
      clearSessionData();
    } finally {
      isLoggingOut.value = false;
    }
  }

  function handleSessionLoss(reason?: string): void {
    // Session loss invalidates every in-flight authentication generation so a
    // late /me or login completion can never restore AUTHENTICATED state.
    generation += 1;
    clearSessionData();
    if (reason) {
      sessionNotice.value = reason;
    }
  }

  function clearSessionNotice(): void {
    sessionNotice.value = null;
  }

  return {
    state: readonly(state),
    user: readonly(user),
    csrfToken: readonly(csrfToken),
    idleExpiresAt: readonly(idleExpiresAt),
    absoluteExpiresAt: readonly(absoluteExpiresAt),
    sessionNotice: readonly(sessionNotice),
    bootstrapError: readonly(bootstrapError),
    isLoggingIn: readonly(isLoggingIn),
    isLoggingOut: readonly(isLoggingOut),
    isAuthenticated: () => state.value === 'AUTHENTICATED',
    getCsrfToken: () => csrfToken.value,
    bootstrap,
    login,
    logout,
    handleSessionLoss,
    clearSessionNotice,
  };
}
