import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Nome da area, para a mensagem dizer o que caiu. */
  area: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Contem a queda de um pedaco da interface.
 *
 * Sem isto, qualquer excecao durante o render sobe ate a raiz e o React
 * desmonta a arvore inteira: a tela fica cinza, sem uma palavra de
 * explicacao. Aconteceu de verdade — um addon do terminal lancou de dentro
 * do `activate` e levou junto o painel, as abas e a barra de status, que
 * nao tinham nada a ver com o problema.
 *
 * Cada area vive na sua propria caixa, entao o terminal pode cair sem
 * derrubar o git, e o painel de contas pode cair sem derrubar o terminal.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[customcc] ${this.props.area} caiu:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="boom">
        <p className="boom__titulo">{this.props.area} parou de responder</p>
        {/* A mensagem crua vale mais que um texto amigavel: e ela que diz
            onde olhar, e o resto do app continua de pe para investigar. */}
        <pre className="boom__detalhe">{error.message}</pre>
        <button type="button" className="boom__acao" onClick={() => this.setState({ error: null })}>
          tentar de novo
        </button>
      </div>
    )
  }
}
