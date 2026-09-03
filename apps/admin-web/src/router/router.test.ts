import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_ID, RUN_ID, runtimeFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { installEventSource } from '../test/realtime';
import { mountAdmin } from '../test/mountAdmin';
import { createAdminRouter } from './index';

const authSessionLike = {
  admin: { id: '11111111-1111-4111-8111-111111111111', username: 'Admin_F26' },
  csrfToken: 'a'.repeat(43),
  idleExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  absoluteExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
  recentlyReauthenticated: true,
};

describe('admin routing', () => {
  it.each([
    ['/', 'Today at a glance'],
    ['/accounts', 'Configured accounts'],
    [`/accounts/${ACCOUNT_ID}`, 'Account readiness'],
    [`/accounts/${ACCOUNT_ID}/overview`, 'Account readiness'],
    [`/accounts/${ACCOUNT_ID}/friends`, 'Configured friends'],
    [`/accounts/${ACCOUNT_ID}/schedule`, 'Automatic execution window'],
    [`/accounts/${ACCOUNT_ID}/manual-run`, 'Server-authorized execution'],
    [`/accounts/${ACCOUNT_ID}/history`, 'Demo Account run history'],
    ['/schedules', 'Account schedule windows'],
    ['/templates', 'Message templates'],
    ['/notifications', 'Configure webhook notifications'],
    ['/operations/notifications', 'Configure webhook notifications'],
    ['/operations/system', 'Runtime health and safety status'],
    ['/runs', 'Daily run history'],
    [`/runs/${RUN_ID}`, 'Run detail'],
  ])('renders %s', async (path, expected) => {
    installApiFetch();
    const wrapper = await mountAdmin(path);
    expect(wrapper.text()).toContain(expected);
    wrapper.unmount();
  });

  it('redirects legacy paths to their V3 destinations', async () => {
    const router = createAdminRouter();
    await router.push(`/accounts/${ACCOUNT_ID}`);
    expect(router.currentRoute.value.fullPath).toBe(`/accounts/${ACCOUNT_ID}/overview`);
    await router.push('/notifications');
    expect(router.currentRoute.value.fullPath).toBe('/operations/notifications');
  });

  it('uses semantic routed tabs and supports deep-link refresh', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    const tabs = wrapper.get('nav[aria-label="Account workspace"]');
    expect(tabs.findAll('a')).toHaveLength(5);
    expect(tabs.get(`a[href="/accounts/${ACCOUNT_ID}/friends"]`).classes()).toContain(
      'account-tabs__link--active',
    );
    expect(wrapper.get(`a[href="/accounts/${ACCOUNT_ID}/overview"]`).text()).toBe('Overview');
    expect(wrapper.get('a[href="/accounts"]').text()).toContain('Accounts');
    wrapper.unmount();
  });

  it('renders an accessible unknown-route page with an Overview link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/unknown-route');
    expect(wrapper.text()).toContain('Not Found');
    expect(wrapper.find('.not-found a[href="/"]').text()).toContain('Return to Overview');
    wrapper.unmount();
  });

  it('redirects unauthenticated users from protected routes to /login with redirect query', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/auth/me'
        ? failure('UNAUTHENTICATED', 'Authentication required.', 401)
        : undefined,
    );
    const wrapper = await mountAdmin('/accounts');
    expect(wrapper.find('h1').text()).toBe('Admin Login');
    wrapper.unmount();
  });

  it('renders /login directly for unauthenticated users', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/auth/me'
        ? failure('UNAUTHENTICATED', 'Authentication required.', 401)
        : undefined,
    );
    const wrapper = await mountAdmin('/login');
    expect(wrapper.find('h1').text()).toBe('Admin Login');
    wrapper.unmount();
  });
});

