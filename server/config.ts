import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export const PORT = Number(process.env.CUSTOMCC_PORT ?? 5181)

/** Raiz padrao onde o `claude` sobe quando a aba nao diz outra coisa. */
export const DEFAULT_CWD = process.env.CUSTOMCC_CWD
  ? resolve(process.env.CUSTOMCC_CWD)
  : process.cwd()

export const IS_WINDOWS = process.platform === 'win32'

/**
 * Caminho do binario real do Claude Code. O projeto nunca fala com a API
 * direto: tudo passa por este executavel, rodando dentro de um pty.
 */
export function resolveClaudeBin(): string {
  if (process.env.CUSTOMCC_CLAUDE_BIN) return process.env.CUSTOMCC_CLAUDE_BIN
  try {
    // `where` e o equivalente do `which` no Windows e pode devolver varias
    // linhas.
    const cmd = IS_WINDOWS ? 'where' : 'which'
    const out = execFileSync(cmd, ['claude'], { encoding: 'utf8', shell: IS_WINDOWS })
    const linhas = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (linhas.length === 0) throw new Error('vazio')
    if (!IS_WINDOWS) return linhas[0]

    // No Windows um npm global instala tres arquivos com o mesmo nome:
    // `claude` (script sh, para Git Bash), `claude.cmd` e `claude.ps1`. O
    // `where` lista os tres e o sem extensao costuma vir primeiro — que e
    // justamente o unico que o ConPTY nao consegue executar. Preferimos o
    // que o Windows sabe rodar sozinho.
    const executavel = linhas.find((l) => /\.(cmd|bat|exe)$/i.test(l))
    return executavel ?? linhas[0]
  } catch {
    throw new Error(
      'binario `claude` nao encontrado no PATH. Instale o Claude Code ou defina CUSTOMCC_CLAUDE_BIN.',
    )
  }
}

export function expandHome(p: string): string {
  if (!p.startsWith('~')) return resolve(p)
  return resolve(homedir(), p.slice(1).replace(/^[/\\]/, ''))
}
