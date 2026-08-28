<script setup lang="ts">
/* global Event, HTMLSelectElement */
import { computed, reactive, ref, watch } from 'vue';

import {
  createTemplateDraft,
  keepStaticMessage,
  serializeTemplateDraft,
  toTemplateInput,
  transitionProvider,
  validateTemplateDraft,
  type TemplateDraft,
  type TemplateDraftErrors,
} from '../../templateEditorModel';
import type {
  MessageProviderType,
  MessageTemplateDetail,
  MessageTemplateInput,
} from '../../types/api';
import { useTranslation } from '../../i18n';
import FormField from '../FormField.vue';
import InlineError from '../InlineError.vue';
import Modal from '../Modal.vue';

const { t } = useTranslation();

const props = withDefaults(
  defineProps<{
    template?: MessageTemplateDetail | undefined;
    submitting?: boolean;
    serverError?: string;
    serverChanged?: boolean;
  }>(),
  { template: undefined, submitting: false, serverError: '', serverChanged: false },
);

const emit = defineEmits<{
  submit: [input: MessageTemplateInput];
  cancel: [];
  reload: [];
  dirtyChange: [dirty: boolean];
}>();

const form = reactive<TemplateDraft>(createTemplateDraft(props.template));
const initialSnapshot = ref(serializeTemplateDraft(form));
const validation = ref<TemplateDraftErrors>({ name: '', messages: [], summary: '' });
const staticSelectionOpen = ref(false);
const staticMessageIndex = ref(0);

const dirty = computed(() => serializeTemplateDraft(form) !== initialSnapshot.value);

watch(
  () => props.template,
  (template) => resetForm(template),
  { immediate: true },
);
watch(dirty, (value) => emit('dirtyChange', value), { immediate: true });

function resetForm(template?: MessageTemplateDetail): void {
  Object.assign(form, createTemplateDraft(template));
  initialSnapshot.value = serializeTemplateDraft(form);
  validation.value = { name: '', messages: [], summary: '' };
  staticSelectionOpen.value = false;
  staticMessageIndex.value = 0;
}

function requestProvider(event: Event): void {
  const target = event.target as HTMLSelectElement;
  const nextProvider = target.value as MessageProviderType;
  const transition = transitionProvider(form, nextProvider);
  if (transition.kind === 'selection-required') {
    staticMessageIndex.value = 0;
    staticSelectionOpen.value = true;
    target.value = form.providerType;
    return;
  }
  Object.assign(form, transition.draft);
}

function cancelStaticSelection(): void {
  staticSelectionOpen.value = false;
  staticMessageIndex.value = 0;
}

function confirmStaticSelection(): void {
  Object.assign(form, keepStaticMessage(form, staticMessageIndex.value));
  staticSelectionOpen.value = false;
}

function addMessage(): void {
  form.messages.push('');
}

function removeMessage(index: number): void {
  if (form.messages.length <= 1) return;
  form.messages.splice(index, 1);
}

function submit(): void {
  if (props.submitting) return;
  validation.value = validateTemplateDraft(form);
  if (
    validation.value.name !== '' ||
    validation.value.summary !== '' ||
    validation.value.messages.some((message) => message !== '')
  ) {
    return;
  }
  emit('submit', toTemplateInput(form));
}
</script>

