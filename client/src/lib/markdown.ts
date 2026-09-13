/** Renderizador mínimo de Markdown (suficiente p/ a doc) — sem dependência. */
export interface MdBlock {
  type: 'h2' | 'h3' | 'p' | 'code' | 'list' | 'table';
  text?: string;
  lang?: string;
  items?: string[];
  head?: string[];
  rows?: string[][];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-950 px-1.5 py-0.5 text-xs text-teal-300">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');
}

export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = md.split('\n');
  let i = 0;
  const peek = (): string | undefined => (i < lines.length ? lines[i] : undefined);
  const peekAt = (j: number): string | undefined => (j < lines.length ? lines[j] : undefined);
  while (i < lines.length) {
    const line = peek();
    if (line === undefined) break;
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      let cl: string | undefined;
      while ((cl = peek()) !== undefined && !cl.startsWith('```')) { code.push(cl); i++; }
      i++;
      blocks.push({ type: 'code', lang, text: code.join('\n') });
      continue;
    }
    if (line.startsWith('### ')) { blocks.push({ type: 'h3', text: line.slice(4) }); i++; continue; }
    if (line.startsWith('## ')) { blocks.push({ type: 'h2', text: line.slice(3) }); i++; continue; }
    if (/^\|.*\|$/.test(line.trim()) && /^\|[\s:\-|]+\|$/.test((peekAt(i + 1) ?? '').trim())) {
      const cells = (l: string) => l.trim().slice(1, -1).split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      let rl: string | undefined;
      while ((rl = peek()) !== undefined && /^\|.*\|$/.test(rl.trim())) { rows.push(cells(rl)); i++; }
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      let ll: string | undefined;
      while ((ll = peek()) !== undefined && ll.startsWith('- ')) { items.push(ll.slice(2)); i++; }
      blocks.push({ type: 'list', items });
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    let cur: string | undefined;
    while ((cur = peek()) !== undefined && cur.trim() !== '' && !cur.startsWith('#') && !cur.startsWith('```') && !cur.startsWith('- ') && !cur.startsWith('|')) {
      para.push(cur); i++;
    }
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

export function renderInline(s: string): string {
  return inline(s);
}
