<script setup lang="ts">
defineProps<{ label?: string; placeholder?: string; type?: string }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div>
    <label v-if="label" class="mb-1 block text-xs text-zinc-400">{{ label }}</label>
    <input v-model="model" :type="type ?? 'text'" :placeholder="placeholder"
      class="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-white" />
  </div>
</template>
