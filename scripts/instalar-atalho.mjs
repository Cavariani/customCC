#!/usr/bin/env node
/**
 * Cria o atalho do painel no Windows: area de trabalho e menu Iniciar.
 *
 * Clicar nele sobe o servidor, se preciso, e abre o painel numa janela de
 * aplicativo. Nao instala servico nem mexe em inicializacao automatica: e um
 * atalho comum, entao nao depende de permissao especial nem de politica da
 * maquina liberar o Agendador de Tarefas.
 *
 * Comandos:
 *   node scripts/instalar-atalho.mjs             cria
 *   node scripts/instalar-atalho.mjs desinstalar  remove
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PIXELS } from '../src/theme/favicon.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const acao = process.argv[2] ?? 'instalar'
const NOME = 'customCC'

if (process.platform !== 'win32') {
  console.error('[customcc] este atalho e do Windows. No macOS use: node scripts/service.mjs')
  process.exit(1)
}

/* ── Onde as coisas ficam ────────────────────────────────────────────────── */

const suporte = join(homedir(), '.claude-multi-account')
const vbs = join(suporte, 'abrir-customcc.vbs')
const ico = join(suporte, 'customcc.ico')

/**
 * As duas pastas de atalho, perguntadas ao Windows em vez de montadas na
 * mao: com o OneDrive ligado a area de trabalho nao e ~/Desktop, e um
 * caminho chutado criaria o atalho numa pasta que ninguem ve.
 */
function pastaEspecial(nome) {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `[Environment]::GetFolderPath('${nome}')`],
    { encoding: 'utf8' },
  )
  return r.stdout?.trim() || null
}

const desktop = pastaEspecial('Desktop')
const menu = pastaEspecial('Programs')
const atalhos = [desktop && join(desktop, `${NOME}.lnk`), menu && join(menu, `${NOME}.lnk`)].filter(
  Boolean,
)

/* ── Desinstalar ─────────────────────────────────────────────────────────── */

if (acao === 'desinstalar' || acao === 'uninstall') {
  for (const caminho of [...atalhos, vbs, ico]) {
    if (existsSync(caminho)) {
      rmSync(caminho)
      console.log(`[customcc] removido: ${caminho}`)
    }
  }
  console.log('[customcc] atalho desinstalado. O servidor, se estiver rodando, continua no ar.')
  process.exit(0)
}

/* ── O .ico, desenhado a partir do mascote do painel ─────────────────────── */

/**
 * Escreve um .ico com uma imagem BMP de 32 bits (com canal alfa). O formato
 * pede a altura dobrada no cabecalho — a metade de baixo seria a mascara AND,
 * que fica zerada porque a transparencia ja vem do alfa — e as linhas de
 * baixo para cima.
 */
function escreverIco(caminho, lado, pixelAt) {
  const cabBmp = 40
  const dados = lado * lado * 4
  const mascara = (lado * lado) / 8 // 1 bit por pixel, zerada
  const bmp = Buffer.alloc(cabBmp + dados + mascara)

  bmp.writeUInt32LE(cabBmp, 0)
  bmp.writeInt32LE(lado, 4)
  bmp.writeInt32LE(lado * 2, 8) // altura dobrada: imagem + mascara
  bmp.writeUInt16LE(1, 12) // planos
  bmp.writeUInt16LE(32, 14) // bits por pixel
  bmp.writeUInt32LE(dados + mascara, 20)

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      // BMP guarda de baixo para cima.
      const destino = cabBmp + ((lado - 1 - y) * lado + x) * 4
      const [r, g, b, a] = pixelAt(x, y)
      bmp[destino] = b
      bmp[destino + 1] = g
      bmp[destino + 2] = r
      bmp[destino + 3] = a
    }
  }

  const dir = Buffer.alloc(6 + 16)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2) // tipo 1 = icone
  dir.writeUInt16LE(1, 4) // uma imagem
  dir[6] = lado === 256 ? 0 : lado // 0 significa 256
  dir[7] = lado === 256 ? 0 : lado
  dir[8] = 0 // paleta
  dir[10] = 1
  dir.writeUInt16LE(32, 12)
  dir.writeUInt32LE(bmp.length, 14)
  dir.writeUInt32LE(dir.length, 18)

  writeFileSync(caminho, Buffer.concat([dir, bmp]))
}

// Cores do tema `original`, que e o padrao do painel: mascote em azul claro
// sobre o cinza-azul do fundo. Fundo opaco, e nao transparente, porque na
// barra de tarefas clara um mascote azul sozinho quase some.
const FUNDO = [0x28, 0x2c, 0x34]
const TRACO = [0x9c, 0xde, 0xf2]
const LADO = 64
const ESCALA = LADO / 16 // a grade do mascote e 16x16

escreverIco(ico, LADO, (x, y) => {
  const gx = Math.floor(x / ESCALA)
  const gy = Math.floor(y / ESCALA)
  const aceso = PIXELS[gy]?.[gx] === '#'
  return aceso ? [...TRACO, 255] : [...FUNDO, 255]
})

/* ── O lancador escondido ────────────────────────────────────────────────── */

/**
 * O atalho nao chama o node direto: um processo de console abriria uma
 * janela preta piscando na cara toda vez. O wscript roda o comando com
 * janela oculta (o 0 no Run) e sem esperar (o False).
 */
mkdirSync(suporte, { recursive: true })
writeFileSync(
  vbs,
  `' Gerado por scripts/instalar-atalho.mjs. Abre o painel sem janela de console.\r\n` +
    `Set sh = CreateObject("WScript.Shell")\r\n` +
    `sh.Run """${process.execPath}"" ""${join(root, 'scripts', 'abrir.mjs')}""", 0, False\r\n`,
  'latin1',
)

/* ── Os atalhos ──────────────────────────────────────────────────────────── */

const ps = atalhos
  .map(
    (caminho) => `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${caminho}')
$s.TargetPath = 'C:\\Windows\\System32\\wscript.exe'
$s.Arguments = '"${vbs}"'
$s.WorkingDirectory = '${root}'
$s.IconLocation = '${ico},0'
$s.Description = 'Abre o painel customCC'
$s.Save()`,
  )
  .join('\n')

const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error('[customcc] o Windows recusou criar o atalho.')
  process.exit(r.status ?? 1)
}

console.log(`[customcc] atalho criado.`)
for (const a of atalhos) console.log(`  ${a}`)
console.log(`
  Um clique sobe o painel, se preciso, e abre a janela.
  Fixe na barra de tarefas: clique com o direito no atalho > Fixar.

  log:      ${join(suporte, 'customcc.log')}
  remover:  npm run atalho -- desinstalar`)
