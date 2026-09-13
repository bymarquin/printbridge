<script setup lang="ts">
defineProps<{ label?: string; options: Array<{ value: string; label: string }> }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div>
    <label v-if="label" class="mb-1 block text-xs text-zinc-400">{{ label }}</label>
    <select v-model="model" class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-white">
      <slot><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></slot>
    </select>
  </div>
</template>
