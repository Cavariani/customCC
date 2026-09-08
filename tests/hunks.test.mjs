/**
 * Stage por bloco.
 *
 * A parte perigosa e escrever no indice do git. Um patch remontado errado
 * nao da erro barulhento: ele stagea o pedaco errado, e a pessoa so
 * descobre depois de commitar. Por isso todo caso aqui confere o indice de
 * verdade com `git diff --cached`, e nao so o status da resposta.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  commit,
  derrubaServidor,
  escreve,
  get,
  git,
  limpa,
  pastaTemporaria,
  post,
  repo,
  sobeServidor,
} from './apoio.mjs'

let base
let servidor
let projeto

/** Dez linhas, para caber tres alteracoes bem separadas. */
const ORIGINAL = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`).join('\n') + '\n'

/** Mexe no topo, no meio e no fim: tres blocos distintos. */
function tresAlteracoes() {
  const linhas = ORIGINAL.split('\n')
  linhas[1] = 'linha 2 ALTERADA NO TOPO'
  linhas[10] = 'linha 11 ALTERADA NO MEIO'
  linhas[18] = 'linha 19 ALTERADA NO FIM'
  return linhas.join('\n')
}

before(async () => {
  base = pastaTemporaria()
  projeto = repo(base, 'projeto')
  escreve(projeto, 'arquivo.txt', ORIGINAL)
  commit(projeto, 'base')
  servidor = await sobeServidor({ cwd: projeto, home: base })
})

after(async () => {
  await derrubaServidor(servidor)
  limpa(base)
})

/** Volta o arquivo ao estado de tres alteracoes, com indice limpo. */
function reset() {
  git(projeto, 'reset', '-q')
  git(projeto, 'checkout', '-q', '--', 'arquivo.txt')
  escreve(projeto, 'arquivo.txt', tresAlteracoes())
}

const staged = () => git(projeto, 'diff', '--cached')
const naoStaged = () => git(projeto, 'diff')

const hunks = async (extra = '') =>
  (await get(`/api/git/hunks?cwd=${encodeURIComponent(projeto)}&path=arquivo.txt${extra}`)).json
    ?.hunks ?? []

describe('listagem de blocos', () => {
  it('tres alteracoes separadas viram tres blocos', async () => {
    reset()
    const lista = await hunks()
    assert.equal(lista.length, 3, `esperava 3 blocos, veio ${lista.length}`)
    for (const h of lista) {
      assert.match(h.header, /^@@ /)
      assert.equal(h.added, 1)
      assert.equal(h.removed, 1)
    }
  })

  it('arquivo sem mudanca nao tem bloco', async () => {
    reset()
    git(projeto, 'checkout', '-q', '--', 'arquivo.txt')
    assert.equal((await hunks()).length, 0)
  })
})

describe('mover um bloco para o indice', () => {
  it('stagea so o bloco pedido, e o resto continua fora', async () => {
    reset()
    const r = await post('/api/git/stage-hunk', {
      cwd: projeto,
      path: 'arquivo.txt',
      index: 0,
    })
    assert.equal(r.status, 200, r.texto)

    const noIndice = staged()
    assert.match(noIndice, /ALTERADA NO TOPO/, 'o bloco pedido deveria estar no indice')
    assert.doesNotMatch(noIndice, /ALTERADA NO MEIO/, 'levou bloco que nao foi pedido')
    assert.doesNotMatch(noIndice, /ALTERADA NO FIM/, 'levou bloco que nao foi pedido')

    const fora = naoStaged()
    assert.match(fora, /ALTERADA NO MEIO/)
    assert.match(fora, /ALTERADA NO FIM/)
    assert.doesNotMatch(fora, /ALTERADA NO TOPO/)
  })

  it('o bloco do meio pode ir sozinho, sem depender dos anteriores', async () => {
    reset()
    const r = await post('/api/git/stage-hunk', { cwd: projeto, path: 'arquivo.txt', index: 1 })
    assert.equal(r.status, 200, r.texto)

    const noIndice = staged()
    assert.match(noIndice, /ALTERADA NO MEIO/)
    assert.doesNotMatch(noIndice, /ALTERADA NO TOPO/)
    assert.doesNotMatch(noIndice, /ALTERADA NO FIM/)
  })

  it('dois blocos, um de cada vez, chegam os dois', async () => {
    reset()
    await post('/api/git/stage-hunk', { cwd: projeto, path: 'arquivo.txt', index: 0 })
    // Depois do primeiro, o diff nao staged tem so dois blocos: o do meio
    // virou indice 0. Pedir "1" de novo pegaria o do fim.
    const restantes = await hunks()
    assert.equal(restantes.length, 2)

    await post('/api/git/stage-hunk', { cwd: projeto, path: 'arquivo.txt', index: 0 })
    const noIndice = staged()
    assert.match(noIndice, /ALTERADA NO TOPO/)
    assert.match(noIndice, /ALTERADA NO MEIO/)
    assert.doesNotMatch(noIndice, /ALTERADA NO FIM/)
  })
})

describe('tirar um bloco do indice', () => {
  it('desfaz so o bloco pedido', async () => {
    reset()
    git(projeto, 'add', 'arquivo.txt')
    assert.equal((await hunks('&staged=1')).length, 3)

    const r = await post('/api/git/unstage-hunk', {
      cwd: projeto,
      path: 'arquivo.txt',
      index: 0,
    })
    assert.equal(r.status, 200, r.texto)

    const noIndice = staged()
    assert.doesNotMatch(noIndice, /ALTERADA NO TOPO/, 'o bloco pedido deveria ter saido')
    assert.match(noIndice, /ALTERADA NO MEIO/, 'tirou bloco que nao foi pedido')
    assert.match(noIndice, /ALTERADA NO FIM/)
  })
})

describe('entradas invalidas', () => {
  it('index fora da faixa e recusado', async () => {
    reset()
    const r = await post('/api/git/stage-hunk', { cwd: projeto, path: 'arquivo.txt', index: 99 })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /nao existe/)
  })

  for (const [nome, index] of Object.entries({
    'texto': '0',
    'negativo': -1,
    'fracionario': 1.5,
    'ausente': undefined,
  })) {
    it(`index ${nome} e recusado`, async () => {
      reset()
      const r = await post('/api/git/stage-hunk', { cwd: projeto, path: 'arquivo.txt', index })
      assert.equal(r.status, 400)
    })
  }

  it('caminho fora do projeto e recusado', async () => {
    const r = await post('/api/git/stage-hunk', {
      cwd: projeto,
      path: '../fora.txt',
      index: 0,
    })
    assert.equal(r.status, 400)
    assert.match(r.json.error, /fora do projeto/)
  })

  it('o indice continua limpo depois das recusas', async () => {
    assert.equal(staged().trim(), '', `algo vazou para o indice:\n${staged()}`)
  })
})
