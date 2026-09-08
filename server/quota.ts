import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const QUOTA_DIR = join(homedir(), '.claude-multi-account', 'quota')

export interface Limite {
  /** 0 a 100, como a propria API informa. */
  usadoPct: number
  /** Epoch em milissegundos. O arquivo traz segundos. */
  resetaEm: number | null
}

export interface QuotaDaSessao {
  sessionId: string
  /** Quando o statusline escreveu isto pela ultima vez. */
  lidaEm: number
  cincoHoras: Limite | null
  seteDias: Limite | null
  /** Contexto da conversa daquela sessao, de 0 a 100. */
  contextoPct: number | null
}

export interface Quota {
  /** A leitura mais recente entre todas as sessoes. */
  atual: QuotaDaSessao | null
  sessoes: QuotaDaSessao[]
  /** Falso quando o hook do statusline nunca escreveu nada. */
  disponivel: boolean
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Le um limite do formato do statusline.
 *
 * `resets_at` vem em segundos. Multiplicar sem conferir transformaria um
 * campo ausente em 1 de janeiro de 1970, que passaria por "ja resetou".
 */
function limite(v: unknown): Limite | null {
  if (!ehObjeto(v)) return null
  const pct = v.used_percentage
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null
  const seg = v.resets_at
  return {
    usadoPct: Math.max(0, Math.min(100, pct)),
    resetaEm: typeof seg === 'number' && Number.isFinite(seg) ? seg * 1000 : null,
  }
}

/**
 * Cota real, do jeito que o /usage mostra.
 *
 * O transcript so tem tokens, e token sem teto nao vira cota — foi por
 * isso que o painel passou tanto tempo mostrando "quanto" e nunca
 * "quanto falta". O numero com teto existe, mas so passa por um lugar: o
 * JSON que o Claude Code entrega ao comando de statusline. O hook em
 * ~/.claude/statusline-quota.sh guarda esse JSON, e aqui ele e lido.
 *
 * Consequencia de vir dali: o valor so se atualiza quando alguma sessao
 * desenha a barra de status. Sem sessao aberta, ele envelhece — por isso
 * `lidaEm` acompanha cada leitura.
 */
export async function lerQuota(): Promise<Quota> {
  let nomes: string[] = []
  try {
    nomes = await readdir(QUOTA_DIR)
  } catch {
    return { atual: null, sessoes: [], disponivel: false }
  }

  const sessoes: QuotaDaSessao[] = []
  for (const nome of nomes) {
    if (!nome.endsWith('.json') || nome.startsWith('.')) continue
    const arquivo = join(QUOTA_DIR, nome)
    let bruto: unknown
    let mtime = 0
    try {
      mtime = (await stat(arquivo)).mtimeMs
      bruto = JSON.parse(await readFile(arquivo, 'utf8'))
    } catch {
      // Arquivo pela metade ou sumido entre o readdir e a leitura.
      continue
    }
    if (!ehObjeto(bruto)) continue

    const limites = ehObjeto(bruto.rate_limits) ? bruto.rate_limits : {}
    const janela = ehObjeto(bruto.context_window) ? bruto.context_window : {}
    const ctx = janela.used_percentage

    sessoes.push({
      sessionId: nome.replace(/\.json$/, ''),
      lidaEm: mtime,
      cincoHoras: limite(limites.five_hour),
      seteDias: limite(limites.seven_day),
      contextoPct: typeof ctx === 'number' && Number.isFinite(ctx) ? ctx : null,
    })
  }

  sessoes.sort((a, b) => b.lidaEm - a.lidaEm)

  // A leitura boa e a mais recente que traz limite: uma sessao pode ter
  // escrito depois sem que a API tivesse informado a cota naquele momento.
  const atual = sessoes.find((s) => s.cincoHoras !== null || s.seteDias !== null) ?? null
  return { atual, sessoes, disponivel: sessoes.length > 0 }
}
