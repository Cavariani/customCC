/**
 * Historico de sessoes.
 *
 * O dado vem da linha `cost-state`, que o Claude Code reescreve a cada
 * resposta com o acumulado da sessao. A armadilha e somar todas elas: o
 * gasto sairia multiplicado pelo numero de respostas.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { derrubaServidor, get, limpa, pastaTemporaria, repo, sobeServidor } from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

const AGORA = Date.now()
const HORA = 60 * 60 * 1000

function assistant(quando, saida, model = 'claude-opus-5') {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(quando).toISOString(),
    cwd: '/tmp/projeto',
    message: {
      model,
      usage: {
        input_tokens: 10,
        output_tokens: saida,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 0,
      },
    },
  })
}

function custo({ total, duracao, add = 0, modelos = {} }) {
  return JSON.stringify({
    type: 'cost-state',
    totalCostUSD: total,
    totalDuration: duracao,
    totalLinesAdded: add,
    totalLinesRemoved: 0,
    modelUsage: modelos,
  })
}

const titulo = (t) => JSON.stringify({ type: 'ai-title', aiTitle: t })

/** Monta um HOME com transcripts prontos e devolve /api/history. */
async function comSessoes(sessoes) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')

  const dir = join(base, '.claude', 'projects', '-tmp-projeto')
  mkdirSync(dir, { recursive: true })
  sessoes.forEach((linhas, i) => {
    writeFileSync(join(dir, `sessao-${i}.jsonl`), linhas.join('\n') + '\n', 'utf8')
  })

  const servidor = await sobeServidor({ cwd: projeto, home: base })
  try {
    const { json } = await get('/api/history?dias=30')
    return json
  } finally {
    await derrubaServidor(servidor)
  }
}

describe('leitura do custo', () => {
  it('usa a ultima cost-state, e nao a soma de todas', async () => {
    // Tres cost-state acumulando: 1, 3 e 7. Somar daria 11.
    const d = await comSessoes([
      [
        assistant(AGORA - HORA, 100),
        custo({ total: 1, duracao: 60_000 }),
        assistant(AGORA - HORA + 1000, 100),
        custo({ total: 3, duracao: 120_000 }),
        assistant(AGORA - HORA + 2000, 100),
        custo({ total: 7, duracao: 180_000 }),
      ],
    ])
    assert.equal(d.sessoes.length, 1)
    assert.equal(d.sessoes[0].custoUSD, 7, 'somou as cost-state em vez de usar a ultima')
    assert.equal(d.totais.custoUSD, 7)
  })

  it('duracao e linhas vem da ultima cost-state', async () => {
    const d = await comSessoes([
      [assistant(AGORA - HORA, 50), custo({ total: 2, duracao: 300_000, add: 42 })],
    ])
    assert.equal(d.sessoes[0].duracaoMs, 300_000)
    assert.equal(d.sessoes[0].linhasAdicionadas, 42)
  })

  it('sessao sem cost-state ainda conta os tokens', async () => {
    const d = await comSessoes([[assistant(AGORA - HORA, 500)]])
    assert.equal(d.sessoes.length, 1)
    assert.equal(d.sessoes[0].custoUSD, 0)
    assert.equal(d.sessoes[0].saida, 500)
    assert.equal(d.sessoes[0].mensagens, 1)
  })
})

describe('o que nao entra na lista', () => {
  it('sessao sem resposta nenhuma e descartada', async () => {
    const d = await comSessoes([
      [JSON.stringify({ type: 'user', timestamp: new Date(AGORA).toISOString() })],
      [assistant(AGORA - HORA, 10)],
    ])
    assert.equal(d.sessoes.length, 1, 'a sessao vazia nao devia aparecer')
  })

  it('linha corrompida no meio nao derruba a leitura', async () => {
    const d = await comSessoes([
      [assistant(AGORA - HORA, 10), '{isto nao e json', custo({ total: 5, duracao: 1000 })],
    ])
    assert.equal(d.sessoes.length, 1)
    assert.equal(d.sessoes[0].custoUSD, 5)
  })
})

describe('titulo e agrupamento', () => {
  it('pega o titulo gerado pelo proprio Claude Code', async () => {
    const d = await comSessoes([[titulo('Arrumar o painel'), assistant(AGORA - HORA, 10)]])
    assert.equal(d.sessoes[0].titulo, 'Arrumar o painel')
  })

  it('sem titulo devolve null, e nao o id cru', async () => {
    const d = await comSessoes([[assistant(AGORA - HORA, 10)]])
    assert.equal(d.sessoes[0].titulo, null)
  })

  it('soma por projeto e ordena pelo maior custo', async () => {
    const d = await comSessoes([
      [assistant(AGORA - HORA, 10), custo({ total: 3, duracao: 1000 })],
      [assistant(AGORA - 2 * HORA, 10), custo({ total: 9, duracao: 1000 })],
    ])
    assert.equal(d.projetos.length, 1, 'os dois transcripts usam o mesmo cwd')
    assert.equal(d.projetos[0].nome, 'projeto')
    assert.equal(d.projetos[0].custoUSD, 12)
    assert.equal(d.projetos[0].sessoes, 2)
  })

  it('as sessoes vem da mais recente para a mais antiga', async () => {
    const d = await comSessoes([
      [titulo('velha'), assistant(AGORA - 5 * HORA, 10)],
      [titulo('nova'), assistant(AGORA - HORA, 10)],
    ])
    assert.deepEqual(
      d.sessoes.map((s) => s.titulo),
      ['nova', 'velha'],
    )
  })

  it('o custo por modelo e agrupado pela familia', async () => {
    const d = await comSessoes([
      [
        assistant(AGORA - HORA, 10),
        custo({
          total: 5,
          duracao: 1000,
          modelos: {
            'claude-opus-5[1m]': { inputTokens: 10, outputTokens: 5, costUSD: 4 },
            'claude-haiku-4-5-20251001': { inputTokens: 2, outputTokens: 1, costUSD: 1 },
          },
        }),
      ],
    ])
    const nomes = d.sessoes[0].modelos.map((m) => m.nome)
    assert.deepEqual(nomes, ['opus 5', 'haiku 4.5'], `veio ${nomes.join(', ')}`)
    assert.equal(d.sessoes[0].modelos[0].custoUSD, 4)
  })
})

describe('recorte por periodo', () => {
  it('dias invalido cai no padrao em vez de estourar', async () => {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      for (const q of ['abc', '-5', '0', '99999']) {
        const r = await get(`/api/history?dias=${q}`)
        assert.equal(r.status, 200, `dias=${q} devolveu ${r.status}`)
      }
    } finally {
      await derrubaServidor(servidor)
    }
  })
})
