import { createRouter, createWebHistory, type Router } from 'vue-router';

import AdminLayout from '../layouts/AdminLayout.vue';
import AccountDetailPage from '../pages/AccountDetailPage.vue';
import AccountsPage from '../pages/AccountsPage.vue';
import AccountSectionPage from '../pages/AccountSectionPage.vue';
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
            // Compatibility redirect: the pre-V3 account workspace path.
            path: 'accounts/:accountId',
            redirect: (to) => `/accounts/${to.params.accountId}/overview`,
          },
          {
            path: 'accounts/:accountId/overview',
            component: AccountDetailPage,
            meta: { title: 'Account detail', section: 'accounts' },
          },
          {
            path: 'accounts/:accountId/friends',
            component: AccountSectionPage,
            meta: {
              title: 'Friends',
              section: 'accounts',
              sectionTitle: 'Friends',
              sectionDescription:
                'Friend management stays on the account overview until this V3 section is built.',
            },
          },
          {
            path: 'accounts/:accountId/schedule',
            component: AccountSectionPage,
            meta: {
              title: 'Schedule',
              section: 'accounts',
              sectionTitle: 'Schedule',
              sectionDescription:
                'Schedule configuration stays on the account overview until this V3 section is built.',
            },
          },
          {
            path: 'accounts/:accountId/manual-run',
            component: AccountSectionPage,
            meta: {
              title: 'Manual run',
              section: 'accounts',
              sectionTitle: 'Manual run',
              sectionDescription:
                'Manual run stays on the account overview until this V3 section is built. No run is started from this placeholder.',
            },
          },
          {
            path: 'accounts/:accountId/history',
            component: AccountSectionPage,
            meta: {
              title: 'History',
              section: 'accounts',
              sectionTitle: 'History',
              sectionDescription:
                'Run history stays on the account overview until this V3 section is built.',
            },
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
