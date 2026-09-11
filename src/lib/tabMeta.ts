/**
 * Identidade que o Pedro da para cada aba: nome, cor e posicao.
 *
 * Mora no navegador, e nao no servidor, porque nao descreve o processo e
 * sim como ele aparece na barra. A sessao do pty sobrevive ao reload, entao
 * o id da aba e estavel e serve de chave.
 *
 * Historico: os nomes ja moravam sozinhos em `customcc-tab-titles`. A
 * leitura continua olhando aquela chave para nao renomear tudo de volta
 * para "terminal 1" na primeira vez que este modulo rodar.
 */

const CHAVE = 'customcc-tab-meta'
const CHAVE_ANTIGA = 'customcc-tab-titles'

export interface MetaDeAba {
  titulo?: string
  cor?: CorDeAba
}

export interface MetaGuardada {
  abas: Record<string, MetaDeAba>
  /** Ordem escolhida arrastando. Ids que sumiram sao ignorados na leitura. */
  ordem: string[]
}

/**
 * As cores saem dos tokens do tema, nunca de hex solto: trocar de tema
 * precisa repintar as abas junto. Cor aqui e organizacao, e nao estado — por
 * isso sao seis matizes diferentes, e nao uma escala de gravidade.
 */
export const CORES_DE_ABA = {
  vermelho: 'var(--red)',
  ambar: 'var(--warn)',
  verde: 'var(--green)',
  azul: 'var(--blue)',
  violeta: 'var(--violet)',
  ciano: 'var(--hl-function)',
} as const

export type CorDeAba = keyof typeof CORES_DE_ABA

export function corValida(valor: unknown): valor is CorDeAba {
  return typeof valor === 'string' && valor in CORES_DE_ABA
}

export function lerMeta(): MetaGuardada {
  let base: MetaGuardada = { abas: {}, ordem: [] }
  try {
    const cru = JSON.parse(localStorage.getItem(CHAVE) ?? 'null')
    if (cru && typeof cru === 'object') {
      base = {
        abas: cru.abas && typeof cru.abas === 'object' ? cru.abas : {},
        ordem: Array.isArray(cru.ordem) ? cru.ordem.filter((id: unknown) => typeof id === 'string') : [],
      }
    }
  } catch {
    /* storage corrompido volta ao padrao em vez de derrubar a barra */
  }

  try {
    // Nomes da versao anterior entram so onde ainda nao ha nome novo.
    const antigos = JSON.parse(localStorage.getItem(CHAVE_ANTIGA) ?? '{}')
    for (const [id, titulo] of Object.entries(antigos)) {
      if (typeof titulo === 'string' && !base.abas[id]?.titulo) {
        base.abas[id] = { ...base.abas[id], titulo }
      }
    }
  } catch {
    /* idem */
  }

  return base
}

function gravar(meta: MetaGuardada): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(meta))
  } catch {
    /* storage indisponivel nao pode quebrar renomear nem colorir */
  }
}

export function gravarCampo(id: string, campo: MetaDeAba): void {
  const meta = lerMeta()
  const atual = { ...meta.abas[id], ...campo }
  // Campo apagado sai do objeto: guardar `cor: undefined` viraria `null` no
  // JSON e a leitura seguinte trataria como cor invalida.
  for (const chave of Object.keys(atual) as (keyof MetaDeAba)[]) {
    if (atual[chave] === undefined) delete atual[chave]
  }
  meta.abas[id] = atual
  gravar(meta)
}

export function gravarOrdem(ids: string[]): void {
  const meta = lerMeta()
  meta.ordem = ids
  gravar(meta)
}

/**
 * Poe a lista na ordem guardada. Aba que o guardado nao conhece vai para o
 * fim, na ordem em que chegou: uma aba nova nunca some no meio da barra.
 */
export function aplicarOrdem<T extends { id: string }>(abas: T[], ordem: string[]): T[] {
  if (ordem.length === 0) return abas
  const peso = new Map(ordem.map((id, i) => [id, i]))
  return [...abas].sort((a, b) => (peso.get(a.id) ?? Infinity) - (peso.get(b.id) ?? Infinity))
}
