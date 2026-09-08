/**
 * Apoio dos testes: sobe um servidor isolado e monta repositorios
 * descartaveis.
 *
 * Duas regras que os testes nao podem quebrar, porque ja custaram caro:
 *
 * 1. Nenhum teste aponta escrita para o repositorio real. Todo `cwd` vive
 *    sob um diretorio temporario criado aqui.
 * 2. O servidor de teste roda com HOME proprio. STATE_DIR sai de
 *    `homedir()` e nao tem variavel de override, entao sem isso os testes
 *    leriam e sobrescreveriam o state.json e o .env de verdade.
 */
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Porta fora da faixa de uso normal, para nao esbarrar no servico real. */
export const PORTA = Number(process.env.CUSTOMCC_TEST_PORT ?? 5197)
export const BASE = `http://127.0.0.1:${PORTA}`

export function pastaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'customcc-teste-'))
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Repositorio novo, com identidade propria para nao depender do global. */
export function repo(base, nome) {
  const dir = join(base, nome)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'teste@customcc')
  git(dir, 'config', 'user.name', 'Teste')
  return dir
}

export function escreve(dir, nome, conteudo) {
  writeFileSync(join(dir, nome), conteudo, 'utf8')
}

/** Commit com tudo que estiver no diretorio. */
export function commit(dir, mensagem) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', mensagem)
}

/** Ninguem ouvindo na porta de teste? Senao os testes falam com outro processo. */
async function portaLivre() {
  try {
    await fetch(`${BASE}/api/info`, { signal: AbortSignal.timeout(800) })
    return false
  } catch {
    return true
  }
}

export async function sobeServidor({ cwd, home, env = {} }) {
  mkdirSync(join(home, '.claude-multi-account'), { recursive: true })

  // Sem esta trava, um servidor sobrevivente do caso anterior atende no lugar
  // do novo: os testes passam a medir o HOME errado e o resultado vira
  // ficcao. Ja aconteceu, e custou uma rodada inteira de diagnostico.
  if (!(await portaLivre())) {
    throw new Error(
      `ja tem alguem ouvindo em ${BASE}. Um servidor de teste anterior nao morreu, ` +
        `ou a porta esta em uso. Libere com: kill -9 $(lsof -ti TCP:${PORTA})`,
    )
  }

  const proc = spawn(
    // `node --import tsx`, e nao o cli.mjs do tsx: o wrapper roda o servidor
    // num processo filho, entao matar o pai deixava o filho orfao segurando
    // a porta, e o teste seguinte conversava com o servidor do caso anterior.
    process.execPath,
    ['--import', 'tsx', join(RAIZ, 'server', 'index.ts')],
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CUSTOMCC_PORT: String(PORTA),
        CUSTOMCC_CWD: cwd,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let log = ''
  proc.stdout.on('data', (d) => (log += d))
  proc.stderr.on('data', (d) => (log += d))

  // Espera a porta responder em vez de dormir um tempo fixo: em maquina
  // carregada o sleep curto deixava o teste bater antes de o servidor subir,
  // e o erro saia como "conexao recusada" em vez do que estava sendo testado.
  const limite = Date.now() + 30_000
  while (Date.now() < limite) {
    if (proc.exitCode !== null) {
      throw new Error(`servidor de teste morreu ao subir:\n${log}`)
    }
    try {
      const r = await fetch(`${BASE}/api/info`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return { proc, log: () => log }
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  proc.kill('SIGKILL')
  throw new Error(`servidor de teste nao respondeu em 30s:\n${log}`)
}

export async function derrubaServidor(servidor) {
  if (servidor?.proc && servidor.proc.exitCode === null) {
    await new Promise((pronto) => {
      servidor.proc.once('exit', pronto)
      servidor.proc.kill('SIGKILL')
      setTimeout(pronto, 3000)
    })
  }
  // Espera a porta de fato soltar: o exit do processo e o fechamento do
  // socket nao sao o mesmo instante, e subir o proximo cedo demais esbarra
  // no anterior.
  const limite = Date.now() + 5000
  while (Date.now() < limite) {
    if (await portaLivre()) return
    await new Promise((r) => setTimeout(r, 150))
  }
}

export function limpa(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* diretorio temporario some com o sistema de qualquer jeito */
  }
}

/** POST com JSON, devolvendo status e corpo ja interpretado quando da. */
export async function post(rota, corpo) {
  const r = await fetch(`${BASE}${rota}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  })
  const texto = await r.text()
  let json = null
  try {
    json = JSON.parse(texto)
  } catch {
    /* algumas respostas de erro nao sao JSON */
  }
  return { status: r.status, texto, json }
}

export async function get(rota) {
  const r = await fetch(`${BASE}${rota}`)
  const texto = await r.text()
  let json = null
  try {
    json = JSON.parse(texto)
  } catch {
    /* idem */
  }
  return { status: r.status, texto, json }
}

export const gitDe = (cwd) => get(`/api/git?cwd=${encodeURIComponent(cwd)}`)
