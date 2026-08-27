import { createRouter, createWebHistory, type Router } from 'vue-router';

import AccountWorkspaceLayout from '../layouts/AccountWorkspaceLayout.vue';
import AdminLayout from '../layouts/AdminLayout.vue';
import AccountFriendsPage from '../pages/AccountFriendsPage.vue';
import AccountHistoryPage from '../pages/AccountHistoryPage.vue';
import AccountManualRunPage from '../pages/AccountManualRunPage.vue';
import AccountOverviewPage from '../pages/AccountOverviewPage.vue';
import AccountSchedulePage from '../pages/AccountSchedulePage.vue';
import AccountsPage from '../pages/AccountsPage.vue';
import OverviewPage from '../pages/OverviewPage.vue';
import NotFoundPage from '../pages/NotFoundPage.vue';
import NotificationsPage from '../pages/NotificationsPage.vue';
import RunDetailPage from '../pages/RunDetailPage.vue';
import RunsPage from '../pages/RunsPage.vue';
import SchedulesPage from '../pages/SchedulesPage.vue';
import SystemStatusPage from '../pages/SystemStatusPage.vue';
import TemplatesPage from '../pages/TemplatesPage.vue';

export function createAdminRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/',
        component: AdminLayout,
        children: [
          { path: '', component: OverviewPage, meta: { title: 'Overview', section: 'overview' } },
          {
            path: 'accounts',
            component: AccountsPage,
            meta: { title: 'Accounts', section: 'accounts' },
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
                meta: { title: 'Account Overview', section: 'accounts' },
              },
              {
                path: 'friends',
                component: AccountFriendsPage,
                meta: { title: 'Account Friends', section: 'accounts' },
              },
              {
                path: 'schedule',
                component: AccountSchedulePage,
                meta: { title: 'Account Schedule', section: 'accounts' },
              },
              {
                path: 'manual-run',
                component: AccountManualRunPage,
                meta: { title: 'Account Manual Run', section: 'accounts' },
              },
              {
                path: 'history',
                component: AccountHistoryPage,
                meta: { title: 'Account History', section: 'accounts' },
              },
            ],
          },
          {
            // Legacy global schedules page: hidden from V3 navigation but kept
            // reachable so existing links never 404.
            path: 'schedules',
            component: SchedulesPage,
            meta: { title: 'Schedules', section: 'accounts' },
          },
          {
            path: 'templates',
            component: TemplatesPage,
            meta: { title: 'Templates', section: 'templates' },
          },
          { path: 'runs', component: RunsPage, meta: { title: 'Runs', section: 'runs' } },
          {
            path: 'runs/:runId',
            component: RunDetailPage,
            meta: { title: 'Run detail', section: 'runs' },
          },
          {
            // Compatibility redirect: notifications moved under /operations.
            path: 'notifications',
            redirect: '/operations/notifications',
          },
          {
            path: 'operations/notifications',
            component: NotificationsPage,
            meta: { title: 'Notifications', section: 'operations/notifications' },
          },
          {
            path: 'operations/system',
            component: SystemStatusPage,
            meta: { title: 'System', section: 'operations/system' },
          },
          { path: ':pathMatch(.*)*', component: NotFoundPage, meta: { title: 'Not found' } },
        ],
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  });
}

export const router = createAdminRouter();
