import { useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  FolderSymlink,
  Maximize2,
  Minimize2,
  Plus,
  TerminalSquare,
  X,
} from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import { useFullscreen } from '../lib/useFullscreen'
import { CORES_DE_ABA, type CorDeAba } from '../lib/tabMeta'
import { FolderPicker } from './FolderPicker'
import { TabStatus, ROTULO_DE_ESTADO, estadoDaAba } from './TabStatus'

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    openTab,
    closeTab,
    renameTab,
    colorTab,
    reorderTab,
    moveTab,
    tabStatus,
    tabActivity,
    tabDone,
  } = useWorkspace()
  const [editing, setEditing] = useState<string | null>(null)
  // 'nova' abre outra aba; um id move aquela aba de pasta.
  const [picking, setPicking] = useState<'nova' | string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const arrastando = useRef<string | null>(null)
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen()

  return (
    <div className="tabbar" role="tablist" aria-label="Terminais">
      {tabs.map((tab) => {
        const estado = estadoDaAba(tabStatus[tab.id], tabActivity[tab.id], tabDone[tab.id])
        return (
          <div
            key={tab.id}
            className={`tab tab--${estado}${tab.id === activeTabId ? ' is-active' : ''}${
              tab.cor ? ' has-cor' : ''
            }`}
            // A cor escolhida a mao e identidade de projeto, e nao estado:
            // por isso ela mora na faixa da esquerda e o estado continua no
            // anel da direita. Se as duas pintassem a mesma coisa, uma aba
            // verde nao diria mais se acabou de responder.
            style={
              tab.cor && tab.cor in CORES_DE_ABA
                ? ({ '--cor-da-aba': CORES_DE_ABA[tab.cor as CorDeAba] } as React.CSSProperties)
                : undefined
            }
            draggable={editing !== tab.id}
            onDragStart={(e) => {
              arrastando.current = tab.id
              e.dataTransfer.effectAllowed = 'move'
              // Firefox so inicia o arrasto com algum dado no evento.
              e.dataTransfer.setData('text/plain', tab.id)
            }}
            onDragEnd={() => {
              arrastando.current = null
            }}
            onDragOver={(e) => {
              if (!arrastando.current || arrastando.current === tab.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              // Reordena ao passar por cima, e nao ao soltar: a barra se
              // reorganiza enquanto voce arrasta, entao da para ver onde a
              // aba vai cair antes de largar.
              reorderTab(arrastando.current, tab.id)
            }}
            onDrop={(e) => e.preventDefault()}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ id: tab.id, x: e.clientX, y: e.clientY })
            }}
          >
            {editing === tab.id ? (
              <RenameInput
                initial={tab.title}
                onDone={(value) => {
                  if (value) renameTab(tab.id, value)
                  setEditing(null)
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabId}
                className="tab__main"
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => setEditing(tab.id)}
                title={`${tab.cwd}\n${ROTULO_DE_ESTADO[estado]}\nduplo clique renomeia · botao direito para cor`}
              >
                <TerminalSquare size={13} strokeWidth={1.8} />
                <span className="tab__title">{tab.title}</span>
                <TabStatus estado={estado} />
              </button>
            )}

            {tabs.length > 1 && editing !== tab.id && (
              <button
                type="button"
                className="tab__close"
                aria-label={`Fechar ${tab.title}`}
                onClick={() => closeTab(tab.id)}
              >
                <X size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>
        )
      })}

      <button
        type="button"
        className="tabbar__add"
        onClick={() => openTab()}
        aria-label="Nova aba na mesma pasta"
        title="nova aba na mesma pasta"
      >
        <Plus size={14} strokeWidth={2} />
      </button>

      <button
        type="button"
        className="tabbar__add"
        onClick={() => setPicking('nova')}
        aria-label="Abrir outra pasta em nova aba"
        title="abrir outra pasta em nova aba"
      >
        <FolderOpen size={14} strokeWidth={1.9} />
      </button>

      <button
        type="button"
        className="tabbar__add"
        onClick={() => setPicking(activeTabId)}
        aria-label="Mover esta aba para outra pasta"
        title="mover esta aba para outra pasta"
      >
        <FolderSymlink size={14} strokeWidth={1.9} />
      </button>

      <span className="tabbar__hint">arraste para reordenar · botao direito colore</span>

      <button
        type="button"
        className="tabbar__add"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? 'Sair da tela cheia' : 'Entrar em tela cheia'}
        title={fullscreen ? 'sair da tela cheia  F11' : 'tela cheia  F11'}
      >
        {fullscreen ? (
          <Minimize2 size={14} strokeWidth={1.9} />
        ) : (
          <Maximize2 size={14} strokeWidth={1.9} />
        )}
      </button>

      {menu && (
        <TabMenu
          x={menu.x}
          y={menu.y}
          corAtual={tabs.find((t) => t.id === menu.id)?.cor}
          onCor={(cor) => {
            colorTab(menu.id, cor)
            setMenu(null)
          }}
          onRenomear={() => {
            setEditing(menu.id)
            setMenu(null)
          }}
          onFechar={tabs.length > 1 ? () => {
            closeTab(menu.id)
            setMenu(null)
          } : null}
          onClose={() => setMenu(null)}
        />
      )}

      {picking && (
        <FolderPicker
          onClose={() => setPicking(null)}
          onPick={(cwd) => {
            const alvo = picking
            setPicking(null)
            if (alvo === 'nova') openTab(cwd)
            else if (alvo) moveTab(alvo, cwd)
          }}
        />
      )}
    </div>
  )
}

