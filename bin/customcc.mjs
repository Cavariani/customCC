#!/usr/bin/env node
/**
 * Sobe o painel apontando para a pasta onde o comando foi chamado, e abre o
 * navegador. O servidor entrega o frontend ja buildado, entao o uso diario
 * nao depende do Vite rodando numa janela de terminal.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

if (args[0] === 'help' || args.includes('--help') || args.includes('-h')) {
  console.log(`customcc [pasta] [--port N] [--no-open] [--service install|uninstall]

  sem argumento  abre na pasta atual
  --port N       porta do servidor (padrao 5181)
  --no-open      nao abre o navegador
  --service      instala ou remove o servico que sobe no login`)
  process.exit(0)
}

if (args[0] === '--service' || args[0] === 'service') {
  const action = args[1] ?? 'install'
  const script = join(root, 'scripts', 'service.mjs')
  const result = spawnSync(process.execPath, [script, action], { stdio: 'inherit', cwd: root })
  process.exit(result.status ?? 0)
}

const portFlag = args.indexOf('--port')
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 5181
const folderArg = args.find((a) => !a.startsWith('--') && a !== String(port))
const cwd = folderArg ? resolve(folderArg) : process.cwd()

if (!existsSync(cwd)) {
  console.error(`[customcc] pasta nao encontrada: ${cwd}`)
  process.exit(1)
}

// Sem dist o painel nao tem o que servir; buildar uma vez resolve.
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log('[customcc] primeira execucao, compilando o frontend...')
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const entry = join(root, 'server', 'index.ts')
const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')

const child = spawn(tsx, [entry], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, CUSTOMCC_CWD: cwd, CUSTOMCC_PORT: String(port) },
})

const url = `http://localhost:${port}`
if (!args.includes('--no-open')) {
  setTimeout(() => {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref()
  }, 1200)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
    process.exit(0)
  })
}

child.on('exit', (code) => process.exit(code ?? 0))
