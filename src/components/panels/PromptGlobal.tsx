import { useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, Save } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'

/**
 * Instrucao que vale para toda sessao de `claude`, de todo projeto.
 *
 * O painel nao fala com a API, entao nao ha "system prompt" para injetar. O
 * que existe e o arquivo de memoria do usuario, `~/.claude/CLAUDE.md`, que
 * o Claude Code carrega em qualquer pasta. Este campo escreve num bloco
 * delimitado dentro dele, sem encostar no que ja estiver la.
 *
 * Duas consequencias que a tela precisa dizer, porque sao a diferenca entre
 * funcionar e parecer quebrado:
 *
 *   1. o arquivo e lido no inicio da sessao, entao aba que ja esta de pe so
 *      ve o texto novo depois de renascer — dai o botao de recarregar;
 *   2. vale tambem para o `claude` aberto fora do painel, em qualquer
 *      terminal, porque o arquivo e do usuario e nao deste projeto.
 */
export function PromptGlobal() {
  const { tabs, restartTab } = useWorkspace()
  const [texto, setTexto] = useState('')
  const [caminho, setCaminho] = useState('')
  const [gravado, setGravado] = useState('')
  const [estado, setEstado] = useState<'lendo' | 'pronto' | 'gravando' | 'recarregando'>('lendo')
  const [erro, setErro] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    fetch('/api/prompt-global')
      .then((r) => r.json())
      .then((d) => {
        setTexto(d.texto ?? '')
        setGravado(d.texto ?? '')
        setCaminho(d.caminho ?? '')
        setEstado('pronto')
      })
      .catch((e) => {
        setErro(String(e))
        setEstado('pronto')
      })
  }, [])

  const sujo = texto !== gravado

  const salvar = async () => {
    setEstado('gravando')
    setErro(null)
    try {
      const resposta = await fetch('/api/prompt-global', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto }),
      })
      const dado = await resposta.json()
      if (!resposta.ok) throw new Error(dado.error ?? `HTTP ${resposta.status}`)
      setGravado(dado.texto)
      setTexto(dado.texto)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setEstado('pronto')
      if (timer.current) window.clearTimeout(timer.current)
    }
  }

  const recarregar = async () => {
    setEstado('recarregando')
    setErro(null)
    try {
      // Uma aba de cada vez: tres processos morrendo e nascendo ao mesmo
      // tempo disputam a mesma descoberta de id de conversa.
      for (const aba of tabs) {
        await restartTab(aba.id, 'prompt global aplicado, conversa retomada').catch(() => {})
      }
    } finally {
      setEstado('pronto')
    }
  }

  return (
    <section className="group">
      <h4 className="group__title">prompt global</h4>

      <textarea
        className="promptbox"
        rows={6}
        maxLength={8000}
        spellCheck={false}
        placeholder="Seja objetivo nas respostas. Va direto ao ponto."
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        // O terminal ouve atalhos em captura; sem isto, cmd+K aqui dentro
        // abriria a paleta de comandos no meio de uma frase.
        onKeyDown={(e) => e.stopPropagation()}
      />

      <div className="promptbox__acoes">
        <button
          type="button"
          className="wide-btn"
          disabled={!sujo || estado === 'gravando'}
          onClick={() => void salvar()}
        >
          {sujo ? <Save size={13} strokeWidth={2} /> : <Check size={13} strokeWidth={2} />}
          {estado === 'gravando' ? 'gravando…' : sujo ? 'salvar' : 'salvo'}
        </button>

        <button
          type="button"
          className="wide-btn wide-btn--ghost"
          disabled={estado === 'recarregando' || tabs.length === 0}
          onClick={() => void recarregar()}
          title="derruba e sobe o claude de cada aba retomando a mesma conversa"
        >
          <RefreshCw size={13} strokeWidth={2} />
          {estado === 'recarregando' ? 'recarregando…' : `aplicar nas ${tabs.length} abas abertas`}
        </button>
      </div>

      {erro && <p className="view__note view__note--erro">{erro}</p>}

      <p className="view__note">
        vai para o fim de <code>{caminho || '~/.claude/CLAUDE.md'}</code>, num bloco proprio: o que
        voce ja tinha escrito la continua intacto. sessao nova ja nasce com ele; as que estao
        abertas so depois de recarregar.
      </p>
    </section>
  )
}
