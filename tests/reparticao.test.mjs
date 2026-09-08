/**
 * De onde veio o gasto: por modelo e por projeto.
 *
 * Os dois dados ja existiam no transcript e eram descartados na agregacao.
 * Sem eles o painel respondia "22M" e nao respondia "22M de que", que e a
 * pergunta seguinte.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { derrubaServidor, get, limpa, pastaTemporaria, repo, sobeServidor } from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

const UMA_HORA = 60 * 60 * 1000

function linha({ quando, saida, model }) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(quando).toISOString(),
    message: {
      model,
      usage: {
        input_tokens: 0,
        output_tokens: saida,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  })
}

/** Varias sessoes, cada uma com o seu proprio cwd e as suas mensagens. */
async function comSessoes(sessoes) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')
  const transcripts = {}

  sessoes.forEach((s, i) => {
    const arquivo = join(base, `sessao-${i}.jsonl`)
    writeFileSync(arquivo, s.linhas.join('\n') + '\n', 'utf8')
    transcripts[`s${i}`] = { file: arquivo, cwd: s.cwd }
  })

  mkdirSync(join(base, '.claude-multi-account'), { recursive: true })
  writeFileSync(
    join(base, '.claude-multi-account', 'state.json'),
    JSON.stringify({
      activeAccountId: 1,
      accounts: {},
      periods: [{ accountId: 1, from: Date.now() - 2 * UMA_HORA, to: null }],
      transcripts,
    }),
    'utf8',
  )

  const servidor = await sobeServidor({ cwd: projeto, home: base })
  try {
    const { json } = await get('/api/accounts')
    return json.accounts.find((a) => a.id === 1)
  } finally {
    await derrubaServidor(servidor)
  }
}

const agora = Date.now()
const meiaHora = agora - 30 * 60 * 1000

describe('reparticao por modelo', () => {
  it('separa opus de sonnet e ordena pelo maior', async () => {
    const conta = await comSessoes([
      {
        cwd: '/tmp/projeto-a',
        linhas: [
          linha({ quando: meiaHora, saida: 1000, model: 'claude-opus-5' }),
          linha({ quando: meiaHora + 1000, saida: 300, model: 'claude-sonnet-5' }),
        ],
      },
    ])

    assert.deepEqual(
      conta.porModelo.map((f) => f.nome),
      ['opus 5', 'sonnet 5'],
      'esperava opus primeiro, por ter gasto mais',
    )
    assert.equal(conta.porModelo[0].tokens, 1000)
    assert.equal(conta.porModelo[1].tokens, 300)
  })

  it('mensagem sem modelo nao some da conta', async () => {
    const conta = await comSessoes([
      {
        cwd: '/tmp/projeto-a',
        linhas: [linha({ quando: meiaHora, saida: 500, model: null })],
      },
    ])
    assert.equal(conta.porModelo.length, 1)
    assert.equal(conta.porModelo[0].nome, 'desconhecido')
    assert.equal(conta.porModelo[0].tokens, 500)
  })

  it('a soma das fatias bate com o total da conta', async () => {
    const conta = await comSessoes([
      {
        cwd: '/tmp/projeto-a',
        linhas: [
          linha({ quando: meiaHora, saida: 700, model: 'claude-opus-5' }),
          linha({ quando: meiaHora + 500, saida: 250, model: 'claude-haiku-4-5' }),
        ],
      },
    ])
    const soma = conta.porModelo.reduce((t, f) => t + f.tokens, 0)
    assert.equal(soma, conta.tokensUsed)
  })
})

describe('reparticao por projeto', () => {
  it('agrupa por pasta e usa o nome final do caminho', async () => {
    const conta = await comSessoes([
      {
        cwd: '/tmp/trabalho/customCC',
        linhas: [linha({ quando: meiaHora, saida: 900, model: 'claude-opus-5' })],
      },
      {
        cwd: '/tmp/trabalho/videoMaker',
        linhas: [linha({ quando: meiaHora + 100, saida: 400, model: 'claude-opus-5' })],
      },
    ])

    assert.deepEqual(
      conta.porProjeto.map((f) => f.nome),
      ['customCC', 'videoMaker'],
    )
    assert.equal(conta.porProjeto[0].tokens, 900)
    assert.equal(conta.porProjeto[1].tokens, 400)
  })

  it('duas sessoes na mesma pasta somam numa fatia so', async () => {
    const conta = await comSessoes([
      {
        cwd: '/tmp/trabalho/customCC',
        linhas: [linha({ quando: meiaHora, saida: 100, model: 'claude-opus-5' })],
      },
      {
        cwd: '/tmp/trabalho/customCC',
        linhas: [linha({ quando: meiaHora + 50, saida: 200, model: 'claude-opus-5' })],
      },
    ])
    assert.equal(conta.porProjeto.length, 1)
    assert.equal(conta.porProjeto[0].tokens, 300)
  })

  it('a soma por projeto tambem bate com o total', async () => {
    const conta = await comSessoes([
      { cwd: '/tmp/a', linhas: [linha({ quando: meiaHora, saida: 111, model: 'claude-opus-5' })] },
      { cwd: '/tmp/b', linhas: [linha({ quando: meiaHora, saida: 222, model: 'claude-opus-5' })] },
    ])
    const soma = conta.porProjeto.reduce((t, f) => t + f.tokens, 0)
    assert.equal(soma, conta.tokensUsed)
  })
})
