/**
 * Degradacao com estado invalido.
 *
 * O state.json e editado a mao de vez em quando e sobrevive a versoes
 * diferentes do app, entao nada dentro dele pode ser tomado como certo. Um
 * `activeAccountId` fora de 1..3 vazava ate a API e deixava o painel sem
 * nenhuma conta ativa, porque nenhuma casava com o valor.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { derrubaServidor, get, limpa, pastaTemporaria, repo, sobeServidor } from './apoio.mjs'

const criados = []

after(() => criados.forEach(limpa))

/** Sobe um servidor com este conteudo de state.json e devolve /api/accounts. */
async function comEstado(conteudo) {
  const base = pastaTemporaria()
  criados.push(base)
  const projeto = repo(base, 'projeto')
  mkdirSync(join(base, '.claude-multi-account'), { recursive: true })
  writeFileSync(join(base, '.claude-multi-account', 'state.json'), conteudo, 'utf8')

  const servidor = await sobeServidor({ cwd: projeto, home: base })
  try {
    return { ...(await get('/api/accounts')), base }
  } finally {
    await derrubaServidor(servidor)
  }
}

const casos = {
  'JSON quebrado': '{isto nao e json',
  'arquivo vazio': '',
  'null': 'null',
  'lista no lugar de objeto': '[1,2,3]',
  'activeAccountId fora da faixa': '{"activeAccountId":99,"accounts":{},"periods":[],"transcripts":{}}',
  'activeAccountId textual': '{"activeAccountId":"abc","accounts":{},"periods":[],"transcripts":{}}',
  'periods nao e lista': '{"activeAccountId":1,"accounts":{},"periods":"nao","transcripts":{}}',
  'accounts e lista': '{"activeAccountId":1,"accounts":[9,9],"periods":[],"transcripts":{}}',
  'conta com campo de tipo errado':
    '{"activeAccountId":1,"accounts":{"1":{"windowStartedAt":"ontem"}},"periods":[],"transcripts":{}}',
}

describe('state.json invalido nao derruba nem confunde o painel', () => {
  for (const [nome, conteudo] of Object.entries(casos)) {
    it(nome, async () => {
      const { status, json } = await comEstado(conteudo)
      assert.equal(status, 200)
      assert.equal(json.accounts.length, 3, 'sempre tres contas')
      const ativas = json.accounts.filter((a) => a.active)
      assert.equal(ativas.length, 1, `esperava exatamente uma conta ativa, veio ${ativas.length}`)
      assert.ok([1, 2, 3].includes(json.activeId), `activeId invalido: ${json.activeId}`)
    })
  }
})

describe('state.json ilegivel e preservado', () => {
  it('guarda copia em vez de sobrescrever em silencio', async () => {
    const { base } = await comEstado('{quebrado')
    const arquivos = readdirSync(join(base, '.claude-multi-account'))
    assert.ok(
      arquivos.some((f) => f.startsWith('state.json.corrompido-')),
      `nenhuma copia guardada: ${arquivos.join(', ')}`,
    )
  })
})

describe('sem .env', () => {
  it('degrada para contas sem token, sem quebrar', async () => {
    const { status, json } = await comEstado('{"activeAccountId":1,"accounts":{},"periods":[],"transcripts":{}}')
    assert.equal(status, 200)
    for (const conta of json.accounts) {
      assert.equal(conta.hasToken, false)
      assert.match(conta.label, /conta \d/)
    }
  })
})
