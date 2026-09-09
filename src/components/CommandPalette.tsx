import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  FolderOpen,
  FolderSymlink,
  GitBranch,
  GitCompare,
  Maximize2,
  Palette,
  PanelRightClose,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Terminal,
  Users,
  X,
  Zap,
} from 'lucide-react'

export interface Command {
  id: string
  label: string
  /** Palavra do grupo, mostrada a esquerda: conta, aba, ir para... */
  group: string
  Icon: LucideIcon
  /** Texto extra que tambem entra na busca, sem aparecer no rotulo. */
  keywords?: string
  hint?: string
  run: () => void
}

interface Props {
  commands: Command[]
  onClose: () => void
}

/**
 * Tudo o que o painel faz, alcancavel sem tirar a mao do teclado. A busca e
 * por subsequencia, entao "lgc2" encontra "logar conta 2".
 */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const filtrados = useMemo(() => {
    const alvo = query.trim().toLowerCase()
    if (!alvo) return commands
    return commands
      .map((c) => ({ c, nota: pontuar(`${c.group} ${c.label} ${c.keywords ?? ''}`.toLowerCase(), alvo) }))
      .filter((x) => x.nota > 0)
      .sort((a, b) => b.nota - a.nota)
      .map((x) => x.c)
  }, [commands, query])

  useEffect(() => setCursor(0), [query])
  useEffect(() => inputRef.current?.focus(), [])

  // Mantem o item selecionado dentro da area visivel ao navegar de teclado.
  useEffect(() => {
    listRef.current?.querySelector('.cmd__row.is-on')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return onClose()
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setCursor((i) => Math.min(i + 1, filtrados.length - 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setCursor((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const escolhido = filtrados[cursor]
      if (escolhido) {
        onClose()
        escolhido.run()
      }
    }
  }

  return (
    <div className="cmd__backdrop" onMouseDown={onClose}>
      <div className="cmd" role="dialog" aria-label="Comandos" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd__search">
          <Search size={14} strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            placeholder="o que voce quer fazer"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>esc</kbd>
        </div>

        <ul className="cmd__list" ref={listRef}>
          {filtrados.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={`cmd__row${i === cursor ? ' is-on' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  onClose()
                  c.run()
                }}
              >
                <c.Icon size={13} strokeWidth={1.9} />
                <span className="cmd__group">{c.group}</span>
                <span className="cmd__label">{c.label}</span>
                {c.hint && <span className="cmd__hint">{c.hint}</span>}
              </button>
            </li>
          ))}
          {filtrados.length === 0 && <li className="cmd__none">nada com esse nome</li>}
        </ul>
      </div>
    </div>
  )
}

/**
 * Casamento por subsequencia: cada letra da busca precisa aparecer na
 * ordem. Letras vizinhas valem mais, entao "conta" ganha de "c-o-n-t-a"
 * espalhado no texto.
 */
function pontuar(texto: string, busca: string): number {
  let nota = 0
  let i = 0
  let anterior = -2
  for (const letra of busca) {
    const achou = texto.indexOf(letra, i)
    if (achou < 0) return 0
    nota += achou === anterior + 1 ? 3 : 1
    anterior = achou
    i = achou + 1
  }
  return nota
}

export const CMD_ICONS = {
  Terminal,
  Users,
  GitBranch,
  GitCompare,
  SlidersHorizontal,
  FolderOpen,
  FolderSymlink,
  Plus,
  Pencil,
  X,
  Zap,
  Palette,
  PanelRightClose,
  Maximize2,
}
