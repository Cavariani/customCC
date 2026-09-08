import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nomeCurtoDoModelo } from './accounts.js'
import { homedir } from 'node:os'
import { CLAUDE_HOME } from './transcript.js'

const PROJECTS_DIR = join(CLAUDE_HOME, 'projects')

/**
 * Para onde vai a conversa apagada.
 *
 * Mover, e nao remover: o transcript e o unico registro daquela conversa e
 * e o que o proprio `claude --resume` le. Apagar de verdade tornaria o
 * engano irreversivel, e a lista tem muita conversa de um clique so —
 * exatamente onde a mao escorrega.
 */
const LIXEIRA = join(homedir(), '.claude-multi-account', 'lixeira')

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

/**
 * Texto util de uma mensagem do usuario, para virar nome da conversa.
 *
 * Descarta os invólucros que o proprio Claude Code injeta — saida de
 * comando local, lembrete de sistema, resultado de ferramenta — porque
 * nenhum deles foi escrito por quem abriu a conversa.
 */
function textoDoPedido(message: unknown): string | null {
  let cru: string | null = null
  if (typeof message === 'string') cru = message
  else if (ehObjeto(message)) {
    const c = message.content
    if (typeof c === 'string') cru = c
    else if (Array.isArray(c)) {
      for (const bloco of c) {
        if (ehObjeto(bloco) && bloco.type === 'text' && typeof bloco.text === 'string') {
          cru = bloco.text
          break
        }
      }
    }
  }
  if (!cru) return null

  const limpo = cru.trim()
  if (!limpo || limpo.startsWith('<')) return null

  // Uma linha so, e curta: e rotulo de lista, nao resumo.
  const linha = limpo.split('\n').find((l) => l.trim().length > 0)?.trim()
  if (!linha) return null
  return linha.length > 64 ? `${linha.slice(0, 63)}…` : linha
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
  let primeiroPedido: string | null = null

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

    // Sem ai-title, o primeiro pedido serve de nome: conversa curta demais
    // para o Claude Code titular ainda tem um assunto, e "sem titulo"
    // repetido dez vezes na lista nao ajuda a achar nada.
    if (e.type === 'user' && primeiroPedido === null) {
      const texto = textoDoPedido(e.message)
      if (texto) primeiroPedido = texto
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

  if (r.titulo === null && primeiroPedido) r.titulo = primeiroPedido

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

export interface ProjetoComConversas {
  nome: string
  cwd: string
  conversas: ResumoDeSessao[]
  /** Ultimo uso do projeto: e por ele que a lista se ordena. */
  atualizadoEm: number
}

/**
 * As conversas agrupadas por projeto, como uma barra lateral de chat.
 *
 * O Claude Code ja guarda um diretorio por projeto em ~/.claude/projects,
 * entao o agrupamento existe no disco desde sempre — o que faltava era
 * alguem mostrar. Aqui o agrupamento sai do `cwd` gravado dentro do
 * transcript, e nao do nome do diretorio: o slug e lossy (todo caractere
 * nao alfanumerico vira hifen) e duas pastas diferentes podem colidir nele.
 */
export async function lerConversas(dias = 90, porProjeto = 40): Promise<ProjetoComConversas[]> {
  const { sessoes } = await lerHistorico(dias, 500)

  const mapa = new Map<string, ProjetoComConversas>()
  for (const s of sessoes) {
    // Sessao sem cwd nao pertence a projeto nenhum e nao tem onde ser
    // retomada; deixa-la de fora e melhor que criar um grupo fantasma.
    if (!s.cwd) continue
    const grupo = mapa.get(s.cwd) ?? {
      nome: s.projeto,
      cwd: s.cwd,
      conversas: [],
      atualizadoEm: 0,
    }
    grupo.conversas.push(s)
    grupo.atualizadoEm = Math.max(grupo.atualizadoEm, s.atualizadaEm)
    mapa.set(s.cwd, grupo)
  }

  return [...mapa.values()]
    .map((g) => ({ ...g, conversas: g.conversas.slice(0, porProjeto) }))
    .sort((a, b) => b.atualizadoEm - a.atualizadoEm)
}

/**
 * Ids de conversa que algum `claude` desta maquina esta usando agora.
 *
 * O painel sozinho nao basta: ele so conhece a sessao depois que a
 * descoberta liga o id a aba, e ate la apagaria o transcript de uma
 * conversa viva. Cada processo do Claude Code mantem o proprio arquivo em
 * ~/.claude/sessions com o id dentro, inclusive os abertos fora daqui.
 */
async function sessoesVivasNaMaquina(): Promise<string[]> {
  const dir = join(CLAUDE_HOME, 'sessions')
  let nomes: string[]
  try {
    nomes = await readdir(dir)
  } catch {
    return []
  }

  const ids: string[] = []
  for (const nome of nomes) {
    if (!nome.endsWith('.json')) continue
    try {
      const bruto = JSON.parse(await readFile(join(dir, nome), 'utf8'))
      if (ehObjeto(bruto) && typeof bruto.sessionId === 'string') ids.push(bruto.sessionId)
    } catch {
      /* arquivo pela metade ou de outro formato */
    }
  }
  return ids
}

/**
 * Tira uma conversa da lista, movendo o transcript para a lixeira.
 *
 * Recusa quando a conversa esta viva: o `claude` daquela aba ainda escreve
 * naquele arquivo, e puxa-lo debaixo dele deixaria a sessao gravando num
 * caminho que nao existe mais.
 */
export async function apagarConversa(
  sessionId: string,
  vivasDoPainel: (string | null)[],
): Promise<{ movidoPara: string }> {
  // `..` e `.` passam por um teste de caracteres permitidos e viram
  // travessia de diretorio ao entrar num join.
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    throw new Error('id de conversa invalido')
  }

  const vivas = new Set(
    [...vivasDoPainel, ...(await sessoesVivasNaMaquina())].filter((x): x is string => Boolean(x)),
  )
  if (vivas.has(sessionId)) throw new Error('esta conversa esta aberta numa aba agora')

  let pastas: string[]
  try {
    pastas = await readdir(PROJECTS_DIR)
  } catch {
    throw new Error('nao ha transcripts nesta maquina')
  }

  for (const pasta of pastas) {
    const origem = join(PROJECTS_DIR, pasta, `${sessionId}.jsonl`)
    try {
      await stat(origem)
    } catch {
      continue
    }

    await mkdir(LIXEIRA, { recursive: true })
    // O nome leva o projeto junto: na lixeira, so o id nao diz de onde veio.
    const destino = join(LIXEIRA, `${pasta}__${sessionId}.jsonl`)
    await rename(origem, destino)
    cache.delete(origem)
    return { movidoPara: destino }
  }

  throw new Error('conversa nao encontrada')
}

export interface NaLixeira {
  /** Nome do arquivo, que e como a UI se refere a ele. */
  arquivo: string
  sessionId: string
  projeto: string
  titulo: string | null
  atualizadaEm: number
  mensagens: number
  /** Quando foi para a lixeira. */
  apagadaEm: number
}

/**
 * Nome de arquivo da lixeira, validado.
 *
 * Ele tem a forma `<slug>__<sessionId>.jsonl` e vem da URL, entao qualquer
 * barra ou `..` aqui viraria travessia de diretorio no join seguinte.
 */
function parteDoNome(arquivo: string): { slug: string; sessionId: string } {
  if (!/^[A-Za-z0-9._-]+__[A-Za-z0-9._-]+\.jsonl$/.test(arquivo)) {
    throw new Error('nome de arquivo invalido')
  }
  if (arquivo.includes('..')) throw new Error('nome de arquivo invalido')
  const [slug, resto] = arquivo.split('__')
  return { slug, sessionId: resto.replace(/\.jsonl$/, '') }
}

/** O que esta na lixeira, da mais recente para a mais antiga. */
export async function lerLixeira(): Promise<NaLixeira[]> {
  let nomes: string[]
  try {
    nomes = await readdir(LIXEIRA)
  } catch {
    return []
  }

  const itens: NaLixeira[] = []
  for (const arquivo of nomes) {
    if (!arquivo.endsWith('.jsonl')) continue
    let slug: string
    let sessionId: string
    try {
      ;({ slug, sessionId } = parteDoNome(arquivo))
    } catch {
      // Arquivo que alguem pos ali na mao; nao e nosso para listar.
      continue
    }

    const caminho = join(LIXEIRA, arquivo)
    let apagadaEm = 0
    try {
      apagadaEm = (await stat(caminho)).mtimeMs
    } catch {
      continue
    }

    const resumo = await resumir(caminho, sessionId)
    itens.push({
      arquivo,
      sessionId,
      // O cwd de dentro do transcript e a fonte boa; o slug e so o resgate
      // para quando ele nao existir, e vem lossy.
      projeto: resumo?.projeto && resumo.projeto !== 'desconhecido' ? resumo.projeto : slug,
      titulo: resumo?.titulo ?? null,
      atualizadaEm: resumo?.atualizadaEm ?? 0,
      mensagens: resumo?.mensagens ?? 0,
      apagadaEm,
    })
  }

  return itens.sort((a, b) => b.apagadaEm - a.apagadaEm)
}

/** Devolve o transcript ao diretorio de projetos de onde ele saiu. */
export async function restaurarConversa(arquivo: string): Promise<void> {
  const { slug, sessionId } = parteDoNome(arquivo)
  const origem = join(LIXEIRA, arquivo)
  const pasta = join(PROJECTS_DIR, slug)
  const destino = join(pasta, `${sessionId}.jsonl`)

  try {
    await stat(destino)
    // Ja existe um arquivo com esse id: sobrescrever apagaria uma conversa
    // viva para trazer de volta uma morta.
    throw new Error('ja existe uma conversa com este id no projeto')
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') throw erro
  }

  await mkdir(pasta, { recursive: true })
  await rename(origem, destino)
  cache.delete(destino)
}

/** Remove de vez. Sem volta: e o unico registro daquela conversa. */
export async function esvaziarDaLixeira(arquivo: string): Promise<void> {
  const { slug } = parteDoNome(arquivo)
  void slug
  await rm(join(LIXEIRA, arquivo), { force: true })
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
