import { createRouter, createWebHistory, type Router } from 'vue-router';

import type { AuthController } from '../auth/AuthController';
import AccountWorkspaceLayout from '../layouts/AccountWorkspaceLayout.vue';
import AdminLayout from '../layouts/AdminLayout.vue';
import AccountFriendsPage from '../pages/AccountFriendsPage.vue';
import AccountHistoryPage from '../pages/AccountHistoryPage.vue';
import AccountManualRunPage from '../pages/AccountManualRunPage.vue';
import AccountOverviewPage from '../pages/AccountOverviewPage.vue';
import AccountSchedulePage from '../pages/AccountSchedulePage.vue';
import AccountsPage from '../pages/AccountsPage.vue';
import LoginPage from '../pages/LoginPage.vue';
import OverviewPage from '../pages/OverviewPage.vue';
import NotFoundPage from '../pages/NotFoundPage.vue';
import NotificationsPage from '../pages/NotificationsPage.vue';
import RunDetailPage from '../pages/RunDetailPage.vue';
import RunsPage from '../pages/RunsPage.vue';
import SchedulesPage from '../pages/SchedulesPage.vue';
import SystemStatusPage from '../pages/SystemStatusPage.vue';
import TemplatesPage from '../pages/TemplatesPage.vue';

/** The single login-redirect target: keep the current path for post-login return. */
function loginRedirectTarget(fullPath: string): { path: string; query: Record<string, string> } {
  return { path: '/login', query: fullPath === '/' ? {} : { redirect: fullPath } };
}

/**
 * The single canonical navigation policy. The router consumes the auth
 * controller's state; no other module may register its own conflicting
 * bootstrap/auth semantics.
 */
export function installAuthNavigationGuard(
  router: Pick<Router, 'beforeEach'>,
  authController: AuthController,
): void {
  router.beforeEach(async (to) => {
    if (authController.state.value === 'BOOTSTRAPPING') {
      await authController.bootstrap();
    }
    const isPublic = to.meta.public === true;
    const isAuthenticated = authController.isAuthenticated();

    if (!isPublic && !isAuthenticated) {
      // ERROR state still renders the protected route shell so App.vue can
      // show the retry barrier for that navigation.
      if (authController.state.value === 'ERROR') {
        return true;
      }
      return loginRedirectTarget(to.fullPath);
    }

    if (to.path === '/login' && isAuthenticated) {
      return { path: '/' };
    }

    return true;
  });
}

/**
 * The canonical unauthenticated navigation decision, owned by the router
 * module. App.vue invokes this on session loss so the redirect policy exists in
 * exactly one place (the router), never duplicated in component code.
 */
export function redirectAfterSessionLoss(router: Router, currentFullPath: string): void {
  if (router.currentRoute.value.meta.public === true) return;
  void router.push(loginRedirectTarget(currentFullPath));
}

export function createAdminRouter(authController?: AuthController): Router {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/login',
        component: LoginPage,
        meta: { public: true, title: 'auth.title' },
      },
      {
        path: '/',
        component: AdminLayout,
        children: [
          {
            path: '',
            component: OverviewPage,
            meta: { title: 'nav.overview', section: 'overview' },
          },
          {
            path: 'accounts',
            component: AccountsPage,
            meta: { title: 'nav.accounts', section: 'accounts' },
          },
          {
            path: 'accounts/:accountId',
            component: AccountWorkspaceLayout,
            meta: { section: 'accounts' },
            children: [
              {
                path: '',
                redirect: (to) => `/accounts/${to.params.accountId}/overview`,
              },
              {
                path: 'overview',
                component: AccountOverviewPage,
                meta: { title: 'pages.accountOverview', section: 'accounts' },
              },
              {
                path: 'friends',
                component: AccountFriendsPage,
                meta: { title: 'pages.accountFriends', section: 'accounts' },
              },
              {
                path: 'schedule',
                component: AccountSchedulePage,
                meta: { title: 'pages.accountSchedule', section: 'accounts' },
              },
              {
                path: 'manual-run',
                component: AccountManualRunPage,
                meta: { title: 'pages.accountManualRun', section: 'accounts' },
              },
              {
                path: 'history',
                component: AccountHistoryPage,
                meta: { title: 'pages.accountHistory', section: 'accounts' },
              },
            ],
          },
          {
            // Legacy global schedules page: hidden from V3 navigation but kept
            // reachable so existing links never 404.
            path: 'schedules',
            component: SchedulesPage,
            meta: { title: 'pages.schedules', section: 'accounts' },
          },
          {
            path: 'templates',
            component: TemplatesPage,
            meta: { title: 'nav.templates', section: 'templates' },
          },
          { path: 'runs', component: RunsPage, meta: { title: 'nav.runs', section: 'runs' } },
          {
            path: 'runs/:runId',
            component: RunDetailPage,
            meta: { title: 'pages.runDetail', section: 'runs' },
          },
          {
            // Compatibility redirect: notifications moved under /operations.
            path: 'notifications',
            redirect: '/operations/notifications',
          },
          {
            path: 'operations/notifications',
            component: NotificationsPage,
            meta: { title: 'nav.notifications', section: 'operations/notifications' },
          },
          {
            path: 'operations/system',
            component: SystemStatusPage,
            meta: { title: 'nav.system', section: 'operations/system' },
          },
          { path: ':pathMatch(.*)*', component: NotFoundPage, meta: { title: 'pages.notFound' } },
        ],
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  });

  if (authController) {
    installAuthNavigationGuard(router, authController);
  }

  return router;
}

export const router = createAdminRouter();
