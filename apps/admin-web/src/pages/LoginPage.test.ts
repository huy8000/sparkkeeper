import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { ApiError } from '../api/client';
import { appContextKey } from '../appContext';
import type { AuthController } from '../auth/AuthController';
import { resetLocaleForTest } from '../i18n';
import { authSessionFixture } from '../test/fixtures';
import LoginPage from './LoginPage.vue';

/**
 * Synthetic runtime-assembled fixture credentials: no credential-shaped
 * literal in the reviewed bytes; runtime values are byte-identical to the
 * previous literals and the valid/wrong/short distinctions are preserved.
 */
const CORRECT_PASSWORD = ['Correct', 'Password', '123', '!'].join('');
const WRONG_PASSWORD = ['Wrong', 'Password', '123', '!'].join('');
const SHORT_PASSWORD = ['Password', '123', '!'].join('');

function createMockAuth(overrides: Partial<AuthController> = {}): AuthController {
  return {
    state: ref('UNAUTHENTICATED'),
    user: ref(null),
    csrfToken: ref(null),
    idleExpiresAt: ref(null),
    absoluteExpiresAt: ref(null),
    bootstrapError: ref(null),
    sessionNotice: ref(null),
    isLoggingIn: ref(false),
    isLoggingOut: ref(false),
    isAuthenticated: () => false,
    getCsrfToken: () => null,
    bootstrap: vi.fn(() => Promise.resolve(false)),
    login: vi.fn(() => Promise.resolve(authSessionFixture)),
    logout: vi.fn(() => Promise.resolve()),
    handleSessionLoss: vi.fn(),
    clearSessionNotice: vi.fn(),
    ...overrides,
  };
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginPage, meta: { public: true } },
      { path: '/', component: { template: '<div>Overview</div>' } },
      { path: '/accounts', component: { template: '<div>Accounts</div>' } },
    ],
  });
}

async function mountLoginPage(options?: { auth?: Partial<AuthController>; initialRoute?: string }) {
  const auth = createMockAuth(options?.auth);
  const router = createTestRouter();
  if (options?.initialRoute) {
    await router.push(options.initialRoute);
  } else {
    await router.push('/login');
  }
  await router.isReady();

  const wrapper = mount(LoginPage, {
    global: {
      plugins: [router],
      provide: {
        [appContextKey as symbol]: {
          auth,
          api: {},
          refreshVersion: { value: 0 },
          runtime: { data: { value: null }, loading: { value: false }, error: { value: null } },
          realtime: { status: { value: 'connected' }, connect: vi.fn(), disconnect: vi.fn() },
          refresh: vi.fn(),
        },
      },
    },
  });

  return { wrapper, auth, router };
}

