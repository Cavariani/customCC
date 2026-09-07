#!/usr/bin/env node
/**
 * Instala o painel como servico que sobe no login. No macOS via launchd; no
 * Windows via Task Scheduler. O servico so escuta em loopback, entao ficar
 * ligado o tempo todo nao expoe nada na rede.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const action = process.argv[2] ?? 'install'
const LABEL = 'com.pedrocavariani.customcc'

if (process.platform === 'darwin') macos()
else if (process.platform === 'win32') windows()
else {
  console.error(`[customcc] servico automatico nao implementado para ${process.platform}.`)
  console.error(`Rode manualmente: node ${join(root, 'bin', 'customcc.mjs')} --no-open`)
  process.exit(1)
}

function macos() {
  const dir = join(homedir(), 'Library', 'LaunchAgents')
  const plist = join(dir, `${LABEL}.plist`)

  if (action === 'uninstall') {
    spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${LABEL}`], { stdio: 'ignore' })
    if (existsSync(plist)) rmSync(plist)
    console.log(`[customcc] servico removido (${plist})`)
    return
  }

  mkdirSync(dir, { recursive: true })
  const logs = join(homedir(), '.claude-multi-account')
  mkdirSync(logs, { recursive: true })

  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${join(root, 'bin', 'customcc.mjs')}</string>
    <string>--no-open</string>
  </array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logs, 'customcc.log')}</string>
  <key>StandardErrorPath</key><string>${join(logs, 'customcc.error.log')}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${process.env.PATH ?? '/usr/bin:/bin'}</string></dict>
</dict>
</plist>
`,
    'utf8',
  )

  const uid = process.getuid?.() ?? 501
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' })
  const boot = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'inherit' })
  if (boot.status !== 0) {
    console.error('[customcc] launchctl recusou o servico. Plist escrito em:', plist)
    process.exit(1)
  }
  console.log(`[customcc] servico instalado, sobe no login.
  painel:  http://localhost:5181
  log:     ${join(logs, 'customcc.log')}
  remover: node scripts/service.mjs uninstall`)
}

function windows() {
  const name = 'customCC'
  if (action === 'uninstall') {
    spawnSync('schtasks', ['/Delete', '/TN', name, '/F'], { stdio: 'inherit' })
    return
  }
  const cmd = `"${process.execPath}" "${join(root, 'bin', 'customcc.mjs')}" --no-open`
  const result = spawnSync(
    'schtasks',
    ['/Create', '/TN', name, '/TR', cmd, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`[customcc] tarefa "${name}" criada, sobe no login. Remover: node scripts/service.mjs uninstall`)
}