<template>
  <form class="config-form template-editor" novalidate @submit.prevent="submit">
    <p class="drawer-intro">
      {{ t('templateEditor.intro') }}
    </p>

    <section v-if="props.serverChanged" class="template-server-change" role="alert">
      <div>
        <strong>{{ t('templateEditor.serverChangedTitle') }}</strong>
        <p>{{ t('templateEditor.serverChangedBody') }}</p>
      </div>
      <button
        class="button button--secondary button--compact"
        type="button"
        @click="emit('reload')"
      >
        {{ t('templateEditor.reloadFromServer') }}
      </button>
    </section>

    <FormField
      :label="t('templateEditor.nameLabel')"
      :error="validation.name === '' ? '' : t(validation.name)"
    >
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="form.name"
          name="templateName"
          autocomplete="off"
          :aria-describedby="describedBy"
          :aria-invalid="validation.name !== ''"
          :disabled="props.submitting"
        />
      </template>
    </FormField>

    <FormField
      :label="t('templateEditor.providerLabel')"
      :help-text="t('templateEditor.providerHelp')"
    >
      <template #default="{ fieldId, describedBy }">
        <select
          :id="fieldId"
          name="providerType"
          :value="form.providerType"
          :aria-describedby="describedBy"
          :disabled="props.submitting"
          @change="requestProvider"
        >
          <option value="STATIC">{{ t('templateEditor.providerStatic') }}</option>
          <option value="RANDOM">{{ t('templateEditor.providerRandom') }}</option>
        </select>
      </template>
    </FormField>

    <fieldset class="template-message-editor">
      <legend>
        {{
          form.providerType === 'STATIC'
            ? t('templateEditor.messagesLegendStatic')
            : t('templateEditor.messagesLegendRandom')
        }}
      </legend>
      <p class="template-message-editor__help">
        {{
          form.providerType === 'STATIC'
            ? t('templateEditor.staticHelp')
            : t('templateEditor.randomHelp')
        }}
      </p>
      <div v-for="(_message, index) in form.messages" :key="index" class="template-message-item">
        <div class="template-message-item__heading">
          <label :for="`template-message-${index}`">{{
            t('templateEditor.messageIndexLabel', { index: index + 1 })
          }}</label>
          <button
            v-if="form.providerType === 'RANDOM'"
            class="button button--secondary button--compact"
            type="button"
            :aria-label="t('templateEditor.removeMessageAria', { index: index + 1 })"
            :title="form.messages.length === 1 ? t('templateEditor.removeDisabledTitle') : ''"
            :disabled="props.submitting || form.messages.length === 1"
            @click="removeMessage(index)"
          >
            {{ t('templateEditor.remove') }}
          </button>
        </div>
        <textarea
          :id="`template-message-${index}`"
          v-model="form.messages[index]"
          :name="`message-${index}`"
          rows="5"
          :aria-describedby="
            validation.messages[index] ? `template-message-${index}-error` : undefined
          "
          :aria-invalid="
            validation.messages[index] !== undefined && validation.messages[index] !== ''
          "
          :disabled="props.submitting"
        />
        <small
          v-if="validation.messages[index]"
          :id="`template-message-${index}-error`"
          class="form-field__error"
          role="alert"
        >
          {{ t(validation.messages[index]!) }}
        </small>
      </div>
      <button
        v-if="form.providerType === 'RANDOM'"
        class="button button--secondary template-message-editor__add"
        type="button"
        :disabled="props.submitting"
        @click="addMessage"
      >
        {{ t('templateEditor.addMessage') }}
      </button>
    </fieldset>

    <label class="checkbox-field">
      <input
        v-model="form.enabled"
        name="templateEnabled"
        type="checkbox"
        :disabled="props.submitting"
      />
      {{ t('templateEditor.templateEnabled') }}
    </label>
    <p class="form-note">
      {{ t('templateEditor.enabledNote') }}
    </p>

    <InlineError v-if="validation.summary" :message="t(validation.summary)" />
    <InlineError v-if="props.serverError" :message="props.serverError" />

    <div class="form-actions template-editor__actions">
      <button class="button button--primary" type="submit" :disabled="props.submitting">
        {{ props.submitting ? t('templateEditor.saving') : t('templateEditor.save') }}
      </button>
      <button
        class="button button--secondary"
        type="button"
        :disabled="props.submitting"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
    </div>
  </form>

  <Modal
    :open="staticSelectionOpen"
    :title="t('templateEditor.staticModalTitle')"
    labelled-by="static-message-selection-title"
    compact
    @close="cancelStaticSelection"
  >
    <div class="template-static-selection">
      <p>
        <strong>{{ t('templateEditor.staticModalEmphasis') }}</strong>
      </p>
      <p>{{ t('templateEditor.staticModalDescription') }}</p>
      <fieldset>
        <legend>{{ t('templateEditor.staticModalLegend') }}</legend>
        <label v-for="(_message, index) in form.messages" :key="index">
          <input v-model="staticMessageIndex" type="radio" name="staticMessage" :value="index" />
          <span>{{ t('templateEditor.keepMessage', { index: index + 1 }) }}</span>
        </label>
      </fieldset>
      <div class="modal-actions">
        <button class="button button--secondary" type="button" @click="cancelStaticSelection">
          {{ t('common.cancel') }}
        </button>
        <button class="button button--primary" type="button" @click="confirmStaticSelection">
          {{ t('templateEditor.keepSelected') }}
        </button>
      </div>
    </div>
  </Modal>
</template>
