<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ variant?: 'primary' | 'danger' | 'ghost'; type?: 'button' | 'submit' }>(), {
  variant: 'primary',
  type: 'button',
})

const cls = computed(
  () =>
    'rounded-md px-4 py-2 font-bold transition-colors ' +
    (props.variant === 'primary'
      ? 'bg-white text-zinc-950 hover:bg-zinc-200'
      : props.variant === 'danger'
        ? 'bg-red-500 text-white hover:bg-red-400'
        : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'),
)
</script>

<template>
  <button :type="props.type" :class="cls"><slot /></button>
</template>
