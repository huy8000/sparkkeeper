<template>
  <section class="overview-section" aria-labelledby="quick-actions-title">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">Quick actions</p>
        <h3 id="quick-actions-title">Go to</h3>
      </div>
    </header>
    <nav class="quick-actions" aria-label="Overview quick actions">
      <RouterLink to="/accounts"
        ><strong>Manage accounts</strong><span>Account settings and login state</span></RouterLink
      >
      <RouterLink to="/templates"
        ><strong>Manage templates</strong><span>Safe message configuration</span></RouterLink
      >
      <RouterLink to="/runs"
        ><strong>View runs</strong><span>Read-only execution history</span></RouterLink
      >
      <RouterLink to="/operations/system"
        ><strong>System status</strong><span>Technical health and readiness</span></RouterLink
      >
    </nav>
  </section>
</template>
