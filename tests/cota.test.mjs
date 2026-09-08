/**
 * Cota real, vinda do hook de statusline.
 *
 * Duas coisas nao obvias sobre a fonte, e as duas ja causaram numero
 * errado na tela:
 *
 * 1. O JSON nao diz de qual conta a cota e. A ligacao sai do periodo em
 *    que cada conta esteve ativa no instante da leitura.
 * 2. O arquivo nao dura: o statusline reescreve o mesmo arquivo por
 *    sessao a cada render, entao na troca de conta a leitura anterior e
 *    sobrescrita. Por isso a cota e copiada para o estado.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { derrubaServidor, get, limpa, pastaTemporaria, repo, sobeServidor } from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

const AGORA = Date.now()
const MIN = 60_000

function leitura({ cincoH, seteD = null }) {
  const rate = {}
  if (cincoH !== null) {
    rate.five_hour = { used_percentage: cincoH, resets_at: Math.floor((AGORA + 3 * 3600_000) / 1000) }
  }
  if (seteD !== null) {
    rate.seven_day = { used_percentage: seteD, resets_at: Math.floor((AGORA + 4 * 86400_000) / 1000) }
  }
  return JSON.stringify({ rate_limits: rate, context_window: { used_percentage: 30 } })
}

/**
 * Monta um HOME com arquivos de cota, transcripts registrados e periodos,
 * e devolve as contas como a API as entrega.
 */
async function comCota({ arquivos, periodos, transcripts }) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')

  const dirQuota = join(base, '.claude-multi-account', 'quota')
  mkdirSync(dirQuota, { recursive: true })
  for (const [sid, { conteudo, quando }] of Object.entries(arquivos)) {
    const caminho = join(dirQuota, `${sid}.json`)
    writeFileSync(caminho, conteudo, 'utf8')
    // mtime e o que diz quando a leitura foi escrita, e e por ele que a
    // atribuicao acha a conta ativa naquele instante.
    const seg = quando / 1000
    utimesSync(caminho, seg, seg)
  }

  writeFileSync(
    join(base, '.claude-multi-account', 'state.json'),
    JSON.stringify({ activeAccountId: 1, accounts: {}, periods: periodos, transcripts }),
    'utf8',
  )

  const servidor = await sobeServidor({ cwd: projeto, home: base })
  try {
    const { json } = await get('/api/accounts')
    return { contas: json.accounts, base, servidor }
  } finally {
    await derrubaServidor(servidor)
  }
}

const trecho = (id, de, ate) => ({ accountId: id, from: de, to: ate })
const registro = (sid) => ({ [sid]: { file: `/tmp/${sid}.jsonl`, cwd: '/tmp/projeto' } })

describe('a cota vai para a conta certa', () => {
  it('duas leituras no mesmo instante caem em contas diferentes', async () => {
    const { contas } = await comCota({
      arquivos: {
        sessaoA: { conteudo: leitura({ cincoH: 41 }), quando: AGORA - 30 * MIN },
        sessaoB: { conteudo: leitura({ cincoH: 12 }), quando: AGORA - 5 * MIN },
      },
      periodos: [
        trecho(1, AGORA - 60 * MIN, AGORA - 20 * MIN),
        trecho(2, AGORA - 20 * MIN, null),
      ],
      transcripts: { ...registro('sessaoA'), ...registro('sessaoB') },
    })

    const c1 = contas.find((c) => c.id === 1)
    const c2 = contas.find((c) => c.id === 2)
    assert.equal(c1.quota?.cincoHoras?.usadoPct, 41, 'a leitura velha e da conta 1')
    assert.equal(c2.quota?.cincoHoras?.usadoPct, 12, 'a leitura nova e da conta 2')
  })

  it('sessao que o painel nao conhece e ignorada', async () => {
    // Sessao aberta fora do painel usa o login padrao da maquina: atribui-la
    // a conta ativa daria a cota de outra pessoa com cara de certa.
    const { contas } = await comCota({
      arquivos: { deFora: { conteudo: leitura({ cincoH: 99 }), quando: AGORA - MIN } },
      periodos: [trecho(1, AGORA - 60 * MIN, null)],
      transcripts: {},
    })
    assert.equal(contas.find((c) => c.id === 1).quota, null)
  })

  it('conta sem leitura fica sem bloco, e nao herda a da vizinha', async () => {
    const { contas } = await comCota({
      arquivos: { sessaoA: { conteudo: leitura({ cincoH: 55 }), quando: AGORA - MIN } },
      periodos: [trecho(2, AGORA - 60 * MIN, null)],
      transcripts: registro('sessaoA'),
    })
    assert.equal(contas.find((c) => c.id === 2).quota?.cincoHoras?.usadoPct, 55)
    assert.equal(contas.find((c) => c.id === 1).quota, null)
    assert.equal(contas.find((c) => c.id === 3).quota, null)
  })

  it('leitura sem nenhum limite nao vira cota vazia', async () => {
    const { contas } = await comCota({
      arquivos: { sessaoA: { conteudo: leitura({ cincoH: null }), quando: AGORA - MIN } },
      periodos: [trecho(1, AGORA - 60 * MIN, null)],
      transcripts: registro('sessaoA'),
    })
    assert.equal(contas.find((c) => c.id === 1).quota, null)
  })
})

