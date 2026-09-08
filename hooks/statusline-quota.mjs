#!/usr/bin/env node
/**
 * Captura a cota real da API e desenha a barra de status.
 *
 * O Claude Code entrega ao comando de statusline um JSON com
 * `rate_limits.five_hour.used_percentage` e `resets_at`, mais o
 * `seven_day` — os mesmos numeros do /usage. Esse JSON e o unico lugar do
 * disco onde a cota aparece com teto: o transcript so tem tokens, e token
 * sem teto nao diz quanto falta. Aqui ele e guardado para o painel ler.
 *
 * Em Node, e nao em shell, de proposito: a versao anterior era um `.sh`
 * com `jq` e `tee >(...)`, e nenhum dos tres existe no Windows por padrao.
 * Node o projeto ja exige.
 *
 * Contrato com o Claude Code: recebe o JSON no stdin e o que sair no
 * stdout vira a barra. Se havia uma statusline antes, ela e chamada com o
 * mesmo stdin e a saida dela passa direto — este hook nao rouba a barra
 * de ninguem.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DESTINO = join(homedir(), '.claude-multi-account', 'quota')
const CONFIG = join(homedir(), '.claude', 'customcc-statusline.json')

/** Le o stdin inteiro. Sem isso o JSON chega pela metade em entrada longa. */
function lerEntrada() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function guardar(entrada) {
  let sessao = 'sem-sessao'
  try {
    const d = JSON.parse(entrada)
    if (typeof d.session_id === 'string') sessao = d.session_id
    else if (typeof d.sessionId === 'string') sessao = d.sessionId
  } catch {
    // Entrada que nao e JSON nao serve para nada aqui, mas tambem nao pode
    // impedir a barra de ser desenhada.
    return
  }

  // Nome de arquivo vem de fora: qualquer separador aqui viraria escrita
  // fora da pasta.
  if (!/^[A-Za-z0-9._-]+$/.test(sessao) || sessao.includes('..')) sessao = 'sem-sessao'

  try {
    mkdirSync(DESTINO, { recursive: true })
    // Escreve em temporario e move: o painel le esses arquivos o tempo
    // todo e pegaria JSON pela metade.
    const tmp = join(DESTINO, `.${sessao}.tmp`)
    writeFileSync(tmp, entrada, 'utf8')
    renameSync(tmp, join(DESTINO, `${sessao}.json`))
  } catch {
    /* disco cheio ou permissao: a barra ainda tem que aparecer */
  }
}

/** A statusline que existia antes, quando havia uma. */
function anterior() {
  try {
    const c = JSON.parse(readFileSync(CONFIG, 'utf8'))
    return typeof c.original === 'string' && c.original.trim() ? c.original : null
  } catch {
    return null
  }
}

/** Barra minima, para quando nao havia statusline nenhuma antes. */
function barraPadrao(entrada) {
  try {
    const d = JSON.parse(entrada)
    const modelo = d.model?.display_name ?? 'Claude'
    const ctx = d.context_window?.used_percentage
    const cinco = d.rate_limits?.five_hour?.used_percentage
    const partes = [modelo]
    if (typeof ctx === 'number') partes.push(`ctx:${Math.round(ctx)}%`)
    if (typeof cinco === 'number') partes.push(`5h:${Math.round(cinco)}%`)
    return partes.join(' | ')
  } catch {
    return 'Claude'
  }
}

const entrada = lerEntrada()
guardar(entrada)

const original = anterior()
if (!original) {
  process.stdout.write(barraPadrao(entrada))
  process.exit(0)
}

// Repassa o mesmo stdin para a statusline de antes e deixa a saida dela
// passar. Se ela falhar, cai na barra minima em vez de deixar tudo vazio.
const filho = spawn(original, { shell: true, stdio: ['pipe', 'inherit', 'ignore'] })
filho.on('error', () => {
  process.stdout.write(barraPadrao(entrada))
})
filho.stdin.on('error', () => {})
filho.stdin.end(entrada)
