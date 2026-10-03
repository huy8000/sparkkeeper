<script setup lang="ts">
import { useAccountWorkspace } from '../accountWorkspaceContext';
import UnifiedRunsPage from './UnifiedRunsPage.vue';
const workspace = useAccountWorkspace();
</script>
<template><UnifiedRunsPage :account-id="workspace.accountId.value" /></template>
