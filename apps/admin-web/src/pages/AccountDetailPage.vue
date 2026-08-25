<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';

import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import IdentifierValue from '../components/IdentifierValue.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const route = useRoute();
const accountId = String(route.params.accountId);
const detail = useRequest(async (signal) => {
  const [account, friends, schedules] = await Promise.all([
    app.api.getAccount(accountId, signal),
    app.api.listFriends(accountId, signal),
    app.api.listSchedules(accountId, signal),
  ]);
  return { account, friends, schedules };
});
watch(app.refreshVersion, () => void detail.load());
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Account detail</p>
        <h2>{{ detail.data.value?.account.name ?? 'Account' }}</h2>
        <p>Account identity, contacts, and schedule configuration.</p>
      </div>
      <button class="button button--secondary" type="button" @click="detail.load">Refresh</button>
    </header>
    <LoadingState
      v-if="detail.loading.value && !detail.data.value"
      label="Loading account detail…"
    />
    <ErrorState
      v-else-if="detail.error.value"
      :title="
        detail.error.value.httpStatus === 404 ? 'Account not found' : 'Unable to load account'
      "
      :message="
        detail.error.value.httpStatus === 404
          ? 'This account is not available.'
          : detail.error.value.message
      "
      @retry="detail.load"
    />
    <template v-else-if="detail.data.value">
      <section class="card">
        <div class="card__header">
          <div>
            <p class="eyebrow">Account</p>
            <h3>{{ detail.data.value.account.name }}</h3>
          </div>
          <StatusBadge :status="detail.data.value.account.enabled ? 'ENABLED' : 'DISABLED'" />
        </div>
        <dl class="definition-grid">
          <div>
            <dt>Identifier</dt>
            <dd><IdentifierValue :value="detail.data.value.account.id" /></dd>
          </div>
          <div>
            <dt>Login status</dt>
            <dd><StatusBadge :status="detail.data.value.account.loginStatus" /></dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{{ formatTimestamp(detail.data.value.account.createdAt) }}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{{ formatTimestamp(detail.data.value.account.updatedAt) }}</dd>
          </div>
        </dl>
      </section>

      <section class="section-stack" aria-labelledby="friends-title">
        <header class="section-heading">
          <div>
            <p class="eyebrow">Friends</p>
            <h3 id="friends-title">Contacts</h3>
          </div>
          <span class="count">{{ detail.data.value.friends.length }}</span>
        </header>
        <EmptyState
          v-if="detail.data.value.friends.length === 0"
          title="No friends"
          description="This account has no configured contacts."
        />
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Remark</th>
                <th>Short ID</th>
                <th>Unique ID</th>
                <th>Match field</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="friend in detail.data.value.friends" :key="friend.id">
                <td>
                  <strong>{{
                    friend.remarkName ??
                    friend.displayName ??
                    friend.shortId ??
                    friend.uniqueId ??
                    'Unnamed contact'
                  }}</strong
                  ><small>{{ friend.displayName }}</small>
                </td>
                <td>{{ friend.remarkName ?? '—' }}</td>
                <td>{{ friend.shortId ?? '—' }}</td>
                <td>{{ friend.uniqueId ?? '—' }}</td>
                <td><StatusBadge :status="friend.matchField" :label="friend.matchField" /></td>
                <td><StatusBadge :status="friend.enabled ? 'ENABLED' : 'DISABLED'" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="section-stack" aria-labelledby="account-schedules-title">
        <header class="section-heading">
          <div>
            <p class="eyebrow">Schedules</p>
            <h3 id="account-schedules-title">Account schedules</h3>
          </div>
          <span class="count">{{ detail.data.value.schedules.length }}</span>
        </header>
        <EmptyState
          v-if="detail.data.value.schedules.length === 0"
          title="No schedules"
          description="This account has no schedule configuration."
        />
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Window</th>
                <th>Timezone</th>
                <th>Schedule enabled</th>
                <th>Max attempts</th>
                <th>Retry interval</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="schedule in detail.data.value.schedules" :key="schedule.id">
                <td>{{ schedule.startTime }}–{{ schedule.endTime }}</td>
                <td>{{ schedule.timezone }}</td>
                <td><StatusBadge :status="schedule.enabled ? 'ENABLED' : 'DISABLED'" /></td>
                <td>{{ schedule.maxAttempts }}</td>
                <td>{{ schedule.retryIntervalSeconds }} sec</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
