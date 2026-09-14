<script setup lang="ts">
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[560px] text-sm">
      <slot />
    </table>
  </div>
</template>

<style scoped>
table :deep(thead th) {
  padding: 0.5rem 0.75rem 0.625rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-zinc-500);
  border-bottom: 1px solid var(--color-zinc-700);
}
table :deep(tbody td) {
  padding: 0.625rem 0.75rem;
  border-top: 1px solid var(--color-zinc-800);
}
table :deep(tbody tr:first-child td) {
  border-top: 0;
}
</style>
