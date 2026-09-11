/**
 * A aba de arquivos le a pasta do projeto.
 *
 * O caminho chega do navegador, entao o que esta em teste aqui nao e so
 * "lista os arquivos": e que nenhum caminho vindo de fora consiga sair do
 * `cwd`. Um `../../.ssh/id_rsa` que passasse transformaria o painel num
 * leitor do disco inteiro, servido por uma porta HTTP sem senha.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  claudeFalso,
  derrubaServidor,
  escreve,
  get,
  limpa,
  pastaTemporaria,
  sobeServidor,
} from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

describe('arquivos da pasta do projeto', () => {
  let base
  let projeto
  let servidor

  before(async () => {
    base = pastaTemporaria()
    criados.push(base)
    projeto = join(base, 'projeto')
    mkdirSync(join(projeto, 'src'), { recursive: true })
    escreve(projeto, 'README.md', '# titulo\n\ntexto do readme\n')
    escreve(join(projeto, 'src'), 'app.ts', 'const x = 1\n')
    // Segredo fora do projeto: e o que a travessia tentaria alcancar.
    escreve(base, 'segredo.txt', 'token=nao-pode-vazar')
    writeFileSync(join(projeto, 'icone.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))

    servidor = await sobeServidor({
      cwd: projeto,
      home: base,
      env: { CUSTOMCC_CLAUDE_BIN: claudeFalso(base, { eco: 'falso {args}' }) },
    })
  })

  after(async () => derrubaServidor(servidor))

  const url = (rota, path) =>
    `${rota}?cwd=${encodeURIComponent(projeto)}&path=${encodeURIComponent(path)}`

  it('lista a raiz com pasta antes de arquivo', async () => {
    const { status, json } = await get(url('/api/arquivos', ''))
    assert.equal(status, 200)
    const nomes = json.entradas.map((e) => e.nome)
    assert.ok(nomes.includes('src'))
    assert.ok(nomes.includes('README.md'))
    assert.equal(json.entradas[0].nome, 'src', 'pasta vem antes de arquivo')
    assert.equal(json.entradas[0].tipo, 'pasta')
  })

  it('desce para a subpasta pelo caminho relativo', async () => {
    const { json } = await get(url('/api/arquivos', 'src'))
    assert.deepEqual(
      json.entradas.map((e) => e.nome),
      ['app.ts'],
    )
    assert.equal(json.entradas[0].caminho, 'src/app.ts')
  })

  it('le o conteudo e reconhece a linguagem', async () => {
    const { json } = await get(url('/api/arquivo', 'src/app.ts'))
    assert.equal(json.texto, 'const x = 1\n')
    assert.equal(json.linguagem, 'ts')
    assert.equal(json.binario, false)
    assert.equal(json.truncado, false)
  })

  it('marca binario em vez de despejar bytes como texto', async () => {
    const { json } = await get(url('/api/arquivo', 'icone.png'))
    assert.equal(json.binario, true)
    assert.equal(json.texto, '')
  })

  it('recusa sair da pasta do projeto', async () => {
    for (const fuga of ['../segredo.txt', '..', 'src/../../segredo.txt']) {
      const { status, json, texto } = await get(url('/api/arquivo', fuga))
      assert.equal(status, 400, `${fuga} deveria ser recusado, veio ${texto}`)
      assert.match(json.error, /fora da pasta/)
    }
  })

  it('caminho absoluto e lido como relativo ao projeto, nao ao disco', async () => {
    // A barra da frente cai antes de resolver, entao `/etc/passwd` vira
    // `<projeto>/etc/passwd` — que nao existe. O importante e que o arquivo
    // do sistema nunca chega a ser aberto.
    const { status, json } = await get(url('/api/arquivo', '/etc/passwd'))
    assert.equal(status, 400)
    assert.match(json.error, /projeto[/\\]etc/)
  })

  it('recusa listar pasta fora do projeto', async () => {
    const { status } = await get(url('/api/arquivos', '../'))
    assert.equal(status, 400)
  })
})
