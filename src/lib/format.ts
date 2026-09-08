import type { Account } from '../types'
import { WINDOW_MS } from '../types'

export function msUntilReset(account: Account, at: number): number | null {
  if (account.resetAt === null) return null
  return Math.max(0, account.resetAt - at)
}

/** Fracao da janela de 5h ja decorrida, de 0 a 1. */
export function windowRatio(account: Account, at: number): number {
  const remaining = msUntilReset(account, at)
  if (remaining === null) return 0
  return 1 - remaining / WINDOW_MS
}

export type AccountStatus = 'active' | 'limited' | 'ready' | 'cooling'

export function getStatus(account: Account, at: number): AccountStatus {
  if (account.rateLimited) return 'limited'
  if (account.active) return 'active'
  return msUntilReset(account, at) === null ? 'ready' : 'cooling'
}

export const STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'ativa',
  limited: 'limite atingido',
  // "janela cheia" lia como quota esgotada, que e o oposto do que o estado
  // significa: a conta tem as 5h inteiras pela frente.
  ready: 'disponivel',
  cooling: 'janela em uso',
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 3) return 'agora'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export interface Ritmo {
  /** Tokens por hora no que ja passou da janela. */
  porHora: number
  /** Total projetado ate o reset, mantido este ritmo. */
  projetado: number
}

/**
 * Ritmo de consumo da janela e a projecao ate o reset.
 *
 * Nao existe teto conhecido para comparar: o plano nao publica o numero e o
 * app nunca fala com a API. Entao a projecao diz quanto vai ter gasto, e
 * nao quando vai bater a parede — dizer a segunda coisa exigiria inventar
 * um limite.
 */
export function ritmoDaJanela(account: Account, at: number): Ritmo | null {
  if (account.windowStartedAt === null || account.tokensUsed === 0) return null
  const decorrido = at - account.windowStartedAt
  // Menos de um minuto de janela nao da ritmo: dividir por um numero quase
  // zero produzia projecoes absurdas nos primeiros segundos.
  if (decorrido < 60_000) return null

  const porHora = (account.tokensUsed / decorrido) * 3_600_000
  const restante = msUntilReset(account, at) ?? 0
  return { porHora, projetado: account.tokensUsed + (porHora * restante) / 3_600_000 }
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  return `${user.slice(0, 3)}${'*'.repeat(Math.max(3, user.length - 3))}@${domain}`
}
