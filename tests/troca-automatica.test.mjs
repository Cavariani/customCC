/**
 * Troca automatica de conta ao bater o limite.
 *
 * A escolha da proxima conta e o cerebro da funcionalidade: escolher errado
 * significa pular para uma conta que tambem esta bloqueada, ou para uma sem
 * token, e o Pedro fica parado do mesmo jeito — so que agora sem entender
 * por que. Por isso o seletor e testado direto, e nao so pela rota.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { derrubaServidor, get, limpa, pastaTemporaria, post, repo, sobeServidor } from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

/** Token que passa pelo inspectToken: prefixo certo e 80+ caracteres. */
const TOKEN = 'sk-ant-oat' + 'x'.repeat(90)

function montaHome({ contas, env = true }) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')
  const dir = join(base, '.claude-multi-account')
  mkdirSync(dir, { recursive: true })

  if (env) {
    writeFileSync(
      join(dir, '.env'),
      [1, 2, 3]
        .map((n) => `CLAUDE_TOKEN_${n}=${TOKEN}\nACCOUNT_${n}_LABEL=conta${n}\n`)
        .join('\n'),
      'utf8',
    )
  }

  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({ activeAccountId: 1, accounts: contas, periods: [], transcripts: {} }),
    'utf8',
  )
  return { base, projeto }
}

/** Importa o modulo com o HOME ja apontado para a pasta de teste. */
async function comAccounts(home) {
  process.env.HOME = home
  process.env.USERPROFILE = home
  // Chave na URL para escapar do cache de modulos: cada caso precisa reler
  // o STATE_DIR, que e calculado uma vez na carga do modulo.
  const mod = await import(`../server/accounts.ts?home=${encodeURIComponent(home)}`)
  return mod
}

const HOME_ORIGINAL = process.env.HOME
after(() => {
  process.env.HOME = HOME_ORIGINAL
})

describe('escolha da proxima conta', () => {
  it('pula a conta que caiu e prefere a de janela ainda fechada', async () => {
    const agora = Date.now()
    const { base } = montaHome({
      contas: {
        1: { windowStartedAt: agora - 1000, rateLimitedAt: agora, observedResetAt: null, evidence: null },
        2: { windowStartedAt: agora - 1000, rateLimitedAt: null, observedResetAt: null, evidence: null },
        3: { windowStartedAt: null, rateLimitedAt: null, observedResetAt: null, evidence: null },
      },
    })
    const { proximaContaDisponivel } = await comAccounts(base)
    assert.equal(await proximaContaDisponivel(1), 3)
  })

  it('nunca escolhe conta que tambem esta limitada', async () => {
    const agora = Date.now()
    const { base } = montaHome({
      contas: {
        1: { windowStartedAt: agora, rateLimitedAt: agora, observedResetAt: null, evidence: null },
        2: {
          windowStartedAt: agora,
          rateLimitedAt: agora,
          observedResetAt: agora + 3600_000,
          evidence: null,
        },
        3: { windowStartedAt: null, rateLimitedAt: null, observedResetAt: null, evidence: null },
      },
    })
    const { proximaContaDisponivel } = await comAccounts(base)
    assert.equal(await proximaContaDisponivel(1), 3)
  })

  it('sem token valido em nenhuma outra, devolve null', async () => {
    const { base } = montaHome({ contas: {}, env: false })
    const { proximaContaDisponivel } = await comAccounts(base)
    assert.equal(await proximaContaDisponivel(1), null)
  })

  it('todas as outras limitadas, devolve null em vez de escolher uma ruim', async () => {
    const agora = Date.now()
    const futuro = agora + 3600_000
    const { base } = montaHome({
      contas: {
        1: { windowStartedAt: agora, rateLimitedAt: agora, observedResetAt: null, evidence: null },
        2: { windowStartedAt: agora, rateLimitedAt: agora, observedResetAt: futuro, evidence: null },
        3: { windowStartedAt: agora, rateLimitedAt: agora, observedResetAt: futuro, evidence: null },
      },
    })
    const { proximaContaDisponivel } = await comAccounts(base)
    assert.equal(await proximaContaDisponivel(1), null)
  })
})

describe('interruptor da troca automatica', () => {
  it('vem ligado por padrao e sobrevive ao desligar e ligar', async () => {
    const { base, projeto } = montaHome({ contas: {} })
    const servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      assert.equal((await get('/api/auto-switch')).json.enabled, true)

      assert.equal((await post('/api/auto-switch', { enabled: false })).json.enabled, false)
      assert.equal((await get('/api/auto-switch')).json.enabled, false)

      assert.equal((await post('/api/auto-switch', { enabled: true })).json.enabled, true)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('recusa valor que nao seja booleano', async () => {
    const { base, projeto } = montaHome({ contas: {} })
    const servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      for (const enabled of ['sim', 1, null, {}]) {
        const r = await post('/api/auto-switch', { enabled })
        assert.equal(r.status, 400, `aceitou ${JSON.stringify(enabled)}`)
      }
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('desligado no state.json continua desligado depois de reiniciar', async () => {
    const { base, projeto } = montaHome({ contas: {} })
    let servidor = await sobeServidor({ cwd: projeto, home: base })
    await post('/api/auto-switch', { enabled: false })
    await derrubaServidor(servidor)

    servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      assert.equal((await get('/api/auto-switch')).json.enabled, false)
    } finally {
      await derrubaServidor(servidor)
    }
  })
})
