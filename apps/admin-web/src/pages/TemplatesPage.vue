<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { ApiError } from '../api/client';
import { useAdminApp } from '../appContext';
import DangerConfirmation from '../components/DangerConfirmation.vue';
import Drawer from '../components/Drawer.vue';
import EmptyState from '../components/EmptyState.vue';
import InlineError from '../components/InlineError.vue';
import PageError from '../components/PageError.vue';
import SectionLoading from '../components/SectionLoading.vue';
import Skeleton from '../components/Skeleton.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TemplateEditor from '../components/template/TemplateEditor.vue';
import { useDebouncedAction } from '../composables/useDebouncedAction';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import type { MessageTemplateDetail, MessageTemplateInput, RealtimeEvent } from '../types/api';
import { formatTimestamp } from '../utils/format';

type EditorMode = 'create' | 'edit';
type ConfirmationAction = 'close' | 'reload';

const app = useAdminApp();
const toasts = useToasts();
const templates = useRequest((signal) => app.api.listTemplates(signal));
const drawerOpen = ref(false);
const editorMode = ref<EditorMode>('create');
const editingTemplateId = ref('');
const detail = ref<MessageTemplateDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const submitting = ref(false);
const mutationError = ref('');
const editorDirty = ref(false);
const serverChanged = ref(false);
const confirmationAction = ref<ConfirmationAction | null>(null);
let detailController: InstanceType<typeof globalThis.AbortController> | undefined;
let detailRequestNumber = 0;

watch(app.refreshVersion, () => {
  void templates.load();
  if (!drawerOpen.value || editorMode.value !== 'edit') return;
  if (editorDirty.value) serverChanged.value = true;
  else void loadDetail();
});

useRealtimeRefresh(app.realtime, isTemplateConfigurationEvent, () => void templates.load());
const detailRefresh = useDebouncedAction(() => {
  if (drawerOpen.value && editorMode.value === 'edit' && !editorDirty.value) void loadDetail();
});
const unsubscribeRealtime = app.realtime.subscribe((event) => {
  if (
    !isTemplateConfigurationEvent(event) ||
    event.data.entityId !== editingTemplateId.value ||
    !drawerOpen.value ||
    editorMode.value !== 'edit'
  ) {
    return;
  }
  if (editorDirty.value) serverChanged.value = true;
  else detailRefresh.trigger();
});

function isTemplateConfigurationEvent(
  event: RealtimeEvent,
): event is Extract<RealtimeEvent, { type: 'CONFIG_CHANGED' }> {
  return event.type === 'CONFIG_CHANGED' && event.data.entityType === 'TEMPLATE';
}

function beginCreate(): void {
  cancelDetail();
  editorMode.value = 'create';
  editingTemplateId.value = '';
  detail.value = null;
  detailError.value = '';
  mutationError.value = '';
  editorDirty.value = false;
  serverChanged.value = false;
  drawerOpen.value = true;
}

function beginEdit(templateId: string): void {
  cancelDetail();
  editorMode.value = 'edit';
  editingTemplateId.value = templateId;
  detail.value = null;
  detailError.value = '';
  mutationError.value = '';
  editorDirty.value = false;
  serverChanged.value = false;
  drawerOpen.value = true;
  void loadDetail();
}

function cancelDetail(): void {
  detailController?.abort();
  detailController = undefined;
  detailRefresh.cancel();
}

async function loadDetail(): Promise<void> {
  if (editingTemplateId.value === '') return;
  detailController?.abort();
  const requestNumber = ++detailRequestNumber;
  const controller = new globalThis.AbortController();
  detailController = controller;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const loaded = await app.api.getTemplate(editingTemplateId.value, controller.signal);
    if (requestNumber !== detailRequestNumber) return;
    detail.value = loaded;
    editorDirty.value = false;
    serverChanged.value = false;
    mutationError.value = '';
  } catch (error) {
    if (
      requestNumber === detailRequestNumber &&
      !(error instanceof ApiError && error.kind === 'ABORT')
    ) {
      detailError.value =
        error instanceof ApiError ? error.message : 'Unable to load the template editor.';
    }
  } finally {
    if (requestNumber === detailRequestNumber) detailLoading.value = false;
  }
}

function requestClose(): void {
  if (submitting.value) return;
  if (editorDirty.value) confirmationAction.value = 'close';
  else closeEditor();
}

function requestReload(): void {
  if (submitting.value) return;
  if (editorDirty.value) confirmationAction.value = 'reload';
  else void loadDetail();
}

function cancelConfirmation(): void {
  confirmationAction.value = null;
}

function confirmDiscard(): void {
  const action = confirmationAction.value;
  confirmationAction.value = null;
  if (action === 'close') closeEditor();
  else if (action === 'reload') void loadDetail();
}

function closeEditor(): void {
  cancelDetail();
  drawerOpen.value = false;
  editingTemplateId.value = '';
  detail.value = null;
  detailLoading.value = false;
  detailError.value = '';
  mutationError.value = '';
  editorDirty.value = false;
  serverChanged.value = false;
}

