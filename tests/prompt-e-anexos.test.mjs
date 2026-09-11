/**
 * Prompt global e imagens coladas.
 *
 * O prompt global escreve dentro de `~/.claude/CLAUDE.md`, que e um arquivo
 * do usuario e pode ja ter conteudo escrito a mao. Perder esse conteudo
 * seria o pior defeito possivel desta tela, entao e o que os casos abaixo
 * vigiam: o texto de fora do bloco precisa sobreviver a gravacao, a
 * regravacao e a remocao.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BASE,
  claudeFalso,
  derrubaServidor,
  get,
  limpa,
  pastaTemporaria,
  post,
  sobeServidor,
} from './apoio.mjs'

const criados = []
after(() => criados.forEach(limpa))

/** Um PNG minimo de verdade, para o upload nao depender de arquivo externo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('prompt global e anexos', () => {
  let base
  let projeto
  let servidor
  let claudeMd

  before(async () => {
    base = pastaTemporaria()
    criados.push(base)
    projeto = join(base, 'projeto')
    mkdirSync(projeto, { recursive: true })
    mkdirSync(join(base, '.claude'), { recursive: true })
    claudeMd = join(base, '.claude', 'CLAUDE.md')
    writeFileSync(claudeMd, '# minhas regras\n\nescrito a mao, nao pode sumir.\n', 'utf8')

    servidor = await sobeServidor({
      cwd: projeto,
      home: base,
      env: { CUSTOMCC_CLAUDE_BIN: claudeFalso(base, { eco: 'falso {args}' }) },
    })
  })

  after(async () => derrubaServidor(servidor))

  it('comeca vazio mesmo com o arquivo ja escrito', async () => {
    const { json } = await get('/api/prompt-global')
    assert.equal(json.texto, '')
    assert.match(json.caminho, /CLAUDE\.md$/)
  })

  it('grava sem encostar no que o usuario escreveu', async () => {
    const { status, json } = await post('/api/prompt-global', {
      texto: 'Seja objetivo. Va direto ao ponto.',
    })
    assert.equal(status, 200)
    assert.equal(json.texto, 'Seja objetivo. Va direto ao ponto.')

    const conteudo = readFileSync(claudeMd, 'utf8')
    assert.match(conteudo, /# minhas regras/)
    assert.match(conteudo, /escrito a mao, nao pode sumir\./)
    assert.match(conteudo, /Seja objetivo\. Va direto ao ponto\./)
  })

  it('regravar troca o bloco em vez de empilhar copias', async () => {
    await post('/api/prompt-global', { texto: 'primeira versao' })
    await post('/api/prompt-global', { texto: 'segunda versao' })

    const conteudo = readFileSync(claudeMd, 'utf8')
    assert.equal(conteudo.match(/customcc:prompt-global/g).length, 2, 'um marcador de abertura e um de fecho')
    assert.doesNotMatch(conteudo, /primeira versao/)
    assert.match(conteudo, /segunda versao/)
    assert.match(conteudo, /# minhas regras/)

    const { json } = await get('/api/prompt-global')
    assert.equal(json.texto, 'segunda versao')
  })

  it('texto vazio remove o bloco e deixa o resto', async () => {
    await post('/api/prompt-global', { texto: '   ' })
    const conteudo = readFileSync(claudeMd, 'utf8')
    assert.doesNotMatch(conteudo, /customcc:prompt-global/)
    assert.match(conteudo, /# minhas regras/)
  })

  it('recusa corpo que nao e texto', async () => {
    const { status } = await post('/api/prompt-global', { texto: 42 })
    assert.equal(status, 400)
  })

  it('salva a imagem colada e devolve o caminho que o claude sabe ler', async () => {
    const resposta = await fetch(`${BASE}/api/anexos`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: PNG,
    })
    assert.equal(resposta.status, 200)
    const { arquivo, caminho } = await resposta.json()
    assert.match(arquivo, /\.png$/)
    assert.ok(existsSync(caminho), `imagem deveria estar em ${caminho}`)
    assert.deepEqual(readFileSync(caminho), PNG)

    // A mesma imagem volta pela rota que desenha a miniatura.
    const preview = await fetch(`${BASE}/api/anexos/${arquivo}`)
    assert.equal(preview.status, 200, `${arquivo} -> ${await preview.clone().text()}`)
    assert.equal(Buffer.from(await preview.arrayBuffer()).length, PNG.length)
  })

  it('recusa o que nao e imagem', async () => {
    const resposta = await fetch(`${BASE}/api/anexos`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-1.4'),
    })
    assert.equal(resposta.status, 415)
  })

  it('nao serve nome que tenta sair da pasta de anexos', async () => {
    const resposta = await fetch(`${BASE}/api/anexos/${encodeURIComponent('../.env')}`)
    assert.equal(resposta.status, 400)
  })
})
