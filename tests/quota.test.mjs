/**
 * O reset autoritativo vindo do transcript.
 *
 * Quando o Claude Code toma 429, ele grava `quotaLimits` na linha do
 * transcript, com `resetsAt` em epoch de segundos. Antes disso o painel so
 * tinha duas fontes ruins: estimar inicio da janela mais 5h, ou raspar o
 * horario do texto que a TUI desenha. Aqui verificamos que o valor do
 * arquivo ganha das duas.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { derrubaServidor, get, limpa, pastaTemporaria, repo, sobeServidor } from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

const UMA_HORA = 60 * 60 * 1000

/** Uma linha de transcript de assistente, com uso e opcionalmente quota. */
function linha({ quando, tokens = 1000, quota = null }) {
  const entrada = {
    type: 'assistant',
    timestamp: new Date(quando).toISOString(),
    cwd: '/tmp/projeto',
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 10,
        output_tokens: tokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }
  if (quota) entrada.quotaLimits = quota
  return JSON.stringify(entrada)
}

/**
 * Monta um HOME com um transcript falso ja registrado no state.json, para
 * nao depender de uma sessao real do claude.
 */
async function comTranscrito({ linhas, periodoDe }) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')

  const transcrito = join(base, 'sessao.jsonl')
  writeFileSync(transcrito, linhas.join('\n') + '\n', 'utf8')

  mkdirSync(join(base, '.claude-multi-account'), { recursive: true })
  writeFileSync(
    join(base, '.claude-multi-account', 'state.json'),
    JSON.stringify({
      activeAccountId: 1,
      accounts: {},
      periods: [{ accountId: 1, from: periodoDe, to: null }],
      transcripts: { sessao: { file: transcrito, cwd: projeto } },
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

describe('quotaLimits do transcript', () => {
  it('sem recusa, o reset e estimado', async () => {
    const agora = Date.now()
    const conta = await comTranscrito({
      periodoDe: agora - UMA_HORA,
      linhas: [linha({ quando: agora - 30 * 60 * 1000 })],
    })
    assert.equal(conta.resetSource, 'estimated')
    assert.equal(conta.rateLimited, false)
  })

  it('com recusa, o reset vem do arquivo e a conta fica limitada', async () => {
    const agora = Date.now()
    const reset = agora + 2 * UMA_HORA
    const conta = await comTranscrito({
      periodoDe: agora - UMA_HORA,
      linhas: [
        linha({ quando: agora - 30 * 60 * 1000 }),
        linha({
          quando: agora - 60 * 1000,
          quota: {
            status: 'rejected',
            resetsAt: Math.floor(reset / 1000),
            rateLimitType: 'five_hour',
          },
        }),
      ],
    })

    assert.equal(conta.rateLimited, true, 'a recusa devia marcar a conta')
    assert.equal(conta.resetSource, 'observed', 'o reset devia vir do arquivo')
    // O arquivo guarda segundos; o app trabalha em milissegundos.
    assert.ok(
      Math.abs(conta.resetAt - reset) < 1000,
      `resetAt ${conta.resetAt} longe do informado ${reset}`,
    )
    assert.match(conta.limitEvidence ?? '', /five_hour/)
  })

  it('recusa antiga, ja passada do reset, e ignorada', async () => {
    const agora = Date.now()
    const conta = await comTranscrito({
      periodoDe: agora - UMA_HORA,
      linhas: [
        linha({
          quando: agora - 3 * 24 * UMA_HORA,
          quota: {
            status: 'rejected',
            resetsAt: Math.floor((agora - 2 * 24 * UMA_HORA) / 1000),
            rateLimitType: 'five_hour',
          },
        }),
        linha({ quando: agora - 30 * 60 * 1000 }),
      ],
    })
    assert.equal(conta.rateLimited, false, 'recusa de tres dias atras nao limita agora')
  })

  it('resetsAt ausente nao vira 1970', async () => {
    const agora = Date.now()
    const conta = await comTranscrito({
      periodoDe: agora - UMA_HORA,
      linhas: [
        linha({ quando: agora - 30 * 60 * 1000 }),
        linha({
          quando: agora - 60 * 1000,
          quota: { status: 'rejected', rateLimitType: 'five_hour' },
        }),
      ],
    })
    // Sem resetsAt nao ha o que observar: cai na estimativa, e nunca num
    // horario no passado remoto que faria o app achar que a janela virou.
    assert.equal(conta.resetSource, 'estimated')
    assert.ok(conta.resetAt === null || conta.resetAt > agora)
  })
})