async function saveTemplate(input: MessageTemplateInput): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  mutationError.value = '';
  try {
    if (editorMode.value === 'create') await app.api.createTemplate(input);
    else await app.api.updateTemplate(editingTemplateId.value, input);
    closeEditor();
    await templates.load();
    toasts.notify('success', 'Template configuration saved.');
  } catch (error) {
    mutationError.value =
      error instanceof ApiError ? error.message : 'Template configuration could not be saved.';
    toasts.notify('error', 'Template configuration could not be saved.');
  } finally {
    submitting.value = false;
  }
}

onBeforeUnmount(() => {
  unsubscribeRealtime();
  cancelDetail();
});
</script>

<template>
  <div class="page-stack templates-page">
    <header class="page-heading templates-heading">
      <div>
        <p class="eyebrow">Templates</p>
        <h2>Message templates</h2>
        <p>Configure the exact message content available to SparkKeeper runs.</p>
      </div>
      <button class="button button--primary" type="button" @click="beginCreate">
        + New template
      </button>
    </header>

    <section class="template-privacy-note" aria-label="Template privacy">
      <span aria-hidden="true">◇</span>
      <p>
        Message text is loaded only when you open an editor. List summaries never request or expose
        message content.
      </p>
    </section>

    <section
      v-if="templates.loading.value && templates.data.value === null"
      class="template-list-skeleton"
      aria-label="Loading templates"
      aria-busy="true"
    >
      <article v-for="index in 3" :key="index" class="template-card">
        <Skeleton width="42%" height="18px" label="Loading template name" />
        <Skeleton width="68%" height="13px" label="Loading template summary" />
        <Skeleton width="100%" height="42px" label="Loading template metadata" />
      </article>
    </section>

    <PageError
      v-else-if="templates.error.value"
      title="Unable to load templates"
      :message="templates.error.value.message"
      @retry="templates.load"
    />

    <EmptyState
      v-else-if="templates.data.value?.length === 0"
      title="No templates yet"
      description="Create a template before running SparkKeeper."
    >
      <template #action>
        <button class="button button--primary" type="button" @click="beginCreate">
          + New template
        </button>
      </template>
    </EmptyState>

    <ul v-else-if="templates.data.value" class="template-list" aria-label="Configured templates">
      <li v-for="template in templates.data.value" :key="template.id">
        <article class="template-card" :class="{ 'template-card--disabled': !template.enabled }">
          <header class="template-card__header">
            <div>
              <p class="eyebrow">{{ template.providerType === 'STATIC' ? 'Static' : 'Random' }}</p>
              <h3>{{ template.name }}</h3>
            </div>
            <StatusBadge :status="template.enabled ? 'ENABLED' : 'DISABLED'" />
          </header>
          <dl class="template-card__meta">
            <div>
              <dt>Provider</dt>
              <dd>{{ template.providerType === 'STATIC' ? 'Static' : 'Random' }}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>
                {{ template.messageCount }}
                {{ template.messageCount === 1 ? 'message' : 'messages' }}
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{{ formatTimestamp(template.updatedAt) }}</dd>
            </div>
          </dl>
          <footer class="template-card__footer">
            <span>Configured messages are available only through the editor.</span>
            <button
              class="button button--secondary button--compact"
              type="button"
              :aria-label="`Edit ${template.name}`"
              @click="beginEdit(template.id)"
            >
              Edit
            </button>
          </footer>
        </article>
      </li>
    </ul>

    <Drawer
      :open="drawerOpen"
      :title="editorMode === 'create' ? 'Create template' : 'Edit template'"
      @close="requestClose"
    >
      <SectionLoading
        v-if="editorMode === 'edit' && detailLoading && detail === null"
        label="Loading template editor…"
      />
      <section
        v-else-if="editorMode === 'edit' && detailError && detail === null"
        class="section-error-stack"
      >
        <InlineError :message="detailError" />
        <div class="form-actions">
          <button class="button button--secondary" type="button" @click="loadDetail">Retry</button>
          <button class="button button--secondary" type="button" @click="closeEditor">Close</button>
        </div>
      </section>
      <template v-else>
        <InlineError v-if="detailError" :message="detailError" />
        <TemplateEditor
          :template="editorMode === 'edit' ? (detail ?? undefined) : undefined"
          :submitting="submitting"
          :server-error="mutationError"
          :server-changed="serverChanged"
          @submit="saveTemplate"
          @cancel="requestClose"
          @reload="requestReload"
          @dirty-change="editorDirty = $event"
        />
      </template>
    </Drawer>

    <DangerConfirmation
      :open="confirmationAction !== null"
      :title="confirmationAction === 'reload' ? 'Reload from server?' : 'Discard unsaved changes?'"
      :description="
        confirmationAction === 'reload'
          ? 'Reloading will replace your current unsaved editor values with the latest server configuration.'
          : 'Closing the editor will discard your current unsaved changes.'
      "
      confirm-label="Discard changes"
      cancel-label="Keep editing"
      @close="cancelConfirmation"
      @confirm="confirmDiscard"
    />
  </div>
</template>
