#!/usr/bin/env node
/**
 * Encerra o painel que esta rodando solto.
 *
 * Existe por causa do atalho: o servidor sobe sem janela de console, entao
 * nao ha Ctrl+C para dar. Sem isto, a unica saida era achar o processo no
 * Gerenciador de Tarefas — e `npm run dev` disputa a mesma porta 5181, entao
 * parar o painel e passo obrigatorio antes de mexer no codigo.
 *
 * A busca e por porta, e nao por linha de comando: a porta chega ao servidor
 * como variavel de ambiente e nao aparece no argv, entao filtrar processo
 * por `CUSTOMCC_PORT=...` nao casa com nada.
 */
import { spawnSync } from 'node:child_process'

const port = Number(process.env.CUSTOMCC_PORT ?? 5181)

async function respondendo() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/info`, {
      signal: AbortSignal.timeout(1000),
    })
    return r.ok
  } catch {
    return false
  }
}

if (!(await respondendo())) {
  console.log(`[customcc] nada respondendo em http://localhost:${port}.`)
  process.exit(0)
}

if (process.platform === 'win32') {
  // Get-NetTCPConnection da o dono da porta; o /T do taskkill leva junto os
  // `claude` que o painel abriu, que sao filhos dele.
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue
       if ($c) { taskkill /PID $c.OwningProcess /T /F | Out-Null; "encerrado (pid $($c.OwningProcess))" }
       else { "porta ${port} sem dono" }`,
    ],
    { encoding: 'utf8' },
  )
  console.log(`[customcc] ${r.stdout?.trim() || 'nao consegui encerrar'}`)
} else {
  const r = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
  const pids = (r.stdout ?? '').split('\n').filter(Boolean)
  for (const pid of pids) spawnSync('kill', [pid])
  console.log(`[customcc] encerrado (${pids.join(', ') || 'nenhum processo'})`)
}
