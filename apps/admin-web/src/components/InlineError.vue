<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <!-- Inline GET/section error; layout and user input stay intact. -->
  <p class="inline-error" role="alert">{{ message }}</p>
</template>
