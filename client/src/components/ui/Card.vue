<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <section class="rounded-xl bg-zinc-900 p-4">
    <h2 v-if="title" class="mb-2 text-lg font-semibold text-zinc-100">{{ title }}</h2>
    <slot />
  </section>
</template>
