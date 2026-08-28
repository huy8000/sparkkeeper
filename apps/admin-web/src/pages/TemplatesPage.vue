<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { ApiError } from '../api/client';
import { REALTIME_REFRESH_DELAY_MS } from '../api/realtimePolicy';
import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import DangerConfirmation from '../components/DangerConfirmation.vue';
import Drawer from '../components/Drawer.vue';
import EmptyState from '../components/EmptyState.vue';
import InlineError from '../components/InlineError.vue';
import PageError from '../components/PageError.vue';
import SectionLoading from '../components/SectionLoading.vue';
import Skeleton from '../components/Skeleton.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import TemplateEditor from '../components/template/TemplateEditor.vue';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useDebouncedAction } from '../composables/useDebouncedAction';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import { useTranslation } from '../i18n';
import type { MessageTemplateDetail, MessageTemplateInput, RealtimeEvent } from '../types/api';
import { formatTimestamp } from '../utils/format';

type EditorMode = 'create' | 'edit';
type ConfirmationAction = 'close' | 'reload';

const app = useAdminApp();
const toasts = useToasts();
const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
const templates = useRequest((signal) => app.api.listTemplates(signal));
const drawerOpen = ref(false);
const editorMode = ref<EditorMode>('create');
const editingTemplateId = ref('');
const detail = ref<MessageTemplateDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<ApiError | string>('');
const submitting = ref(false);
const mutationError = ref<ApiError | string>('');
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
}, REALTIME_REFRESH_DELAY_MS);
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
      detailError.value = error instanceof ApiError ? error : t('templatesPage.loadEditorError');
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
    toasts.notify('success', t('templatesPage.savedToast'));
  } catch (error) {
    mutationError.value = error instanceof ApiError ? error : t('templatesPage.saveErrorToast');
    toasts.notify('error', t('templatesPage.saveErrorToast'));
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
        <p class="eyebrow">{{ t('nav.templates') }}</p>
        <h2>{{ t('templatesPage.title') }}</h2>
        <p>{{ t('templatesPage.subtitle') }}</p>
      </div>
      <button class="button button--primary" type="button" @click="beginCreate">
        {{ t('templatesPage.new') }}
      </button>
    </header>

    <section class="template-privacy-note" :aria-label="t('templatesPage.privacyAria')">
      <span aria-hidden="true">◇</span>
      <p>
        {{ t('templatesPage.privacyNote') }}
      </p>
    </section>

    <BackgroundRefreshIndicator v-if="templates.refreshing.value" />
    <StaleDataNotice
      v-if="templates.refreshError.value"
      :error="templates.refreshError.value"
      @retry="templates.load"
    />

    <section
      v-if="templates.initialLoading.value"
      class="template-list-skeleton"
      :aria-label="t('templatesPage.loadingAria')"
      aria-busy="true"
    >
      <article v-for="index in 3" :key="index" class="template-card">
        <Skeleton width="42%" height="18px" :label="t('templatesPage.skeletonName')" />
        <Skeleton width="68%" height="13px" :label="t('templatesPage.skeletonSummary')" />
        <Skeleton width="100%" height="42px" :label="t('templatesPage.skeletonMeta')" />
      </article>
    </section>

    <PageError
      v-else-if="templates.initialError.value"
      :title="t('templatesPage.errorTitle')"
      :error="templates.initialError.value"
      @retry="templates.load"
    />

    <EmptyState
      v-else-if="templates.data.value?.length === 0"
      :title="t('templatesPage.emptyTitle')"
      :description="t('templatesPage.emptyDescription')"
    >
      <template #action>
        <button class="button button--primary" type="button" @click="beginCreate">
          {{ t('templatesPage.new') }}
        </button>
      </template>
    </EmptyState>

    <ul
      v-else-if="templates.data.value"
      class="template-list"
      :aria-label="t('templatesPage.listAria')"
    >
      <li v-for="template in templates.data.value" :key="template.id">
        <article class="template-card" :class="{ 'template-card--disabled': !template.enabled }">
          <header class="template-card__header">
            <div>
              <p class="eyebrow">
                {{
                  template.providerType === 'STATIC'
                    ? t('templateEditor.providerStatic')
                    : t('templateEditor.providerRandom')
                }}
              </p>
              <h3>{{ template.name }}</h3>
            </div>
            <StatusBadge :status="template.enabled ? 'ENABLED' : 'DISABLED'" />
          </header>
          <dl class="template-card__meta">
            <div>
              <dt>{{ t('templatesPage.columnProvider') }}</dt>
              <dd>
                {{
                  template.providerType === 'STATIC'
                    ? t('templateEditor.providerStatic')
                    : t('templateEditor.providerRandom')
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t('templatesPage.columnMessages') }}</dt>
              <dd>
                {{ t('templatesPage.messageCount', template.messageCount) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('templatesPage.columnUpdated') }}</dt>
              <dd>{{ formatTimestamp(template.updatedAt) }}</dd>
            </div>
          </dl>
          <footer class="template-card__footer">
            <span>{{ t('templatesPage.footerNote') }}</span>
            <button
              class="button button--secondary button--compact"
              type="button"
              :aria-label="t('templatesPage.editAria', { name: template.name })"
              @click="beginEdit(template.id)"
            >
              {{ t('common.edit') }}
            </button>
          </footer>
        </article>
      </li>
    </ul>

    <Drawer
      :open="drawerOpen"
      :title="
        editorMode === 'create'
          ? t('templatesPage.drawerCreateTitle')
          : t('templatesPage.drawerEditTitle')
      "
      @close="requestClose"
    >
      <SectionLoading
        v-if="editorMode === 'edit' && detailLoading && detail === null"
        :label="t('templatesPage.editorLoading')"
      />
      <section
        v-else-if="editorMode === 'edit' && detailError && detail === null"
        class="section-error-stack"
      >
        <InlineError :error="detailError" />
        <div class="form-actions">
          <button class="button button--secondary" type="button" @click="loadDetail">
            {{ t('common.retry') }}
          </button>
          <button class="button button--secondary" type="button" @click="closeEditor">
            {{ t('common.close') }}
          </button>
        </div>
      </section>
      <template v-else>
        <BackgroundRefreshIndicator
          v-if="detailLoading && detail !== null"
          :label="t('templatesPage.editorRefreshing')"
        />
        <StaleDataNotice
          v-if="detailError && detail !== null"
          :error="detailError"
          @retry="loadDetail"
        />
        <TemplateEditor
          :template="editorMode === 'edit' ? (detail ?? undefined) : undefined"
          :submitting="submitting"
          :server-error="apiErrorText(mutationError)"
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
      :title="
        confirmationAction === 'reload'
          ? t('templatesPage.reloadConfirmTitle')
          : t('templatesPage.discardConfirmTitle')
      "
      :description="
        confirmationAction === 'reload'
          ? t('templatesPage.reloadConfirmDescription')
          : t('templatesPage.discardConfirmDescription')
      "
      :confirm-label="t('templatesPage.discardChanges')"
      :cancel-label="t('account.keepEditing')"
      @close="cancelConfirmation"
      @confirm="confirmDiscard"
    />
  </div>
</template>
