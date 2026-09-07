import { useWorkspace } from '../lib/workspace'
import { useNow } from '../lib/useNow'
import { formatTokens, getStatus, msUntilReset, windowRatio } from '../lib/format'

/**
 * O painel de contas recolhido na largura do rail. Mantem o que nao pode
 * sumir de vista: qual conta esta ativa, quanto ela ja gastou e quanto da
 * janela passou. O resto volta ao expandir.
 */
export function DockRail({ onExpand }: { onExpand: () => void }) {
  const { accounts, switchAccount, switching } = useWorkspace()
  const now = useNow()

  return (
    <div className="dockrail">
      {accounts.map((account) => {
        const status = getStatus(account, now)
        const elapsed = windowRatio(account, now)
        const remaining = msUntilReset(account, now)
        return (
          <button
            key={account.id}
            type="button"
            className={`dockrail__bay dockrail__bay--${status}`}
            disabled={account.active || switching}
            onClick={() => switchAccount(account.id)}
            onDoubleClick={onExpand}
            title={`${account.label} · ${formatTokens(account.tokensUsed)} tokens${
              remaining === null ? '' : ` · reset em ${Math.round(remaining / 60000)}min`
            }`}
          >
            <span className="dockrail__n">{String(account.id).padStart(2, '0')}</span>
            <span className="dockrail__tokens">{formatTokens(account.tokensUsed)}</span>
            <span className="dockrail__track">
              <span className="dockrail__fill" style={{ height: `${elapsed * 100}%` }} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
