<script setup lang="ts">
import { CheckCircle2, CircleAlert, CircleX, Info, X } from 'lucide-vue-next'
import { useToast, type ToastKind } from '../stores/toast'

const toast = useToast()
const icons: Record<ToastKind, unknown> = { success: CheckCircle2, error: CircleX, warning: CircleAlert, info: Info }
const bar: Record<ToastKind, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-zinc-400',
}
const iconCls: Record<ToastKind, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-zinc-400',
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-5 right-5 z-50 flex w-84 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
    <TransitionGroup name="toast">
      <div v-for="t in toast.items" :key="t.id"
        class="pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-2.5 pl-3 pr-2 shadow-2xl">
        <span :class="'h-8 w-1 shrink-0 self-stretch rounded-full ' + bar[t.kind]" />
        <component :is="icons[t.kind]" :size="16" :class="'shrink-0 pt-0.5 ' + iconCls[t.kind]" />
        <div class="grow">
          <p class="text-[13px] font-medium leading-snug text-zinc-100">{{ t.message }}</p>
          <p v-if="t.description" class="mt-0.5 text-xs leading-snug text-zinc-400">{{ t.description }}</p>
        </div>
        <button @click="toast.dismiss(t.id)" aria-label="Fechar"
          class="shrink-0 rounded p-1 pt-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X :size="14" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active { transition: all 0.2s ease-out; }
.toast-leave-active { transition: all 0.15s ease-in; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
</style>
