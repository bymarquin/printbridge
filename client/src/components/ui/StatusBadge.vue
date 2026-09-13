<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()
const cls = computed(() =>
  props.status === 'completed' || props.status === 'ready'
    ? 'bg-emerald-950 text-emerald-300'
    : props.status === 'failed' || props.status === 'offline'
      ? 'bg-red-950 text-red-300'
      : props.status === 'pending'
        ? 'bg-amber-950 text-amber-300'
        : 'bg-zinc-800 text-zinc-300',
)
</script>

<template>
  <span :class="'rounded-full px-2 py-0.5 text-xs ' + cls">{{ status }}</span>
</template>
