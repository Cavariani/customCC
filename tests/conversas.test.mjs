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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  repo,
  sobeServidor,
} from './apoio.mjs'

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
    const falso = claudeFalso(base, { eco: 'ARGS:{args}' })

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
    const falso = claudeFalso(base, { eco: 'ARGS:[{args}]' })

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

describe('apagar uma conversa', () => {
  /** HOME com dois transcripts prontos, e o servidor no ar. */
  async function comDuas() {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const dir = join(base, '.claude', 'projects', '-tmp-p')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'fica.jsonl'),
      [cabecalho('/tmp/p', AGORA - MIN), titulo('fica'), assistant(AGORA - MIN)].join('\n') + '\n',
      'utf8',
    )
    writeFileSync(
      join(dir, 'some.jsonl'),
      [cabecalho('/tmp/p', AGORA - 2 * MIN), titulo('some'), assistant(AGORA - 2 * MIN)].join('\n') + '\n',
      'utf8',
    )
    const servidor = await sobeServidor({ cwd: projeto, home: base })
    return { base, dir, servidor }
  }

  const apagar = async (id) =>
    fetch(`${BASE}/api/conversas/${id}`, { method: 'DELETE' }).then(async (r) => ({
      status: r.status,
      json: await r.json(),
    }))

  it('some da lista e vai para a lixeira, sem sumir do disco', async () => {
    const { base, dir, servidor } = await comDuas()
    try {
      const r = await apagar('some')
      assert.equal(r.status, 200, JSON.stringify(r.json))

      const { json } = await get('/api/conversas?dias=90')
      const titulos = json.projetos.flatMap((p) => p.conversas.map((c) => c.titulo))
      assert.deepEqual(titulos, ['fica'], 'a conversa apagada continua na lista')

      // Saiu de projects, mas continua existindo: e o unico registro dela.
      assert.throws(() => readFileSync(join(dir, 'some.jsonl')), /ENOENT/)
      const naLixeira = readdirSync(join(base, '.claude-multi-account', 'lixeira'))
      assert.equal(naLixeira.length, 1)
      assert.match(naLixeira[0], /some\.jsonl$/)
      // O nome guarda o projeto: na lixeira, so o id nao diz de onde veio.
      assert.match(naLixeira[0], /^-tmp-p__/)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('recusa id que nao existe', async () => {
    const { servidor } = await comDuas()
    try {
      const r = await apagar('nao-existe')
      assert.equal(r.status, 400)
      assert.match(r.json.error, /nao encontrada/)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('id com caminho dentro nao apaga nada', async () => {
    const { dir, servidor } = await comDuas()
    try {
      for (const ruim of ['..%2F..%2Fetc%2Fpasswd', 'a%2Fb', '..', '.']) {
        const r = await fetch(`${BASE}/api/conversas/${ruim}`, { method: 'DELETE' })
        // Rota que nao casa devolve 404; id recusado devolve 400. As duas
        // servem: o que nao pode e devolver 200.
        assert.notEqual(r.status, 200, `aceitou ${ruim}`)
      }
      // E os dois transcripts continuam onde estavam.
      assert.ok(readFileSync(join(dir, 'fica.jsonl'), 'utf8').length > 0)
      assert.ok(readFileSync(join(dir, 'some.jsonl'), 'utf8').length > 0)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('recusa conversa que algum claude da maquina esta usando', async () => {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const dir = join(base, '.claude', 'projects', '-tmp-p')
    mkdirSync(dir, { recursive: true })

    const viva = 'sessao-viva'
    writeFileSync(
      join(dir, `${viva}.jsonl`),
      [cabecalho('/tmp/p', AGORA - MIN), titulo('em uso'), assistant(AGORA - MIN)].join('\n') + '\n',
      'utf8',
    )

    // O proprio Claude Code escreve um destes por processo vivo. Vale para
    // sessao aberta fora do painel tambem — que e justamente o caso em que
    // o painel nao teria como saber sozinho.
    const sess = join(base, '.claude', 'sessions')
    mkdirSync(sess, { recursive: true })
    writeFileSync(
      join(sess, '4242.json'),
      JSON.stringify({ pid: 4242, sessionId: viva, status: 'busy', cwd: '/tmp/p' }),
      'utf8',
    )

    const servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      const r = await apagar(viva)
      assert.equal(r.status, 400, JSON.stringify(r.json))
      assert.match(r.json.error, /aberta numa aba/)
      // E o transcript continua no lugar.
      assert.ok(readFileSync(join(dir, `${viva}.jsonl`), 'utf8').length > 0)
    } finally {
      await derrubaServidor(servidor)
    }
  })
})

describe('lixeira', () => {
  /** HOME com um transcript, o servidor no ar, e o id ja apagado. */
  async function comApagada() {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const dir = join(base, '.claude', 'projects', '-tmp-p')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'alvo.jsonl'),
      [cabecalho('/tmp/p', AGORA - MIN), titulo('conversa apagada'), assistant(AGORA - MIN)].join('\n') + '\n',
      'utf8',
    )
    const servidor = await sobeServidor({ cwd: projeto, home: base })
    await fetch(`${BASE}/api/conversas/alvo`, { method: 'DELETE' })
    return { base, dir, servidor }
  }

  const lixeira = async () => (await get('/api/lixeira')).json.itens

  it('lista o que foi apagado, com titulo e projeto', async () => {
    const { servidor } = await comApagada()
    try {
      const itens = await lixeira()
      assert.equal(itens.length, 1)
      assert.equal(itens[0].titulo, 'conversa apagada')
      assert.equal(itens[0].projeto, 'p')
      assert.equal(itens[0].sessionId, 'alvo')
      assert.ok(itens[0].apagadaEm > 0)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('restaurar devolve a conversa ao projeto', async () => {
    const { dir, servidor } = await comApagada()
    try {
      const [item] = await lixeira()
      const r = await fetch(`${BASE}/api/lixeira/${encodeURIComponent(item.arquivo)}/restaurar`, {
        method: 'POST',
      })
      assert.equal(r.status, 200)

      // Voltou ao lugar de origem e sumiu da lixeira.
      assert.ok(readFileSync(join(dir, 'alvo.jsonl'), 'utf8').length > 0)
      assert.equal((await lixeira()).length, 0)

      // E volta a aparecer na lista de conversas.
      const { json } = await get('/api/conversas?dias=90')
      const titulos = json.projetos.flatMap((p) => p.conversas.map((c) => c.titulo))
      assert.deepEqual(titulos, ['conversa apagada'])
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('restaurar nao sobrescreve uma conversa que voltou a existir', async () => {
    const { dir, servidor } = await comApagada()
    try {
      const [item] = await lixeira()
      // Alguem criou outra conversa com o mesmo id enquanto esta estava fora.
      writeFileSync(join(dir, 'alvo.jsonl'), 'conteudo novo e importante\n', 'utf8')

      const r = await fetch(`${BASE}/api/lixeira/${encodeURIComponent(item.arquivo)}/restaurar`, {
        method: 'POST',
      })
      assert.equal(r.status, 400)
      assert.match((await r.json()).error, /ja existe/)
      // O arquivo novo continua intacto, e a lixeira nao perdeu o dela.
      assert.equal(readFileSync(join(dir, 'alvo.jsonl'), 'utf8'), 'conteudo novo e importante\n')
      assert.equal((await lixeira()).length, 1)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('apagar de vez remove o arquivo', async () => {
    const { base, servidor } = await comApagada()
    try {
      const [item] = await lixeira()
      const r = await fetch(`${BASE}/api/lixeira/${encodeURIComponent(item.arquivo)}`, {
        method: 'DELETE',
      })
      assert.equal(r.status, 200)
      assert.equal((await lixeira()).length, 0)
      assert.equal(readdirSync(join(base, '.claude-multi-account', 'lixeira')).length, 0)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('nome de arquivo com caminho dentro e recusado', async () => {
    const { servidor } = await comApagada()
    try {
      for (const ruim of ['..__x.jsonl', 'a__..%2F..%2Fetc%2Fpasswd.jsonl', 'sem-separador.jsonl']) {
        const r = await fetch(`${BASE}/api/lixeira/${ruim}/restaurar`, { method: 'POST' })
        assert.notEqual(r.status, 200, `aceitou ${ruim}`)
      }
      // E o que estava la continua la.
      assert.equal((await lixeira()).length, 1)
    } finally {
      await derrubaServidor(servidor)
    }
  })
})
