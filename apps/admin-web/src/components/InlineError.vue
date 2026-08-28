<script setup lang="ts">
import type { ApiErrorSource } from '../composables/useApiErrorText';
import { useApiErrorText } from '../composables/useApiErrorText';

defineProps<{ message?: string; error?: ApiErrorSource }>();

const { apiErrorText } = useApiErrorText();
</script>

<template>
  <!-- Inline GET/section error; layout and user input stay intact. -->
  <!-- Localized at render time so a language switch re-renders the copy. -->
  <p class="inline-error" role="alert">{{ error !== undefined ? apiErrorText(error) : message }}</p>
</template>
