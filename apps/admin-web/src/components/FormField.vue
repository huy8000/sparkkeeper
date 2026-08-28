<script setup lang="ts">
import { computed, useId } from 'vue';

const props = defineProps<{ label: string; error?: string; helpText?: string }>();

const fieldId = useId();
const helpId = `${fieldId}-help`;
const errorId = `${fieldId}-error`;

const describedBy = computed(() => {
  if (props.error) return errorId;
  if (props.helpText) return helpId;
  return undefined;
});
</script>

<template>
  <!-- Shared form field wrapper: label, help text and error presentation. -->
  <label class="form-field" :for="fieldId">
    <span class="form-field__label">{{ props.label }}</span>
    <slot :field-id="fieldId" :described-by="describedBy" />
    <small v-if="props.helpText && !props.error" :id="helpId" class="form-field__help">{{
      props.helpText
    }}</small>
    <small v-if="props.error" :id="errorId" class="form-field__error" role="alert">{{
      props.error
    }}</small>
  </label>
</template>
