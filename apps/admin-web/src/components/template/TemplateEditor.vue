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
import FormField from '../FormField.vue';
import InlineError from '../InlineError.vue';
import Modal from '../Modal.vue';

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
      Saving changes updates local configuration only. It does not render, send, or run a message.
    </p>

    <section v-if="props.serverChanged" class="template-server-change" role="alert">
      <div>
        <strong>Server configuration changed while you were editing.</strong>
        <p>Your unsaved messages are preserved. Reload only when you are ready to discard them.</p>
      </div>
      <button
        class="button button--secondary button--compact"
        type="button"
        @click="emit('reload')"
      >
        Reload from server
      </button>
    </section>

    <FormField label="Template name" :error="validation.name">
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
      label="Provider type"
      help-text="Static uses one message. Random chooses from one or more configured candidates at runtime."
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
          <option value="STATIC">Static</option>
          <option value="RANDOM">Random</option>
        </select>
      </template>
    </FormField>

    <fieldset class="template-message-editor">
      <legend>{{ form.providerType === 'STATIC' ? 'Message' : 'Configured messages' }}</legend>
      <p class="template-message-editor__help">
        {{
          form.providerType === 'STATIC'
            ? 'Static templates contain exactly one message.'
            : 'Random templates keep candidate order and require at least one message.'
        }}
      </p>
      <div v-for="(_message, index) in form.messages" :key="index" class="template-message-item">
        <div class="template-message-item__heading">
          <label :for="`template-message-${index}`">Message {{ index + 1 }}</label>
          <button
            v-if="form.providerType === 'RANDOM'"
            class="button button--secondary button--compact"
            type="button"
            :aria-label="`Remove Message ${index + 1}`"
            :title="form.messages.length === 1 ? 'A Random template must keep one message.' : ''"
            :disabled="props.submitting || form.messages.length === 1"
            @click="removeMessage(index)"
          >
            Remove
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
          {{ validation.messages[index] }}
        </small>
      </div>
      <button
        v-if="form.providerType === 'RANDOM'"
        class="button button--secondary template-message-editor__add"
        type="button"
        :disabled="props.submitting"
        @click="addMessage"
      >
        + Add message
      </button>
    </fieldset>

    <label class="checkbox-field">
      <input
        v-model="form.enabled"
        name="templateEnabled"
        type="checkbox"
        :disabled="props.submitting"
      />
      Template enabled
    </label>
    <p class="form-note">
      Disabled templates remain editable and visible in Manual Run; server preflight decides whether
      they can run.
    </p>

    <InlineError v-if="validation.summary" :message="validation.summary" />
    <InlineError v-if="props.serverError" :message="props.serverError" />

    <div class="form-actions template-editor__actions">
      <button class="button button--primary" type="submit" :disabled="props.submitting">
        {{ props.submitting ? 'Saving…' : 'Save template' }}
      </button>
      <button
        class="button button--secondary"
        type="button"
        :disabled="props.submitting"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </form>

  <Modal
    :open="staticSelectionOpen"
    title="Choose the Static message"
    labelled-by="static-message-selection-title"
    compact
    @close="cancelStaticSelection"
  >
    <div class="template-static-selection">
      <p><strong>Static templates can contain only one message.</strong></p>
      <p>Select the message to keep. No server change occurs until you save the template.</p>
      <fieldset>
        <legend>Message to keep</legend>
        <label v-for="(_message, index) in form.messages" :key="index">
          <input v-model="staticMessageIndex" type="radio" name="staticMessage" :value="index" />
          <span>Keep Message {{ index + 1 }}</span>
        </label>
      </fieldset>
      <div class="modal-actions">
        <button class="button button--secondary" type="button" @click="cancelStaticSelection">
          Cancel
        </button>
        <button class="button button--primary" type="button" @click="confirmStaticSelection">
          Keep selected message
        </button>
      </div>
    </div>
  </Modal>
</template>
