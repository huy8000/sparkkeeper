<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FormPanel from '../components/FormPanel.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { useMutation } from '../composables/useMutation';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import type {
  MessageProviderType,
  MessageTemplateDetail,
  MessageTemplateInput,
} from '../types/api';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const templates = useRequest((signal) => app.api.listTemplates(signal));
const editing = ref<MessageTemplateDetail | null>(null);
const formOpen = ref(false);
const loadingDetail = ref(false);
const {
  submitting,
  error: formError,
  success: successMessage,
  execute,
  clearError,
} = useMutation();
const form = reactive({
  name: '',
  providerType: 'STATIC' as MessageProviderType,
  messages: [''],
  enabled: true,
});
watch(app.refreshVersion, () => void templates.load());
useRealtimeRefresh(
  app.realtime,
  (event) => event.type === 'CONFIG_CHANGED' && event.data.entityType === 'TEMPLATE',
  () => void templates.load(),
);

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { name: '', providerType: 'STATIC', messages: [''], enabled: true });
  formOpen.value = true;
  clearError();
}

async function openEdit(templateId: string): Promise<void> {
  loadingDetail.value = true;
  clearError();
  try {
    const template = await app.api.getTemplate(templateId);
    editing.value = template;
    Object.assign(form, {
      name: template.name,
      providerType: template.providerType,
      messages: [...template.messages],
      enabled: template.enabled,
    });
    formOpen.value = true;
  } catch {
    formError.value = 'Unable to load the template editor.';
  } finally {
    loadingDetail.value = false;
  }
}

function closeForm(): void {
  formOpen.value = false;
  editing.value = null;
  clearError();
}

function changeProvider(): void {
  if (form.providerType === 'STATIC') form.messages = [form.messages[0] ?? ''];
  else if (form.messages.length === 0) form.messages = [''];
}

function addMessage(): void {
  form.messages.push('');
}

function removeMessage(index: number): void {
  if (form.messages.length > 1) form.messages.splice(index, 1);
}

async function saveTemplate(): Promise<void> {
  if (submitting.value) return;
  const name = form.name.trim();
  const messages = [...form.messages];
  if (name.length === 0) {
    formError.value = 'Template name is required.';
    return;
  }
  if (messages.length === 0 || messages.some((message) => message.trim().length === 0)) {
    formError.value = 'Every template message must contain text.';
    return;
  }
  if (form.providerType === 'STATIC' && messages.length !== 1) {
    formError.value = 'STATIC templates require exactly one message.';
    return;
  }
  const input: MessageTemplateInput = {
    name,
    providerType: form.providerType,
    messages,
    enabled: form.enabled,
  };
  const templateId = editing.value?.id;
  await execute(
    () =>
      templateId === undefined
        ? app.api.createTemplate(input)
        : app.api.updateTemplate(templateId, input),
    async () => {
      closeForm();
      await templates.load();
    },
    'Message template configuration saved.',
  );
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Templates</p>
        <h2>Message templates</h2>
        <p>Manage local STATIC and RANDOM template configuration.</p>
      </div>
      <div class="page-actions">
        <button class="button button--primary" type="button" @click="openCreate">
          Create template
        </button>
        <button class="button button--secondary" type="button" @click="templates.load">
          Refresh
        </button>
      </div>
    </header>
    <p class="notice-card template-privacy-note">
      Template text remains local configuration. It is not written to URLs, browser storage, or
      application logs by this Admin UI.
    </p>
    <p v-if="successMessage" class="success-message" role="status">{{ successMessage }}</p>
    <p v-if="loadingDetail" role="status">Loading template editor…</p>
    <p v-else-if="formError && !formOpen" class="form-error" role="alert">{{ formError }}</p>

    <FormPanel
      v-if="formOpen"
      :title="editing ? 'Edit template' : 'Create template'"
      description="Saving changes configuration only; it does not send a message."
      @cancel="closeForm"
    >
      <form class="config-form" novalidate @submit.prevent="saveTemplate">
        <label
          >Template name<input
            v-model="form.name"
            name="templateName"
            autocomplete="off"
            :disabled="submitting"
        /></label>
        <label
          >Provider
          <select
            v-model="form.providerType"
            name="providerType"
            :disabled="submitting"
            @change="changeProvider"
          >
            <option value="STATIC">STATIC</option>
            <option value="RANDOM">RANDOM</option>
          </select>
        </label>
        <fieldset class="message-fields">
          <legend>{{ form.providerType === 'STATIC' ? 'Message' : 'Messages' }}</legend>
          <div v-for="(_message, index) in form.messages" :key="index" class="message-field">
            <label :for="`template-message-${index}`">Message {{ index + 1 }}</label>
            <textarea
              :id="`template-message-${index}`"
              v-model="form.messages[index]"
              :name="`message-${index}`"
              rows="4"
              :disabled="submitting"
            />
            <button
              v-if="form.providerType === 'RANDOM' && form.messages.length > 1"
              class="button button--secondary button--compact"
              type="button"
              :disabled="submitting"
              @click="removeMessage(index)"
            >
              Remove message
            </button>
          </div>
          <button
            v-if="form.providerType === 'RANDOM'"
            class="button button--secondary"
            type="button"
            :disabled="submitting"
            @click="addMessage"
          >
            Add message
          </button>
        </fieldset>
        <label class="checkbox-field"
          ><input
            v-model="form.enabled"
            name="templateEnabled"
            type="checkbox"
            :disabled="submitting"
          />Template enabled</label
        >
        <p v-if="form.enabled && editing?.enabled === false" class="form-note">
          Enabling this template makes it eligible for future configured schedules; saving does not
          run or send anything.
        </p>
        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
        <div class="form-actions">
          <button class="button button--primary" type="submit" :disabled="submitting">
            {{ submitting ? 'Saving…' : 'Save template' }}
          </button>
          <button
            class="button button--secondary"
            type="button"
            :disabled="submitting"
            @click="closeForm"
          >
            Reset
          </button>
        </div>
      </form>
    </FormPanel>

    <LoadingState
      v-if="templates.loading.value && !templates.data.value"
      label="Loading templates…"
    />
    <ErrorState
      v-else-if="templates.error.value"
      :message="templates.error.value.message"
      @retry="templates.load"
    />
    <EmptyState
      v-else-if="templates.data.value?.length === 0"
      title="No templates"
      description="No message templates are configured."
    />
    <div v-else-if="templates.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Enabled</th>
            <th>Messages</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="template in templates.data.value" :key="template.id">
            <td>
              <strong>{{ template.name }}</strong>
            </td>
            <td><StatusBadge :status="template.providerType" /></td>
            <td><StatusBadge :status="template.enabled ? 'ENABLED' : 'DISABLED'" /></td>
            <td>{{ template.messageCount }}</td>
            <td>{{ formatTimestamp(template.updatedAt) }}</td>
            <td>
              <button
                class="button button--secondary button--compact"
                type="button"
                @click="openEdit(template.id)"
              >
                Edit
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
