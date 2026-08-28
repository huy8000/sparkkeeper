<script setup lang="ts">
import { useTranslation } from '../i18n';

const { t } = useTranslation();
</script>

<template>
  <section class="not-found">
    <p class="eyebrow">404</p>
    <h2>{{ t('notFound.title') }}</h2>
    <p>{{ t('notFound.description') }}</p>
    <RouterLink class="button button--primary" to="/">{{ t('notFound.back') }}</RouterLink>
  </section>
</template>
