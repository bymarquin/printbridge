<script setup lang="ts">
import Button from './ui/Button.vue'

defineProps<{ title: string; message: string }>()
const emit = defineEmits<{ (e: 'ok'): void; (e: 'cancel'): void }>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="emit('cancel')">
    <div class="w-full max-w-sm rounded-xl bg-zinc-900 p-5 shadow-2xl">
      <h3 class="font-semibold text-white">{{ title }}</h3>
      <p class="mt-1 text-sm text-zinc-400">{{ message }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" @click="emit('cancel')">Cancelar</Button>
        <Button variant="danger" @click="emit('ok')">Confirmar</Button>
      </div>
    </div>
  </div>
</template>
