import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nomeCurtoDoModelo } from './accounts.js'
import { CLAUDE_HOME } from './transcript.js'

const PROJECTS_DIR = join(CLAUDE_HOME, 'projects')

export interface ModeloDaSessao {
  nome: string
  tokens: number
  custoUSD: number
}

export interface ResumoDeSessao {
  sessionId: string
  /** Titulo que o proprio Claude Code gerou, quando existe. */
  titulo: string | null
  /** Ultimo trecho do cwd: o nome que a pessoa reconhece. */
  projeto: string
  cwd: string
  iniciadaEm: number
  atualizadaEm: number
  /** Duracao medida pelo proprio Claude Code, nao a diferenca de carimbos. */
  duracaoMs: number
  /**
   * Custo equivalente em dolar, como o Claude Code registra. No plano Pro
   * nada disso e cobrado: serve para comparar o peso de uma sessao com o de
   * outra, e nao como fatura.
   */
  custoUSD: number
  entrada: number
  saida: number
  cache: number
  tokens: number
  linhasAdicionadas: number
  linhasRemovidas: number
  mensagens: number
  modelos: ModeloDaSessao[]
}

interface CacheEntry {
  mtime: number
  resumo: ResumoDeSessao | null
}

/** Reler 40 transcripts a cada abertura do painel custa caro sem motivo. */
const cache = new Map<string, CacheEntry>()

function nomeDoProjeto(cwd: string): string {
  if (!cwd) return 'desconhecido'
  const partes = cwd.replace(/[/\\]+$/, '').split(/[/\\]/)
  return partes[partes.length - 1] || cwd
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Le um transcript inteiro e resume a sessao.
 *
 * As duas linhas que interessam e que ninguem lia ate agora sao a
 * `cost-state`, com custo, duracao e uso por modelo, e a `ai-title`, com o
 * titulo legivel. A soma de tokens continua vindo das mensagens, porque a
 * cost-state so aparece depois da primeira resposta e nem toda sessao a tem.
 */
async function resumir(file: string, sessionId: string): Promise<ResumoDeSessao | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }

  const r: ResumoDeSessao = {
    sessionId,
    titulo: null,
    projeto: 'desconhecido',
    cwd: '',
    iniciadaEm: 0,
    atualizadaEm: 0,
    duracaoMs: 0,
    custoUSD: 0,
    entrada: 0,
    saida: 0,
    cache: 0,
    tokens: 0,
    linhasAdicionadas: 0,
    linhasRemovidas: 0,
    mensagens: 0,
    modelos: [],
  }

  const porModelo = new Map<string, { tokens: number; custoUSD: number }>()

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line)
    } catch {
      // Linha parcial: o Claude Code ainda estava escrevendo.
      continue
    }

    const ts = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : 0
    if (ts) {
      if (!r.iniciadaEm) r.iniciadaEm = ts
      r.atualizadaEm = Math.max(r.atualizadaEm, ts)
    }
    if (typeof e.cwd === 'string' && !r.cwd) r.cwd = e.cwd

    if (e.type === 'ai-title' && typeof e.aiTitle === 'string') {
      r.titulo = e.aiTitle
      continue
    }

    if (e.type === 'cost-state') {
      // A ultima cost-state da sessao e a boa: elas se acumulam ao longo do
      // arquivo, e somar todas contaria o mesmo gasto varias vezes.
      r.custoUSD = numero(e.totalCostUSD)
      r.duracaoMs = numero(e.totalDuration)
      r.linhasAdicionadas = numero(e.totalLinesAdded)
      r.linhasRemovidas = numero(e.totalLinesRemoved)

      const uso = e.modelUsage
      if (ehObjeto(uso)) {
        porModelo.clear()
        for (const [id, bruto] of Object.entries(uso)) {
          if (!ehObjeto(bruto)) continue
          const nome = nomeCurtoDoModelo(id)
          const anterior = porModelo.get(nome) ?? { tokens: 0, custoUSD: 0 }
          porModelo.set(nome, {
            tokens:
              anterior.tokens +
              numero(bruto.inputTokens) +
              numero(bruto.outputTokens) +
              numero(bruto.cacheReadInputTokens) +
              numero(bruto.cacheCreationInputTokens),
            custoUSD: anterior.custoUSD + numero(bruto.costUSD),
          })
        }
      }
      continue
    }

    if (e.type !== 'assistant') continue
    const message = e.message
    if (!ehObjeto(message)) continue
    const usage = message.usage
    if (!ehObjeto(usage)) continue

    r.mensagens += 1
    r.entrada += numero(usage.input_tokens)
    r.saida += numero(usage.output_tokens)
    r.cache += numero(usage.cache_read_input_tokens) + numero(usage.cache_creation_input_tokens)
  }

  r.tokens = r.entrada + r.saida + r.cache
  r.projeto = nomeDoProjeto(r.cwd)
  r.modelos = [...porModelo.entries()]
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.custoUSD - a.custoUSD || b.tokens - a.tokens)

  // Sessao sem nenhuma resposta nao e historico, e lixo de um `claude` que
  // abriu e fechou. Mostrar isso enche a lista de linhas vazias.
  if (r.mensagens === 0 && r.custoUSD === 0) return null
  return r
}

