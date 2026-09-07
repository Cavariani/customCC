import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { CLAUDE_HOME } from './transcript.js'

const PROJECTS_DIR = join(CLAUDE_HOME, 'projects')

export interface RecentProject {
  cwd: string
  name: string
  lastUsedAt: number
  sessions: number
}

/**
 * Projetos onde o Claude Code ja rodou. O slug do diretorio e lossy (todo
 * caractere nao alfanumerico vira hifen), entao o caminho real vem do campo
 * `cwd` de dentro do proprio transcript, nao de tentar desfazer o slug.
 */
export async function listRecentProjects(limit = 24): Promise<RecentProject[]> {
  let dirs: string[]
  try {
    dirs = await readdir(PROJECTS_DIR)
  } catch {
    return []
  }

  const found = new Map<string, RecentProject>()

  for (const dir of dirs) {
    const full = join(PROJECTS_DIR, dir)
    let files: string[]
    try {
      files = (await readdir(full)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    if (files.length === 0) continue

    let newest = { file: '', mtime: 0 }
    for (const file of files) {
      const info = await stat(join(full, file)).catch(() => null)
      if (info && info.mtimeMs > newest.mtime) newest = { file: join(full, file), mtime: info.mtimeMs }
    }
    if (!newest.file) continue

    const cwd = await readCwd(newest.file)
    // Projeto apagado do disco nao serve de atalho.
    if (!cwd || !existsSync(cwd)) continue

    const name = cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd
    const current = found.get(cwd)
    if (!current || current.lastUsedAt < newest.mtime) {
      found.set(cwd, { cwd, name, lastUsedAt: newest.mtime, sessions: files.length })
    }
  }

  return [...found.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, limit)
}

/** Le so o comeco do arquivo: o cwd aparece logo nas primeiras entradas. */
async function readCwd(file: string): Promise<string | null> {
  let head: string
  try {
    head = (await readFile(file, 'utf8')).slice(0, 40_000)
  } catch {
    return null
  }
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as { cwd?: unknown }
      if (typeof entry.cwd === 'string' && entry.cwd) return entry.cwd
    } catch {
      continue
    }
  }
  return null
}