describe('a cota sobrevive ao arquivo', () => {
  it('continua na conta depois que o arquivo some', async () => {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const dirQuota = join(base, '.claude-multi-account', 'quota')
    mkdirSync(dirQuota, { recursive: true })

    const arquivo = join(dirQuota, 'sessaoA.json')
    writeFileSync(arquivo, leitura({ cincoH: 77, seteD: 33 }), 'utf8')
    const seg = (AGORA - MIN) / 1000
    utimesSync(arquivo, seg, seg)

    writeFileSync(
      join(base, '.claude-multi-account', 'state.json'),
      JSON.stringify({
        activeAccountId: 1,
        accounts: {},
        periods: [trecho(1, AGORA - 60 * MIN, null)],
        transcripts: registro('sessaoA'),
      }),
      'utf8',
    )

    // Primeira leitura: o servidor copia a cota para o estado.
    let servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      const { json } = await get('/api/accounts')
      assert.equal(json.accounts.find((c) => c.id === 1).quota?.cincoHoras?.usadoPct, 77)
    } finally {
      await derrubaServidor(servidor)
    }

    // O statusline reescreveria este arquivo sob outra conta; aqui ele
    // simplesmente some, que e o caso extremo do mesmo problema.
    rmSync(arquivo)

    servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      const { json } = await get('/api/accounts')
      const c1 = json.accounts.find((c) => c.id === 1)
      assert.equal(c1.quota?.cincoHoras?.usadoPct, 77, 'a cota devia ter sido guardada no estado')
      assert.equal(c1.quota?.seteDias?.usadoPct, 33)
    } finally {
      await derrubaServidor(servidor)
    }
  })

  it('leitura mais velha nao apaga a mais nova', async () => {
    const base = pastaTemporaria()
    criados.push(base)
    const projeto = repo(base, 'projeto')
    const dirQuota = join(base, '.claude-multi-account', 'quota')
    mkdirSync(dirQuota, { recursive: true })

    const novo = join(dirQuota, 'sessaoA.json')
    writeFileSync(novo, leitura({ cincoH: 60 }), 'utf8')
    utimesSync(novo, (AGORA - MIN) / 1000, (AGORA - MIN) / 1000)

    writeFileSync(
      join(base, '.claude-multi-account', 'state.json'),
      JSON.stringify({
        activeAccountId: 1,
        accounts: {},
        periods: [trecho(1, AGORA - 60 * MIN, null)],
        transcripts: { ...registro('sessaoA'), ...registro('sessaoB') },
      }),
      'utf8',
    )

    let servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      await get('/api/accounts')
    } finally {
      await derrubaServidor(servidor)
    }

    // Agora aparece uma leitura ANTERIOR, de outra sessao da mesma conta.
    const velho = join(dirQuota, 'sessaoB.json')
    writeFileSync(velho, leitura({ cincoH: 5 }), 'utf8')
    utimesSync(velho, (AGORA - 40 * MIN) / 1000, (AGORA - 40 * MIN) / 1000)

    servidor = await sobeServidor({ cwd: projeto, home: base })
    try {
      const { json } = await get('/api/accounts')
      assert.equal(
        json.accounts.find((c) => c.id === 1).quota?.cincoHoras?.usadoPct,
        60,
        'a leitura de 40 min atras nao podia sobrescrever a de 1 min',
      )
    } finally {
      await derrubaServidor(servidor)
    }
  })
})
