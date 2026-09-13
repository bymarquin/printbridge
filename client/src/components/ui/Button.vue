<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ variant?: 'primary' | 'danger' | 'ghost'; size?: 'md' | 'sm'; type?: 'button' | 'submit' }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)

const cls = computed(() => {
  const sizes = props.size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-xs'
  const variants =
    props.variant === 'primary'
      ? 'bg-white text-zinc-950 hover:bg-zinc-200'
      : props.variant === 'danger'
        ? 'bg-red-500 text-white hover:bg-red-400'
        : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
  return `inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors ${sizes} ${variants}`
})
</script>

<template>
  <button :type="props.type" :class="cls"><slot /></button>
</template>
