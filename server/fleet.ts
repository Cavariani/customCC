import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_HOME } from './transcript.js'

const SESSIONS_DIR = join(CLAUDE_HOME, 'sessions')
const JOBS_DIR = join(CLAUDE_HOME, 'jobs')

/**
 * So dois estados, e nao tres.
 *
 * Cheguei a inferir um terceiro, "sem responder", comparando o carimbo do
 * arquivo com o relogio. Medindo, o carimbo nao e batimento: ele so muda
 * quando o estado muda. Uma sessao ocupada ha quatro minutos carrega um
 * carimbo de quatro minutos atras e caia como travada — inclusive a
 * propria sessao que abriu o painel. Sem batimento nao da para separar
 * "ocupada trabalhando" de "ocupada presa", entao o painel mostra ha
 * quanto tempo ela esta assim e deixa a leitura para quem olha.
 */
export type EstadoDaSessao = 'busy' | 'idle'

export interface SessaoViva {
  pid: number
  sessionId: string
  /** Nome derivado pelo proprio Claude Code, do tipo "customcc-a2". */
  nome: string
  /** Ultimo trecho do cwd: o nome que a pessoa reconhece. */
  projeto: string
  cwd: string
  kind: string
  versao: string
  estado: EstadoDaSessao
  iniciadaEm: number
  /** Ha quanto tempo entrou neste estado. Ocupada ha muito tempo pode ser
      trabalho longo ou processo preso: o painel nao adivinha qual. */
  desdeMs: number
  /** Esta e a sessao que o proprio painel esta observando. */
  ehEstaAba: boolean
}

export interface TarefaDeFundo {
  id: string
  nome: string
  projeto: string
  estado: string
  criadaEm: number
  atualizadaEm: number
}

export interface Frota {
  sessoes: SessaoViva[]
  tarefas: TarefaDeFundo[]
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nomeDoProjeto(cwd: string): string {
  if (!cwd) return 'desconhecido'
  const partes = cwd.replace(/[/\\]+$/, '').split(/[/\\]/)
  return partes[partes.length - 1] || cwd
}

/**
 * O processo ainda existe?
 *
 * O arquivo de sessao nao e apagado quando o `claude` morre de forma
 * abrupta, entao sem esta checagem a frota mostraria sessoes fantasma
 * eternamente ocupadas. Sinal 0 nao envia nada: so pergunta se da para
 * enviar.
 */
function vivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (erro) {
    // EPERM quer dizer que o processo existe e e de outro dono, o que ainda
    // conta como vivo; ESRCH quer dizer que nao existe mais.
    return (erro as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function lerFrota(sessaoAtual?: string): Promise<Frota> {
  const sessoes: SessaoViva[] = []
  const agora = Date.now()

  let nomes: string[] = []
  try {
    nomes = await readdir(SESSIONS_DIR)
  } catch {
    /* pasta so existe depois do primeiro `claude` */
  }

  for (const nome of nomes) {
    if (!nome.endsWith('.json')) continue
    let bruto: unknown
    try {
      bruto = JSON.parse(await readFile(join(SESSIONS_DIR, nome), 'utf8'))
    } catch {
      continue
    }
    if (!ehObjeto(bruto)) continue

    const pid = typeof bruto.pid === 'number' ? bruto.pid : 0
    if (!vivo(pid)) continue

    const status = typeof bruto.status === 'string' ? bruto.status : 'idle'
    const carimbo =
      typeof bruto.statusUpdatedAt === 'number'
        ? bruto.statusUpdatedAt
        : typeof bruto.updatedAt === 'number'
          ? bruto.updatedAt
          : 0

    const estado: EstadoDaSessao = status === 'busy' ? 'busy' : 'idle'

    const cwd = typeof bruto.cwd === 'string' ? bruto.cwd : ''
    const sessionId = typeof bruto.sessionId === 'string' ? bruto.sessionId : ''

    sessoes.push({
      pid,
      sessionId,
      nome: typeof bruto.name === 'string' ? bruto.name : `pid ${pid}`,
      projeto: nomeDoProjeto(cwd),
      cwd,
      kind: typeof bruto.kind === 'string' ? bruto.kind : 'interactive',
      versao: typeof bruto.version === 'string' ? bruto.version : '',
      estado,
      iniciadaEm: typeof bruto.startedAt === 'number' ? bruto.startedAt : 0,
      desdeMs: carimbo > 0 ? agora - carimbo : 0,
      ehEstaAba: Boolean(sessaoAtual) && sessionId === sessaoAtual,
    })
  }

  // Ocupadas primeiro: sao as que estao fazendo alguma coisa agora.
  const ordem: Record<EstadoDaSessao, number> = { busy: 0, idle: 1 }
  sessoes.sort((a, b) => ordem[a.estado] - ordem[b.estado] || a.nome.localeCompare(b.nome))

  return { sessoes, tarefas: await lerTarefas() }
}

async function lerTarefas(): Promise<TarefaDeFundo[]> {
  let pastas: string[] = []
  try {
    pastas = await readdir(JOBS_DIR)
  } catch {
    return []
  }

  const tarefas: TarefaDeFundo[] = []
  for (const pasta of pastas) {
    const arquivo = join(JOBS_DIR, pasta, 'state.json')
    let bruto: unknown
    try {
      await stat(arquivo)
      bruto = JSON.parse(await readFile(arquivo, 'utf8'))
    } catch {
      continue
    }
    if (!ehObjeto(bruto)) continue

    const cwd = typeof bruto.cwd === 'string' ? bruto.cwd : ''
    tarefas.push({
      id: pasta,
      // De proposito so o `name`, e nunca o `intent`: o intent guarda o
      // texto cru que iniciou a tarefa, e ja apareceu ali uma string de
      // conexao com senha. Nao e coisa para desenhar na tela.
      nome: typeof bruto.name === 'string' ? bruto.name : pasta,
      projeto: nomeDoProjeto(cwd),
      estado: typeof bruto.state === 'string' ? bruto.state : 'desconhecido',
      criadaEm: typeof bruto.createdAt === 'string' ? Date.parse(bruto.createdAt) : 0,
      atualizadaEm: typeof bruto.updatedAt === 'string' ? Date.parse(bruto.updatedAt) : 0,
    })
  }

  tarefas.sort((a, b) => b.atualizadaEm - a.atualizadaEm)
  return tarefas
}
