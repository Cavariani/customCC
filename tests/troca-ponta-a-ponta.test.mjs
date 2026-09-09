/**
 * Troca automatica de ponta a ponta.
 *
 * O caminho real e: o binario escreve a frase de limite no pty, o watcher
 * reconhece, o evento dispara e o servidor assume outra conta. Testar so a
 * escolha da conta deixaria de fora justamente as juntas.
 *
 * O truque para rodar isso sem tomar um 429 de verdade: `CUSTOMCC_CLAUDE_BIN`
 * aceita qualquer executavel, entao entra um script que imprime a frase que
 * o Claude Code imprimiria e fica vivo.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import {
  BASE,
  PORTA,
  claudeFalso,
  derrubaServidor,
  get,
  limpa,
  pastaTemporaria,
  post,
  repo,
  sobeServidor,
} from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

const TOKEN = 'sk-ant-oat' + 'y'.repeat(90)

function montaHome() {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')
  const dir = join(base, '.claude-multi-account')
  mkdirSync(dir, { recursive: true })

  writeFileSync(
    join(dir, '.env'),
    [1, 2, 3].map((n) => `CLAUDE_TOKEN_${n}=${TOKEN}\nACCOUNT_${n}_LABEL=conta${n}\n`).join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({ activeAccountId: 1, accounts: {}, periods: [], transcripts: {} }),
    'utf8',
  )

  // Falso `claude`: anuncia o limite e fica vivo, como a TUI ficaria.
  const binario = claudeFalso(base, {
    versao: '9.9.9 (Claude Code falso)',
    eco: 'Usage limit reached. Your limit resets at 11pm',
    segundos: 60,
  })

  return { base, projeto, binario }
}

/** Abre uma aba, que e o que faz o servidor subir o processo e vigia-lo. */
function abreAba(projeto, id = 'aba-de-teste') {
  const url = `ws://127.0.0.1:${PORTA}/pty?session=${id}&cwd=${encodeURIComponent(projeto)}&cols=100&rows=30`
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

/** Espera ate a condicao valer, em vez de dormir um tempo fixo. */
async function ate(condicao, limiteMs = 25_000) {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    const valor = await condicao()
    if (valor) return valor
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

const ativa = async () => (await get('/api/accounts')).json?.activeId

describe('limite no terminal dispara a troca', () => {
  it('com o interruptor ligado, o servidor assume outra conta sozinho', async () => {
    const { base, projeto, binario } = montaHome()
    const servidor = await sobeServidor({
      cwd: projeto,
      home: base,
      env: { CUSTOMCC_CLAUDE_BIN: binario },
    })
    let ws
    try {
      assert.equal(await ativa(), 1, 'deveria comecar na conta 1')
      ws = await abreAba(projeto)

      const trocou = await ate(async () => {
        const id = await ativa()
        return id && id !== 1 ? id : null
      })

      assert.ok(trocou, `a conta ativa continuou 1; log do servidor:\n${servidor.log()}`)
      assert.notEqual(trocou, 1)

      const { json } = await get('/api/accounts')
      const conta1 = json.accounts.find((c) => c.id === 1)
      assert.equal(conta1.rateLimited, true, 'a conta que caiu deveria ficar marcada')
    } finally {
      ws?.close()
      await derrubaServidor(servidor)
    }
  })

  it('com o interruptor desligado, a conta ativa nao muda', async () => {
    const { base, projeto, binario } = montaHome()
    const servidor = await sobeServidor({
      cwd: projeto,
      home: base,
      env: { CUSTOMCC_CLAUDE_BIN: binario },
    })
    let ws
    try {
      await post('/api/auto-switch', { enabled: false })
      assert.equal((await get('/api/auto-switch')).json.enabled, false)

      ws = await abreAba(projeto, 'aba-sem-troca')

      // Espera a conta ficar marcada como no limite: prova que o detector
      // rodou, entao a ausencia de troca e decisao, e nao atraso.
      const marcou = await ate(async () => {
        const { json } = await get('/api/accounts')
        return json?.accounts?.find((c) => c.id === 1)?.rateLimited || null
      })
      assert.ok(marcou, `o limite nao chegou a ser detectado:\n${servidor.log()}`)

      assert.equal(await ativa(), 1, 'com o interruptor desligado, nao pode trocar')
    } finally {
      ws?.close()
      await derrubaServidor(servidor)
    }
  })
})
