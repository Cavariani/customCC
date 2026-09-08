/**
 * Ritmo de consumo e projecao ate o reset.
 *
 * Funcao pura, entao aqui e teste direto, sem servidor. O que precisa ser
 * travado sao os casos de borda: janela recem-aberta, conta zerada e conta
 * sem janela. Dividir pelo tempo decorrido nos primeiros segundos produzia
 * projecoes absurdas.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ritmoDaJanela } from '../src/lib/format.ts'

const HORA = 60 * 60 * 1000

/** Conta minima: so o que a funcao le. */
function conta({ tokensUsed, windowStartedAt, resetAt }) {
  return { tokensUsed, windowStartedAt, resetAt }
}

describe('ritmoDaJanela', () => {
  it('uma hora de janela com 1M gasto da 1M por hora', async () => {
    const agora = Date.now()
    const r = ritmoDaJanela(
      conta({ tokensUsed: 1_000_000, windowStartedAt: agora - HORA, resetAt: agora + 4 * HORA }),
      agora,
    )
    assert.ok(r)
    assert.ok(Math.abs(r.porHora - 1_000_000) < 1000, `porHora=${r.porHora}`)
  })

  it('projeta o total ate o reset mantendo o ritmo', async () => {
    const agora = Date.now()
    // 1M numa hora, faltando quatro horas: 1M ja gasto mais 4M projetados.
    const r = ritmoDaJanela(
      conta({ tokensUsed: 1_000_000, windowStartedAt: agora - HORA, resetAt: agora + 4 * HORA }),
      agora,
    )
    assert.ok(Math.abs(r.projetado - 5_000_000) < 10_000, `projetado=${r.projetado}`)
  })

  it('sem janela aberta nao ha ritmo', async () => {
    const agora = Date.now()
    assert.equal(
      ritmoDaJanela(conta({ tokensUsed: 500, windowStartedAt: null, resetAt: null }), agora),
      null,
    )
  })

  it('conta zerada nao ha ritmo', async () => {
    const agora = Date.now()
    assert.equal(
      ritmoDaJanela(
        conta({ tokensUsed: 0, windowStartedAt: agora - HORA, resetAt: agora + HORA }),
        agora,
      ),
      null,
    )
  })

  it('janela de segundos nao vira projecao absurda', async () => {
    const agora = Date.now()
    const r = ritmoDaJanela(
      conta({ tokensUsed: 5000, windowStartedAt: agora - 2000, resetAt: agora + 5 * HORA }),
      agora,
    )
    assert.equal(r, null, 'menos de um minuto de janela nao da ritmo confiavel')
  })

  it('sem reset conhecido, projeta apenas o que ja foi gasto', async () => {
    const agora = Date.now()
    const r = ritmoDaJanela(
      conta({ tokensUsed: 2_000_000, windowStartedAt: agora - 2 * HORA, resetAt: null }),
      agora,
    )
    assert.ok(r)
    assert.equal(r.projetado, 2_000_000, 'sem tempo restante nao ha o que projetar')
  })
})
