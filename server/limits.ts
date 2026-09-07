/**
 * Deteccao de limite lendo o que o Claude Code desenha no terminal.
 *
 * As frases e o formato de horario abaixo foram extraidos do proprio binario
 * (claude 2.1.263), nao inventados. O formatador de reset e:
 *   < 24h:  toLocaleTimeString en-US, hour12, am/pm minusculo  -> "3pm", "3:30pm"
 *   > 24h:  + mes e dia                                        -> "Sep 7, 3pm"
 * e pode vir com o fuso entre parenteses no fim.
 */

export type LimitKind = 'reached' | 'cleared' | 'credits' | 'hint'

export interface LimitSignal {
  kind: LimitKind
  /** Momento do reset, quando a mensagem informa. */
  resetAt: number | null
  /** Trecho que casou, para a UI poder mostrar o porque. */
  evidence: string
}

/** Remove ANSI, OSC e os caracteres de moldura que a TUI desenha. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][AB0]/g, '')
    .replace(/\x1b[=>]/g, '')
}

/**
 * A frase so conta quando abre a linha. O Claude Code a renderiza como um
 * aviso fixado, enquanto em prosa (inclusive numa resposta do proprio
 * Claude falando sobre limites) ela apareceria no meio da frase.
 */
const LINE_PREFIX = '^[\\s\\u2500-\\u257f>|·•⏵⚠✳*-]*'

const REACHED = new RegExp(`${LINE_PREFIX}Usage limit reached\\b`, 'i')
const CLEARED = new RegExp(`${LINE_PREFIX}Your usage limit has reset\\b`, 'i')
const CREDITS = new RegExp(`${LINE_PREFIX}(?:You're|Your organization is|Your org is) out of usage credits\\b`, 'i')

/**
 * O horario de reset tambem aparece fora da frase de limite, por exemplo no
 * aviso de lower-priority mode. Vale colher: e um dado real de reset, ainda
 * que a conta nao esteja bloqueada.
 */
// {1,24} e nao {2,24}: "3pm" tem um unico caractere antes do meridiano.
const RESET_AT = /(?:continuing automatically at|limit resets at)\s+([A-Za-z0-9:,\s]{1,24}?(?:am|pm))/i

export function parseResetTime(raw: string, now = Date.now()): number | null {
  const text = raw.trim().replace(/\s+/g, ' ')
  const match = text.match(
    /^(?:([A-Za-z]{3})\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i,
  )
  if (!match) return null

  const [, monthName, dayText, hourText, minuteText, meridiem] = match
  let hour = Number(hourText) % 12
  if (meridiem.toLowerCase() === 'pm') hour += 12
  const minute = minuteText ? Number(minuteText) : 0

  const base = new Date(now)
  const target = new Date(base)
  target.setSeconds(0, 0)
  target.setHours(hour, minute)

  if (monthName) {
    const month = MONTHS.indexOf(monthName.toLowerCase().slice(0, 3))
    if (month < 0) return null
    target.setMonth(month, Number(dayText))
    // Sem ano na mensagem: se cair no passado, e do ano que vem.
    if (target.getTime() < now) target.setFullYear(target.getFullYear() + 1)
    return target.getTime()
  }

  // Só o horario: sempre a proxima ocorrencia dele.
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime()
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Varre um pedaco de terminal ja sem ANSI e devolve o sinal mais recente. */
export function detectLimit(chunk: string, now = Date.now()): LimitSignal | null {
  const clean = stripAnsi(chunk)
  let signal: LimitSignal | null = null

  for (const line of clean.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (CLEARED.test(trimmed)) {
      signal = { kind: 'cleared', resetAt: null, evidence: shorten(trimmed) }
      continue
    }
    if (CREDITS.test(trimmed)) {
      signal = { kind: 'credits', resetAt: null, evidence: shorten(trimmed) }
      continue
    }
    const at = trimmed.match(RESET_AT)
    if (REACHED.test(trimmed)) {
      signal = {
        kind: 'reached',
        resetAt: at ? parseResetTime(at[1], now) : null,
        evidence: shorten(trimmed),
      }
      continue
    }

    // Horario de reset sem bloqueio: so melhora a precisao do contador.
    if (at && signal === null) {
      const resetAt = parseResetTime(at[1], now)
      if (resetAt !== null) signal = { kind: 'hint', resetAt, evidence: shorten(trimmed) }
    }
  }

  return signal
}

function shorten(line: string): string {
  const clean = line.replace(/\s+/g, ' ').trim()
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean
}
