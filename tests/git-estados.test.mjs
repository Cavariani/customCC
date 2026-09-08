/**
 * Git em estado estranho.
 *
 * Cada cenario aqui derrubou ou enganou o painel antes de existir este
 * arquivo. O pior: reverter arquivo em conflito escolhia um lado em
 * silencio e marcava como resolvido, apagando o outro lado.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  commit,
  derrubaServidor,
  escreve,
  git,
  gitDe,
  limpa,
  pastaTemporaria,
  post,
  repo,
  sobeServidor,
} from './apoio.mjs'

let base
let servidor
const cenario = {}

before(async () => {
  base = pastaTemporaria()

  cenario.conflito = repo(base, 'conflito')
  escreve(cenario.conflito, 'f.txt', 'base\n')
  commit(cenario.conflito, 'base')
  git(cenario.conflito, 'checkout', '-qb', 'outro')
  escreve(cenario.conflito, 'f.txt', 'outro\n')
  commit(cenario.conflito, 'outro')
  git(cenario.conflito, 'checkout', '-q', 'main')
  escreve(cenario.conflito, 'f.txt', 'main\n')
  commit(cenario.conflito, 'main')
  try {
    git(cenario.conflito, 'merge', 'outro')
  } catch {
    /* o conflito e o objetivo */
  }

  cenario.destacado = repo(base, 'destacado')
  escreve(cenario.destacado, 'a.txt', 'um\n')
  commit(cenario.destacado, 'um')
  escreve(cenario.destacado, 'a.txt', 'dois\n')
  commit(cenario.destacado, 'dois')
  git(cenario.destacado, 'checkout', '-q', 'HEAD~1')

  cenario.corrompido = repo(base, 'corrompido')
  escreve(cenario.corrompido, 'a.txt', 'um\n')
  commit(cenario.corrompido, 'um')
  writeFileSync(join(cenario.corrompido, '.git', 'HEAD'), 'isto nao e um HEAD\n')

  cenario.vazio = repo(base, 'vazio')

  cenario.naorepo = join(base, 'naorepo')
  mkdirSync(cenario.naorepo, { recursive: true })
  writeFileSync(join(cenario.naorepo, 'a.txt'), 'nada\n')

  cenario.gitdirQuebrado = repo(base, 'gitdirQuebrado')
  escreve(cenario.gitdirQuebrado, 'a.txt', 'um\n')
  commit(cenario.gitdirQuebrado, 'um')
  rmSync(join(cenario.gitdirQuebrado, '.git'), { recursive: true, force: true })
  writeFileSync(join(cenario.gitdirQuebrado, '.git'), 'gitdir: /nao/existe/nunca\n')

  servidor = await sobeServidor({ cwd: cenario.vazio, home: base })
})

after(async () => {
  await derrubaServidor(servidor)
  limpa(base)
})

describe('nenhum estado devolve 500', () => {
  for (const nome of [
    'conflito',
    'destacado',
    'corrompido',
    'vazio',
    'naorepo',
    'gitdirQuebrado',
  ]) {
    it(`${nome} responde 200`, async () => {
      const r = await gitDe(cenario[nome])
      assert.equal(r.status, 200, `veio ${r.status}: ${r.texto.slice(0, 200)}`)
    })
  }
})

describe('merge conflitado', () => {
  it('marca a operacao em curso', async () => {
    const { json } = await gitDe(cenario.conflito)
    assert.equal(json.operation, 'merge')
  })

  it('o arquivo vem como conflitado e fora de staged', async () => {
    const { json } = await gitDe(cenario.conflito)
    const f = json.files.find((x) => x.path === 'f.txt')
    assert.ok(f, 'f.txt nao apareceu na lista')
    assert.equal(f.status, 'conflicted')
    assert.equal(f.staged, false, 'conflito staged convida a commitar os marcadores')
  })

  it('reverter arquivo em conflito e recusado', async () => {
    const r = await post('/api/changes/revert', { cwd: cenario.conflito, path: 'f.txt' })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /conflito/)
  })

  it('e o conflito continua de pe depois da recusa', async () => {
    const status = git(cenario.conflito, 'status', '--porcelain')
    assert.match(status, /^UU /m, `o conflito sumiu:\n${status}`)
  })
})

describe('HEAD destacado', () => {
  it('mostra o hash curto, e nao um ramo chamado HEAD', async () => {
    const { json } = await gitDe(cenario.destacado)
    assert.equal(json.detached, true)
    assert.notEqual(json.branch, 'HEAD')
    assert.match(json.branch, /^[0-9a-f]{7,}$/)
  })
})

describe('repositorio sem nenhum commit', () => {
  it('nao estoura e marca unborn', async () => {
    const { status, json } = await gitDe(cenario.vazio)
    assert.equal(status, 200)
    assert.equal(json.repo, true)
    assert.equal(json.unborn, true)
    assert.equal(json.branch, 'main')
  })
})

describe('repositorio quebrado e pasta comum sao coisas diferentes', () => {
  it('pasta comum: repo false, sem motivo de quebra', async () => {
    const { json } = await gitDe(cenario.naorepo)
    assert.equal(json.repo, false)
    assert.equal(json.broken, null)
  })

  it('.git corrompido: traz o motivo', async () => {
    const { json } = await gitDe(cenario.corrompido)
    assert.equal(json.repo, false)
    assert.ok(json.broken, 'deveria dizer por que o git recusou')
  })

  it('gitdir apontando para o vazio: traz o motivo', async () => {
    const { json } = await gitDe(cenario.gitdirQuebrado)
    assert.ok(json.broken)
  })
})

describe('escrita fora de repositorio', () => {
  for (const rota of ['/api/git/stage', '/api/git/unstage']) {
    it(`${rota} explica que nao e repositorio`, async () => {
      const r = await post(rota, { cwd: cenario.naorepo, paths: ['a.txt'] })
      assert.equal(r.status, 400)
      assert.match(r.json.error, /nao e um repositorio git/)
    })
  }

  it('commit explica que nao e repositorio, sem despejar o uso do git diff', async () => {
    const r = await post('/api/git/commit', { cwd: cenario.naorepo, message: 'x', all: true })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /nao e um repositorio git/)
    assert.doesNotMatch(r.json.error, /no-index/)
  })
})
