<script setup lang="ts">
import { computed } from 'vue'
import { Check, Copy, FileText } from 'lucide-vue-next'
import { DOC_SECTIONS } from '../lib/docs'
import { parseMarkdown, renderInline } from '../lib/markdown'
import { useToast } from '../stores/toast'
import { ref } from 'vue'
import Button from '../components/ui/Button.vue'
import Card from '../components/ui/Card.vue'

const toast = useToast()
const copied = ref<string | null>(null)

const sections = computed(() => DOC_SECTIONS.map((s) => ({ ...s, blocks: parseMarkdown(s.md) })))

async function copiar(texto: string, id: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(texto)
    copied.value = id
    window.setTimeout(() => { if (copied.value === id) copied.value = null }, 2000)
    toast.success(rotulo, { description: 'Colado na área de transferência.' })
  } catch {
    toast.error('Não foi possível copiar', { description: 'Seu navegador bloqueou o acesso.' })
  }
}

const copiarTudo = () => copiar(DOC_SECTIONS.map((s) => `## ${s.title}\n\n${s.md}`).join('\n\n'), 'all', 'Documentação copiada')
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-sm text-zinc-400">Guia de integração em 5 minutos.</p>
      <Button variant="ghost" size="sm" @click="copiarTudo">
        <Copy v-if="copied !== 'all'" :size="14" /><Check v-else :size="14" /> Copiar tudo em .md
      </Button>
    </div>
    <div class="grid gap-4 lg:grid-cols-[1fr_180px]">
      <div class="min-w-0 space-y-4">
        <Card v-for="s in sections" :key="s.id" :id="s.id">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="text-base font-semibold text-white">{{ s.title }}</h2>
            <Button variant="ghost" size="sm" @click="copiar(s.md, s.id, 'Seção copiada')">
              <Copy v-if="copied !== s.id" :size="14" /><Check v-else :size="14" />
            </Button>
          </div>
          <div v-for="(b, i) in s.blocks" :key="i" class="mt-2 text-sm leading-relaxed text-zinc-300 first:mt-0">
            <h3 v-if="b.type === 'h3'" class="font-semibold text-white" v-html="renderInline(b.text ?? '')" />
            <p v-else-if="b.type === 'p'" v-html="renderInline(b.text ?? '')" />
            <ul v-else-if="b.type === 'list'" class="list-disc space-y-1 pl-5">
              <li v-for="(it, j) in b.items" :key="j" v-html="renderInline(it)" />
            </ul>
            <div v-else-if="b.type === 'code'" class="overflow-hidden rounded-lg bg-zinc-950">
              <div class="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-500">
                <span>{{ b.lang || 'código' }}</span>
                <button @click="copiar(b.text ?? '', s.id + i, 'Bloco copiado')" class="hover:text-zinc-200">
                  <Copy v-if="copied !== s.id + i" :size="14" /><Check v-else :size="14" />
                </button>
              </div>
              <pre class="overflow-x-auto px-3 pb-3 text-xs leading-relaxed text-zinc-200">{{ b.text }}</pre>
            </div>
            <table v-else-if="b.type === 'table'" class="w-full">
              <thead><tr class="text-left text-xs text-zinc-500">
                <th v-for="h in b.head" :key="h" class="border-b border-zinc-700 px-2 py-1.5">{{ h }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="(r, k) in b.rows" :key="k" class="border-t border-zinc-800">
                  <td v-for="(c, m) in r" :key="m" class="px-2 py-1.5" v-html="renderInline(c)" />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <aside class="hidden lg:block">
        <div class="sticky top-4 rounded-xl bg-zinc-900 p-4">
          <p class="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400"><FileText :size="14" /> Nesta página</p>
          <ul class="space-y-1.5 text-sm">
            <li v-for="s in sections" :key="s.id">
              <a :href="'#' + s.id" class="text-zinc-400 hover:text-white">{{ s.title }}</a>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>