export interface Historico {
  sessoes: ResumoDeSessao[]
  totais: {
    sessoes: number
    custoUSD: number
    duracaoMs: number
    tokens: number
    entrada: number
    saida: number
    linhasAdicionadas: number
    linhasRemovidas: number
  }
  /** Custo e tokens somados por projeto, do maior para o menor. */
  projetos: { nome: string; custoUSD: number; tokens: number; sessoes: number }[]
}

/**
 * Historico de sessoes de todos os projetos, da mais recente para a mais
 * antiga. `dias` corta pelo ultimo uso: o diretorio acumula desde sempre.
 */
export async function lerHistorico(dias = 30, limite = 200): Promise<Historico> {
  let pastas: string[]
  try {
    pastas = await readdir(PROJECTS_DIR)
  } catch {
    return { sessoes: [], totais: zerado(), projetos: [] }
  }

  const arquivos: { file: string; sessionId: string; mtime: number }[] = []
  for (const pasta of pastas) {
    let nomes: string[]
    try {
      nomes = await readdir(join(PROJECTS_DIR, pasta))
    } catch {
      continue
    }
    for (const nome of nomes) {
      if (!nome.endsWith('.jsonl')) continue
      const file = join(PROJECTS_DIR, pasta, nome)
      try {
        const info = await stat(file)
        arquivos.push({ file, sessionId: nome.replace(/\.jsonl$/, ''), mtime: info.mtimeMs })
      } catch {
        /* sumiu entre o readdir e o stat */
      }
    }
  }

  const corte = Date.now() - dias * 24 * 60 * 60 * 1000
  const recentes = arquivos
    .filter((a) => a.mtime >= corte)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limite)

  const sessoes: ResumoDeSessao[] = []
  for (const a of recentes) {
    const guardado = cache.get(a.file)
    if (guardado && guardado.mtime === a.mtime) {
      if (guardado.resumo) sessoes.push(guardado.resumo)
      continue
    }
    const resumo = await resumir(a.file, a.sessionId)
    cache.set(a.file, { mtime: a.mtime, resumo })
    if (resumo) sessoes.push(resumo)
  }

  sessoes.sort((a, b) => b.atualizadaEm - a.atualizadaEm)

  const totais = sessoes.reduce(
    (t, s) => ({
      sessoes: t.sessoes + 1,
      custoUSD: t.custoUSD + s.custoUSD,
      duracaoMs: t.duracaoMs + s.duracaoMs,
      tokens: t.tokens + s.tokens,
      entrada: t.entrada + s.entrada,
      saida: t.saida + s.saida,
      linhasAdicionadas: t.linhasAdicionadas + s.linhasAdicionadas,
      linhasRemovidas: t.linhasRemovidas + s.linhasRemovidas,
    }),
    zerado(),
  )

  const porProjeto = new Map<string, { custoUSD: number; tokens: number; sessoes: number }>()
  for (const s of sessoes) {
    const atual = porProjeto.get(s.projeto) ?? { custoUSD: 0, tokens: 0, sessoes: 0 }
    porProjeto.set(s.projeto, {
      custoUSD: atual.custoUSD + s.custoUSD,
      tokens: atual.tokens + s.tokens,
      sessoes: atual.sessoes + 1,
    })
  }

  const projetos = [...porProjeto.entries()]
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.custoUSD - a.custoUSD || b.tokens - a.tokens)

  return { sessoes, totais, projetos }
}

function zerado() {
  return {
    sessoes: 0,
    custoUSD: 0,
    duracaoMs: 0,
    tokens: 0,
    entrada: 0,
    saida: 0,
    linhasAdicionadas: 0,
    linhasRemovidas: 0,
  }
}