describe('F25/F26 - frontend bootstrap/session-loss compositions', () => {
  it('F25 - deferred /me 401 during bootstrap: no protected mount, no runtime API, no SSE; login redirect after resolve', async () => {
    let releaseMe: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://127.0.0.1');
      if (url.pathname === '/api/auth/me') {
        return new Promise<Response>((resolve) => {
          releaseMe = resolve;
        });
      }
      if (url.pathname === '/api/events/stream') {
        return new Promise<Response>(() => undefined);
      }
      return failure('ROUTE_NOT_FOUND', 'Route not found.', 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const eventSources: Array<{ close: () => void }> = [];
    vi.stubGlobal(
      'EventSource',
      class {
        onopen: unknown = null;
        onmessage: unknown = null;
        onerror: unknown = null;
        constructor() {
          eventSources.push(this);
        }
        addEventListener(): void {
          // no-op
        }
        removeEventListener(): void {
          // no-op
        }
        close(): void {
          // no-op
        }
      },
    );

    const router = createAdminRouter();
    await router.push('/accounts');
    const { default: App } = await import('../App.vue');
    const { mount, flushPromises } = await import('@vue/test-utils');
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();

    // While /me is deferred: barrier UI only, no runtime API call, no SSE.
    expect(wrapper.find('.auth-barrier-loading').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'AdminLayout' }).exists()).toBe(false);
    const runtimeCallsBefore = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/runtime/status'),
    ).length;
    expect(runtimeCallsBefore).toBe(0);

    // Resolve /me as a real 401 through the real ApiClient/Controller path.
    releaseMe!(failure('UNAUTHENTICATED', 'Authentication required.', 401));
    await flushPromises();

    // Safe login redirect; still no protected mount, runtime API, or SSE.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/login');
    });
    const runtimeCallsAfter = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/runtime/status'),
    ).length;
    expect(runtimeCallsAfter).toBe(0);
    expect(eventSources.length).toBe(0);
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it('F26 - protected API 401 mid-session: two independent in-flight operations; the old runtime request resolves late with SUCCESS and is ignored', async () => {
    // Operation B (the OLD request): App.vue issues GET /api/runtime/status as
    // soon as auth state becomes AUTHENTICATED. It stays pending across the
    // entire session-loss sequence.
    let releaseRuntime: ((response: Response) => void) | undefined;
    // Operation A (the session-loss trigger): GET /api/accounts issued by the
    // mounted page while B is still pending. A separately controlled deferred.
    let releaseAccounts: ((response: Response) => void) | undefined;
    const requestOrder: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://127.0.0.1');
      if (url.pathname === '/api/auth/me') return success(authSessionLike);
      if (url.pathname === '/api/runtime/status') {
        requestOrder.push('runtime:start');
        return new Promise<Response>((resolve) => {
          releaseRuntime = resolve;
        });
      }
      if (url.pathname === '/api/accounts') {
        requestOrder.push('accounts:start');
        return new Promise<Response>((resolve) => {
          releaseAccounts = resolve;
        });
      }
      if (url.pathname === '/api/events/stream') {
        return new Promise<Response>(() => undefined);
      }
      return failure('ROUTE_NOT_FOUND', 'Route not found.', 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const FakeEventSource = installEventSource();

    const router = createAdminRouter();
    await router.push('/accounts');
    const { default: App } = await import('../App.vue');
    const { mount, flushPromises } = await import('@vue/test-utils');
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/accounts');

    // Two genuinely independent operations are now in flight simultaneously:
    // B (runtime/status) was issued first, then A (accounts). They are distinct
    // deferred requests, not one Promise resolved twice.
    expect(requestOrder.indexOf('runtime:start')).toBeGreaterThanOrEqual(0);
    expect(requestOrder.indexOf('accounts:start')).toBeGreaterThan(
      requestOrder.indexOf('runtime:start'),
    );
    expect(releaseRuntime).toBeDefined();
    expect(releaseAccounts).toBeDefined();
    expect(releaseAccounts).not.toBe(releaseRuntime);
    expect(FakeEventSource.instances).toHaveLength(1);

    // Operation A resolves 401 through the real ApiClient: onUnauthenticated
    // fires the centralized session-loss path (auth/CSRF cleared, runtime
    // request state reset, SSE disconnected, router-owned login redirect).
    releaseAccounts!(failure('UNAUTHENTICATED', 'Authentication required.', 401));
    await flushPromises();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/login');
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);

    // Operation B — the OLD pending runtime request — now resolves with a real
    // SUCCESS payload. Its continuation must be ignored: runtime.reset()
    // invalidated its request number and session loss invalidated every auth
    // generation, so nothing may repopulate state, restart SSE, or refetch.
    const callsBeforeLateSuccess = fetchMock.mock.calls.length;
    releaseRuntime!(success(runtimeFixture));
    await flushPromises();
    await flushPromises();

    // Auth/CSRF stay cleared: still on /login (the router guard bounces an
    // authenticated user away from /login, so staying there proves no restore).
    expect(router.currentRoute.value.path).toBe('/login');
    // No new requests were issued by the late success.
    expect(fetchMock.mock.calls.length).toBe(callsBeforeLateSuccess);
    // SSE stays stopped: no new EventSource, the old one stays closed.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);

    // Navigating again is still blocked: auth/CSRF remain cleared.
    await router.push('/accounts');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeLateSuccess);

    wrapper.unmount();
    vi.unstubAllGlobals();
  });
});
