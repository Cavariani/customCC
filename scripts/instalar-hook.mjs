#!/usr/bin/env node
/**
 * Instala o hook que captura a cota real da API.
 *
 * Roda no `npm install` e tambem sozinho, com `npm run hook`. E idempotente
 * e nao carrega segredo nenhum: o `.env` com os tokens continua fora do
 * repositorio de proposito.
 *
 * O que ele faz:
 *  1. copia hooks/statusline-quota.mjs para ~/.claude
 *  2. guarda a statusline que ja existia em ~/.claude/customcc-statusline.json
 *  3. aponta a statusline do Claude Code para o hook
 *
 * O passo 2 e o que faz a barra continuar igual: o hook chama a antiga e
 * deixa a saida dela passar. Guardar num arquivo separado, em vez de
 * embutir na linha de comando, evita ter que escapar aspas de um comando
 * dentro de outro — que e onde isso quebraria no Windows.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const claudeHome = join(homedir(), '.claude')
const destino = join(claudeHome, 'statusline-quota.mjs')
const settings = join(claudeHome, 'settings.json')
const config = join(claudeHome, 'customcc-statusline.json')

// Aspas em volta do caminho: "Documents/Programação" tem acento, e no
// Windows o caminho quase sempre tem espaco.
const comando = `node "${destino}"`

if (!existsSync(claudeHome)) {
  console.log('[customcc] ~/.claude ainda nao existe.')
  console.log('[customcc] rode o `claude` uma vez e depois `npm run hook`.')
  process.exit(0)
}

mkdirSync(join(homedir(), '.claude-multi-account', 'quota'), { recursive: true })
copyFileSync(join(raiz, 'hooks', 'statusline-quota.mjs'), destino)

let cfg = {}
if (existsSync(settings)) {
  try {
    cfg = JSON.parse(readFileSync(settings, 'utf8'))
  } catch {
    console.error('[customcc] ~/.claude/settings.json nao e JSON valido; nao vou mexer nele.')
    console.error(`[customcc] o hook foi copiado para ${destino}, mas ninguem vai chama-lo.`)
    process.exit(0)
  }
}

const atual = typeof cfg.statusLine?.command === 'string' ? cfg.statusLine.command : ''

if (atual.includes('statusline-quota')) {
  console.log('[customcc] hook de cota ja estava ligado.')
  process.exit(0)
}

// Guarda a statusline de antes para o hook poder chama-la. Um objeto vazio
// quando nao havia nenhuma: o hook entao desenha a barra minima.
writeFileSync(config, `${JSON.stringify({ original: atual }, null, 2)}\n`, 'utf8')

// Copia do settings antes de mexer: este arquivo e do Claude Code.
if (existsSync(settings)) copyFileSync(settings, `${settings}.antes-do-customcc`)

cfg.statusLine = { ...(cfg.statusLine ?? {}), type: 'command', command: comando }
writeFileSync(settings, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8')

console.log('[customcc] hook de cota instalado.')
console.log(`[customcc]   hook     ${destino}`)
if (atual) console.log(`[customcc]   anterior ${config}`)
console.log(`[customcc]   copia    ${settings}.antes-do-customcc`)
console.log('[customcc] abra uma sessao nova do claude para a cota comecar a aparecer.')
