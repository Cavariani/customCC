/**
 * Validacao das rotas de escrita.
 *
 * Todo caso aqui nasceu de um bug real. O mais caro: `paths` chegando como
 * string escapava da checagem, porque `for (const p of "a.txt")` percorre os
 * caracteres, e o comando saia como `git add -- a . t x t`.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  commit,
  derrubaServidor,
  escreve,
  limpa,
  pastaTemporaria,
  post,
  repo,
  sobeServidor,
} from './apoio.mjs'

let base
let servidor
let projeto

before(async () => {
  base = pastaTemporaria()
  projeto = repo(base, 'projeto')
  escreve(projeto, 'a.txt', 'um\n')
  escreve(projeto, 'b.txt', 'dois\n')
  commit(projeto, 'base')
  escreve(projeto, 'a.txt', 'um alterado\n')
  escreve(projeto, 'c.txt', 'novo\n')
  servidor = await sobeServidor({ cwd: projeto, home: base })
})

after(async () => {
  await derrubaServidor(servidor)
  limpa(base)
})

describe('paths precisa ser lista de texto', () => {
  const recusados = {
    'string em vez de lista': 'a.txt',
    'objeto': { 0: 'a.txt' },
    'numero': 42,
    'nulo': null,
    'elemento numerico': [123],
    'elemento objeto': [{}],
    'elemento nulo': [null],
    'byte nulo': ['a\u0000b'],
    'lista vazia': [],
    'so espaco': ['   '],
    'fuga com ..': ['../../.ssh/id_rsa'],
    'absoluto fora': ['/etc/passwd'],
  }

  for (const [nome, paths] of Object.entries(recusados)) {
    it(`recusa ${nome}`, async () => {
      const r = await post('/api/git/stage', { cwd: projeto, paths })
      assert.equal(r.status, 400, `esperava 400, veio ${r.status}: ${r.texto}`)
    })
  }

  it('recusa acima do teto de 500 caminhos', async () => {
    const r = await post('/api/git/stage', { cwd: projeto, paths: Array(501).fill('a.txt') })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /caminhos demais/)
  })

  it('aceita caminho valido, e o unstage desfaz', async () => {
    assert.equal((await post('/api/git/stage', { cwd: projeto, paths: ['a.txt'] })).status, 200)
    assert.equal((await post('/api/git/unstage', { cwd: projeto, paths: ['a.txt'] })).status, 200)
  })
})

describe('mensagem de commit precisa ser texto', () => {
  const recusadas = {
    'objeto (virava [object Object])': {},
    'lista (virava "a,b")': ['a', 'b'],
    'numero': 42,
    'booleano': true,
    'nulo': null,
    'so espaco': '   ',
    'byte nulo': 'a\u0000b',
  }

  for (const [nome, message] of Object.entries(recusadas)) {
    it(`recusa ${nome}`, async () => {
      const r = await post('/api/git/commit', { cwd: projeto, message, all: true })
      assert.equal(r.status, 400, `esperava 400, veio ${r.status}: ${r.texto}`)
    })
  }

  it('recusa ausencia da mensagem', async () => {
    assert.equal((await post('/api/git/commit', { cwd: projeto, all: true })).status, 400)
  })

  it('recusa mensagem acima do teto', async () => {
    const r = await post('/api/git/commit', { cwd: projeto, message: 'x'.repeat(20001), all: true })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /passa do limite/)
  })

  it('nenhum commit indevido entrou no historico', async () => {
    const { execFileSync } = await import('node:child_process')
    const log = execFileSync('git', ['log', '--oneline'], { cwd: projeto, encoding: 'utf8' })
    assert.equal(log.trim().split('\n').length, 1, `historico inesperado:\n${log}`)
  })
})

describe('caminho do revert precisa ser texto', () => {
  for (const [nome, path] of Object.entries({
    'objeto': {},
    'lista': ['a.txt'],
    'numero': 7,
  })) {
    it(`recusa ${nome}`, async () => {
      assert.equal((await post('/api/changes/revert', { cwd: projeto, path })).status, 400)
    })
  }

  it('recusa ausencia do caminho', async () => {
    assert.equal((await post('/api/changes/revert', { cwd: projeto })).status, 400)
  })

  it('recusa caminho fora do projeto', async () => {
    const r = await post('/api/changes/revert', { cwd: projeto, path: '../fora.txt' })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /fora do projeto/)
  })
})

describe('cwd e obrigatorio e precisa existir', () => {
  it('recusa ausencia', async () => {
    assert.equal((await post('/api/git/stage', { paths: ['a.txt'] })).status, 400)
  })
  it('recusa tipo errado', async () => {
    assert.equal((await post('/api/git/stage', { cwd: 123, paths: ['a.txt'] })).status, 400)
  })
  it('recusa pasta inexistente', async () => {
    const r = await post('/api/git/stage', { cwd: '/nao/existe/mesmo', paths: ['a.txt'] })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /pasta invalida/)
  })
})

describe('corpo da requisicao', () => {
  it('JSON invalido vira 400, e nao derruba o servidor', async () => {
    const r = await post('/api/git/stage', '{isso nao e json')
    assert.equal(r.status, 400)
    assert.match(r.json.error, /nao e JSON valido/)
  })

  it('corpo grande demais vira 413, e nao 500', async () => {
    const r = await post('/api/git/stage', {
      cwd: projeto,
      paths: ['a.txt'],
      lixo: 'z'.repeat(3_000_000),
    })
    assert.equal(r.status, 413)
  })

  it('o servidor continua de pe depois de tudo isso', async () => {
    const r = await post('/api/git/stage', { cwd: projeto, paths: ['a.txt'] })
    assert.equal(r.status, 200)
  })
})
