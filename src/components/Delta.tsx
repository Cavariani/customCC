interface Props {
  added: number
  removed: number
  /** Mostra a proporcao entre adicao e remocao como uma barra. */
  bar?: boolean
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Linhas adicionadas e removidas. Sao o numero que o Pedro mais procura na
 * tela, entao ganham peso proprio em vez de virar texto miudo ao lado do
 * caminho do arquivo.
 */
export function Delta({ added, removed, bar = false, size = 'sm' }: Props) {
  const total = added + removed
  const share = total === 0 ? 0 : (added / total) * 100

  // Zero nao ganha chip: "-0" ocupa largura para dizer que nada aconteceu.
  return (
    <span className={`delta delta--${size}`}>
      {(added > 0 || total === 0) && <span className="delta__add">+{added}</span>}
      {removed > 0 && <span className="delta__del">-{removed}</span>}
      {bar && total > 0 && (
        <span className="delta__bar" aria-hidden="true">
          <span className="delta__bar-add" style={{ width: `${share}%` }} />
          <span className="delta__bar-del" style={{ width: `${100 - share}%` }} />
        </span>
      )}
    </span>
  )
}
