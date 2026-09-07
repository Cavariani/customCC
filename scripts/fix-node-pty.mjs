/**
 * Os prebuilds do node-pty chegam sem o bit de execucao no `spawn-helper`,
 * e sem ele todo pty.spawn morre com "posix_spawnp failed". Rodar isso no
 * postinstall evita que o bug volte a cada npm install.
 */
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const base = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds')
const targets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']

for (const platform of targets) {
  const helper = join(base, platform, 'spawn-helper')
  if (existsSync(helper)) {
    chmodSync(helper, 0o755)
    console.log(`[fix-node-pty] +x ${platform}/spawn-helper`)
  }
}