/** Menu do botao direito: cor, renomear, fechar. */
function TabMenu({
  x,
  y,
  corAtual,
  onCor,
  onRenomear,
  onFechar,
  onClose,
}: {
  x: number
  y: number
  corAtual?: string
  onCor: (cor: CorDeAba | null) => void
  onRenomear: () => void
  onFechar: (() => void) | null
  onClose: () => void
}) {
  useEffect(() => {
    const fecha = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      onClose()
    }
    // No capture: o clique que abre outro menu tambem fecha este.
    window.addEventListener('mousedown', fecha, true)
    window.addEventListener('keydown', fecha, true)
    return () => {
      window.removeEventListener('mousedown', fecha, true)
      window.removeEventListener('keydown', fecha, true)
    }
  }, [onClose])

  return (
    <div
      className="tabmenu"
      // Presa ao cursor, mas nunca alem da borda: uma aba no canto direito
      // abriria o menu para fora da janela.
      style={{ left: Math.min(x, window.innerWidth - 190), top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <div className="tabmenu__cores">
        {(Object.keys(CORES_DE_ABA) as CorDeAba[]).map((nome) => (
          <button
            key={nome}
            type="button"
            className={`tabmenu__cor${corAtual === nome ? ' is-active' : ''}`}
            style={{ '--cor': CORES_DE_ABA[nome] } as React.CSSProperties}
            title={nome}
            aria-label={`cor ${nome}`}
            onClick={() => onCor(nome)}
          />
        ))}
        <button
          type="button"
          className={`tabmenu__cor tabmenu__cor--nenhuma${corAtual ? '' : ' is-active'}`}
          title="sem cor"
          aria-label="sem cor"
          onClick={() => onCor(null)}
        />
      </div>
      <button type="button" className="tabmenu__item" onClick={onRenomear}>
        renomear
      </button>
      {onFechar && (
        <button type="button" className="tabmenu__item tabmenu__item--perigo" onClick={onFechar}>
          fechar aba
        </button>
      )}
    </div>
  )
}

/** Renomeia no lugar: Enter confirma, Esc cancela, sair do campo confirma. */
function RenameInput({
  initial,
  onDone,
}: {
  initial: string
  onDone: (value: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className="tab__rename"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        else if (e.key === 'Escape') onDone(null)
        e.stopPropagation()
      }}
    />
  )
}
