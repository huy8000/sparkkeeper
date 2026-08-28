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
}

export const router = createAdminRouter();
