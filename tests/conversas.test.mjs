/**
 * Conversas por projeto, e retomar uma delas.
 *
 * O agrupamento sai do `cwd` gravado dentro do transcript, e nao do nome
 * do diretorio em ~/.claude/projects: o slug e lossy — todo caractere nao
 * alfanumerico vira hifen — entao duas pastas diferentes podem colidir
 * nele e virariam um grupo so.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { PORTA, derrubaServidor, get, limpa, pastaTemporaria, repo, sobeServidor } from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

const AGORA = Date.now()
const MIN = 60_000

function assistant(quando) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(quando).toISOString(),
    message: {
      model: 'claude-opus-5',
      usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  })
}

const cabecalho = (cwd, quando) =>
  JSON.stringify({ type: 'user', cwd, timestamp: new Date(quando).toISOString(), message: { content: '' } })

const pedido = (texto, quando) =>
  JSON.stringify({ type: 'user', timestamp: new Date(quando).toISOString(), message: { content: texto } })

const titulo = (t) => JSON.stringify({ type: 'ai-title', aiTitle: t })

/** Monta transcripts e devolve /api/conversas. */
async function comConversas(sessoes) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')
  const dir = join(base, '.claude', 'projects', '-qualquer-slug')
  mkdirSync(dir, { recursive: true })

  sessoes.forEach((s, i) => {
    writeFileSync(join(dir, `s${i}.jsonl`), s.linhas.join('\n') + '\n', 'utf8')
  })

  const servidor = await sobeServidor({ cwd: projeto, home: base })
  try {
    const { json } = await get('/api/conversas?dias=90')
    return json.projetos
  } finally {
    await derrubaServidor(servidor)
  }
}

describe('agrupamento por projeto', () => {
  it('separa por cwd, e nao pelo diretorio do slug', async () => {
    // Os dois vivem no mesmo diretorio de slug, de proposito: e o caso que
    // o slug lossy produz quando dois caminhos colidem.
    const projetos = await comConversas([
      { linhas: [cabecalho('/tmp/alpha', AGORA - MIN), titulo('coisa da alpha'), assistant(AGORA - MIN)] },
      { linhas: [cabecalho('/tmp/beta', AGORA - 2 * MIN), titulo('coisa da beta'), assistant(AGORA - 2 * MIN)] },
    ])
    assert.equal(projetos.length, 2)
    assert.deepEqual(projetos.map((p) => p.nome).sort(), ['alpha', 'beta'])
  })

  it('o projeto usado por ultimo vem primeiro', async () => {
    const projetos = await comConversas([
      { linhas: [cabecalho('/tmp/velho', AGORA - 5 * MIN), assistant(AGORA - 5 * MIN)] },
      { linhas: [cabecalho('/tmp/novo', AGORA - MIN), assistant(AGORA - MIN)] },
    ])
    assert.deepEqual(
      projetos.map((p) => p.nome),
      ['novo', 'velho'],
    )
  })

  it('varias conversas do mesmo projeto ficam num grupo so', async () => {
    const projetos = await comConversas([
      { linhas: [cabecalho('/tmp/um', AGORA - MIN), titulo('a'), assistant(AGORA - MIN)] },
      { linhas: [cabecalho('/tmp/um', AGORA - 2 * MIN), titulo('b'), assistant(AGORA - 2 * MIN)] },
      { linhas: [cabecalho('/tmp/um', AGORA - 3 * MIN), titulo('c'), assistant(AGORA - 3 * MIN)] },
    ])
    assert.equal(projetos.length, 1)
    assert.equal(projetos[0].conversas.length, 3)
  })

  it('sessao sem cwd fica de fora, em vez de criar grupo fantasma', async () => {
    const projetos = await comConversas([
      { linhas: [titulo('orfa'), assistant(AGORA - MIN)] },
      { linhas: [cabecalho('/tmp/real', AGORA - MIN), assistant(AGORA - MIN)] },
    ])
    assert.equal(projetos.length, 1)
    assert.equal(projetos[0].nome, 'real')
  })
})

