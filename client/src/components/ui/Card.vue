<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <section class="rounded-xl bg-zinc-900 p-5">
    <h2 v-if="title" class="mb-3 text-base font-semibold text-white">{{ title }}</h2>
    <slot />
  </section>
</template>