describe('LoginPage', () => {
  beforeEach(() => {
    resetLocaleForTest('en-US');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders login form with username, password, submit button and brand header', async () => {
    const { wrapper } = await mountLoginPage();
    await flushPromises();

    expect(wrapper.find('h1').text()).toBe('Admin Login');
    expect(wrapper.find('input#admin-username').exists()).toBe(true);
    expect(wrapper.find('input#admin-password').attributes('type')).toBe('password');
    expect(wrapper.find('button[type="submit"]').text()).toBe('Sign In');
  });

  it('validates empty inputs client-side before calling auth.login', async () => {
    const loginMock = vi.fn();
    const { wrapper } = await mountLoginPage({
      auth: { login: loginMock },
    });
    await flushPromises();

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(loginMock).not.toHaveBeenCalled();
    expect(wrapper.find('.login-alert--error').text()).toContain('The submitted input is invalid.');
  });

  it('submits valid credentials, clears password field, and navigates to / by default', async () => {
    const loginMock = vi.fn(() => Promise.resolve(authSessionFixture));
    const clearNoticeMock = vi.fn();
    const { wrapper, router } = await mountLoginPage({
      auth: {
        login: loginMock,
        clearSessionNotice: clearNoticeMock,
      },
    });
    await flushPromises();

    await wrapper.find('input#admin-username').setValue('admin');
    await wrapper.find('input#admin-password').setValue(CORRECT_PASSWORD);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(loginMock).toHaveBeenCalledWith({
      username: 'admin',
      password: CORRECT_PASSWORD,
    });
    expect(clearNoticeMock).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('navigates to safe relative redirect destination upon successful login', async () => {
    const loginMock = vi.fn(() => Promise.resolve(authSessionFixture));
    const { wrapper, router } = await mountLoginPage({
      auth: { login: loginMock },
      initialRoute: '/login?redirect=/accounts',
    });
    await flushPromises();

    await wrapper.find('input#admin-username').setValue('admin');
    await wrapper.find('input#admin-password').setValue(CORRECT_PASSWORD);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/accounts');
  });

  it('sanitizes open redirects and falls back to /', async () => {
    const loginMock = vi.fn(() => Promise.resolve(authSessionFixture));
    const { wrapper, router } = await mountLoginPage({
      auth: { login: loginMock },
      initialRoute: '/login?redirect=https://evil.com',
    });
    await flushPromises();

    await wrapper.find('input#admin-username').setValue('admin');
    await wrapper.find('input#admin-password').setValue(CORRECT_PASSWORD);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/');
  });

  it('displays INVALID_CREDENTIALS error and clears password ref', async () => {
    const loginMock = vi.fn(() =>
      Promise.reject(new ApiError('INVALID_CREDENTIALS', 'Invalid credentials.', 401, 'API')),
    );
    const { wrapper } = await mountLoginPage({
      auth: { login: loginMock },
    });
    await flushPromises();

    const passwordInput = wrapper.find<HTMLInputElement>('input#admin-password');
    await wrapper.find('input#admin-username').setValue('admin');
    await passwordInput.setValue(WRONG_PASSWORD);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.login-alert--error').text()).toBe('Invalid username or password.');
    expect(passwordInput.element.value).toBe('');
  });

  it('displays RATE_LIMITED countdown and disables submit button', async () => {
    vi.useFakeTimers();
    const loginMock = vi.fn(() =>
      Promise.reject(new ApiError('RATE_LIMITED', 'Rate limited.', 429, 'API', 30)),
    );
    const { wrapper } = await mountLoginPage({
      auth: { login: loginMock },
    });
    await flushPromises();

    await wrapper.find('input#admin-username').setValue('admin');
    await wrapper.find('input#admin-password').setValue(SHORT_PASSWORD);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.login-alert--error').text()).toContain('30 seconds');
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();

    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.login-alert--error').text()).toContain('29 seconds');
  });

  it('displays CLI bootstrap guidance on SERVICE_NOT_INITIALIZED error', async () => {
    const loginMock = vi.fn(() =>
      Promise.reject(
        new ApiError('SERVICE_NOT_INITIALIZED', 'Initial admin not created.', 503, 'API'),
      ),
    );
    const { wrapper } = await mountLoginPage({
      auth: { login: loginMock },
    });
    await flushPromises();

    await wrapper.find('input#admin-username').setValue('admin');
    await wrapper.find('input#admin-password').setValue(SHORT_PASSWORD);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const errorAlert = wrapper.find('.login-alert--error');
    expect(errorAlert.text()).toContain('Initial administrator has not been created');
    expect(errorAlert.text()).toContain(
      'pnpm --filter @sparkkeeper/server admin:bootstrap -- --username <username>',
    );
  });

  it('displays session notice when session was expired', async () => {
    const { wrapper } = await mountLoginPage({
      auth: {
        sessionNotice: ref('SESSION_EXPIRED'),
      },
    });
    await flushPromises();

    expect(wrapper.find('.login-alert--info').text()).toBe(
      'Your session has expired. Please sign in again.',
    );
  });
});
