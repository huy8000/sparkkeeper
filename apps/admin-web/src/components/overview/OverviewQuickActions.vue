<script setup lang="ts">
import { useTranslation } from '../../i18n';

const { t } = useTranslation();
</script>

<template>
  <section class="overview-section" aria-labelledby="quick-actions-title">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">{{ t('overview.quickActions.eyebrow') }}</p>
        <h3 id="quick-actions-title">{{ t('overview.quickActions.title') }}</h3>
      </div>
    </header>
    <nav class="quick-actions" :aria-label="t('overview.quickActions.navAria')">
      <RouterLink to="/accounts"
        ><strong>{{ t('overview.quickActions.accountsTitle') }}</strong
        ><span>{{ t('overview.quickActions.accountsDescription') }}</span></RouterLink
      >
      <RouterLink to="/templates"
        ><strong>{{ t('overview.quickActions.templatesTitle') }}</strong
        ><span>{{ t('overview.quickActions.templatesDescription') }}</span></RouterLink
      >
      <RouterLink to="/runs"
        ><strong>{{ t('overview.quickActions.runsTitle') }}</strong
        ><span>{{ t('overview.quickActions.runsDescription') }}</span></RouterLink
      >
      <RouterLink to="/operations/system"
        ><strong>{{ t('overview.quickActions.systemTitle') }}</strong
        ><span>{{ t('overview.quickActions.systemDescription') }}</span></RouterLink
      >
    </nav>
  </section>
</template>