describe('nome da conversa', () => {
  it('usa o titulo do Claude Code quando existe', async () => {
    const projetos = await comConversas([
      { linhas: [cabecalho('/tmp/p', AGORA - MIN), titulo('Arrumar o painel'), assistant(AGORA - MIN)] },
    ])
    assert.equal(projetos[0].conversas[0].titulo, 'Arrumar o painel')
  })

  it('sem titulo, cai no primeiro pedido', async () => {
    const projetos = await comConversas([
      {
        linhas: [
          cabecalho('/tmp/p', AGORA - MIN),
          pedido('conserta o slider', AGORA - MIN),
          assistant(AGORA - MIN),
        ],
      },
    ])
    assert.equal(projetos[0].conversas[0].titulo, 'conserta o slider')
  })

  it('nao usa invólucro do sistema como nome', async () => {
    const projetos = await comConversas([
      {
        linhas: [
          cabecalho('/tmp/p', AGORA - MIN),
          pedido('<local-command-caveat>saida de comando</local-command-caveat>', AGORA - MIN),
          pedido('o pedido de verdade', AGORA - MIN),
          assistant(AGORA - MIN),
        ],
      },
    ])
    assert.equal(projetos[0].conversas[0].titulo, 'o pedido de verdade')
  })

  it('pedido longo vira uma linha curta', async () => {
    const projetos = await comConversas([
      {
        linhas: [
          cabecalho('/tmp/p', AGORA - MIN),
          pedido('primeira linha bem longa '.repeat(8) + '\nsegunda linha', AGORA - MIN),
          assistant(AGORA - MIN),
        ],
      },
    ])
    const t = projetos[0].conversas[0].titulo
    assert.ok(t.length <= 64, `titulo com ${t.length} caracteres`)
    assert.ok(!t.includes('\n'), 'titulo nao pode ter quebra de linha')
  })
})

describe('retomar a conversa escolhida', () => {
  it('o pty nasce com --resume no id pedido', async () => {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')

    // Um `claude` falso que so escreve os proprios argumentos: e assim que
    // da para provar que o --resume chegou, sem depender do binario real.
    const falso = join(base, 'claude-falso')
    writeFileSync(
      falso,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi\necho "ARGS:$@"\nsleep 30\n',
      'utf8',
    )
    chmodSync(falso, 0o755)

    const servidor = await sobeServidor({
      cwd: projeto,
      home: base,
      env: { CUSTOMCC_CLAUDE_BIN: falso },
    })

    let ws
    try {
      const alvo = 'conversa-escolhida-123'
      const url =
        `ws://127.0.0.1:${PORTA}/pty?session=aba-1&cwd=${encodeURIComponent(projeto)}` +
        `&cols=100&rows=30&resume=${alvo}`
      ws = new WebSocket(url)

      const saida = await new Promise((resolve, reject) => {
        let acc = ''
        const prazo = setTimeout(() => reject(new Error(`nada veio; recebido: ${acc}`)), 15_000)
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          acc += msg.data ?? msg.replay ?? ''
          if (acc.includes('ARGS:')) {
            clearTimeout(prazo)
            resolve(acc)
          }
        })
        ws.once('error', reject)
      })

      assert.match(saida, /--resume/, 'o pty nao recebeu --resume')
      assert.match(saida, new RegExp(alvo), 'o id pedido nao chegou ao pty')
    } finally {
      ws?.close()
      await derrubaServidor(servidor)
    }
  })

  it('sem o parametro, a aba nasce limpa', async () => {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const falso = join(base, 'claude-falso')
    writeFileSync(
      falso,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi\necho "ARGS:[$@]"\nsleep 30\n',
      'utf8',
    )
    chmodSync(falso, 0o755)

    const servidor = await sobeServidor({
      cwd: projeto,
      home: base,
      env: { CUSTOMCC_CLAUDE_BIN: falso },
    })

    let ws
    try {
      const url = `ws://127.0.0.1:${PORTA}/pty?session=aba-2&cwd=${encodeURIComponent(projeto)}&cols=100&rows=30`
      ws = new WebSocket(url)
      const saida = await new Promise((resolve, reject) => {
        let acc = ''
        const prazo = setTimeout(() => reject(new Error(`nada veio; recebido: ${acc}`)), 15_000)
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          acc += msg.data ?? msg.replay ?? ''
          if (acc.includes('ARGS:')) {
            clearTimeout(prazo)
            resolve(acc)
          }
        })
        ws.once('error', reject)
      })
      assert.doesNotMatch(saida, /--resume/, 'aba nova nao devia retomar nada')
      assert.doesNotMatch(saida, /--continue/, 'aba nova nao devia continuar nada')
    } finally {
      ws?.close()
      await derrubaServidor(servidor)
    }
  })
})
