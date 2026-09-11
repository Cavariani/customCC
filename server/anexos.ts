import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Imagens coladas ou arrastadas para dentro do terminal.
 *
 * O caminho oficial do Claude Code para imagem e o alt+v do proprio
 * terminal, que devolve um `[Image 1]` sem preview. Aqui o navegador ja tem
 * o arquivo na mao: salvamos em disco e escrevemos o caminho no pty, que e
 * uma forma que o `claude` le igual. A miniatura fica na casca, que e onde
 * ela serve para alguma coisa.
 */
export const ANEXOS_DIR = join(homedir(), '.claude-multi-account', 'anexos')

/** Anexo velho nao serve para nada e a pasta nao pode crescer sem fim. */
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000

const EXTENSOES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

export function extensaoDe(mime: string): string | null {
  return EXTENSOES[(mime ?? '').split(';')[0].trim().toLowerCase()] ?? null
}

/** Nome de arquivo que o navegador pode pedir de volta sem abrir brecha. */
export function nomeSeguro(nome: string): boolean {
  return /^[\w.-]+$/.test(nome) && !nome.includes('..')
}

export async function salvarAnexo(
  dados: Buffer,
  mime: string,
): Promise<{ arquivo: string; caminho: string }> {
  const ext = extensaoDe(mime)
  if (!ext) throw new Error(`tipo de imagem nao aceito: ${mime}`)

  await mkdir(ANEXOS_DIR, { recursive: true })
  const agora = new Date()
  const carimbo = agora.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  // Sufixo aleatorio: duas imagens coladas no mesmo segundo se
  // sobrescreveriam, e a segunda apareceria como a primeira.
  const arquivo = `${carimbo}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const caminho = join(ANEXOS_DIR, arquivo)
  await writeFile(caminho, dados)
  void limparVelhos()
  return { arquivo, caminho }
}

/** Varre a pasta e apaga o que passou da validade. Falha em silencio. */
export async function limparVelhos(agora = Date.now()): Promise<number> {
  let apagados = 0
  try {
    for (const nome of await readdir(ANEXOS_DIR)) {
      const alvo = join(ANEXOS_DIR, nome)
      const info = await stat(alvo).catch(() => null)
      if (!info || agora - info.mtimeMs < VALIDADE_MS) continue
      await unlink(alvo).catch(() => {})
      apagados += 1
    }
  } catch {
    /* pasta ainda nao existe */
  }
  return apagados
}
