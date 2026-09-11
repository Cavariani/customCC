#!/usr/bin/env node
/**
 * Abre o painel em um clique, subindo o servidor antes se ele nao estiver de
 * pe. E o que o atalho da barra de tarefas chama.
 *
 * Existe separado do `bin/customcc.mjs` porque o problema e outro: aquele
 * sobe o servidor e fica preso como pai dele, o que serve para o terminal
 * mas nao para um atalho — fechar a janela mataria o painel junto com as
 * sessoes do `claude` que estivessem no meio de uma tarefa. Aqui o servidor
 * nasce solto e este processo morre logo depois.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.CUSTOMCC_PORT ?? 5181)
const url = `http://localhost:${port}`

/** Pasta do log: a mesma que ja guarda estado e cota. */
const casa = join(homedir(), '.claude-multi-account')

/**
 * O servidor esta no ar? Perguntamos por HTTP, e nao so olhando a porta:
 * porta ocupada nao quer dizer painel respondendo, e abrir a janela em cima
 * de um servidor meio morto daria tela branca sem explicacao.
 */
async function respondendo(timeoutMs = 1000) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Sobe o servidor solto deste processo, sem janela de console. */
function subirServidor() {
  mkdirSync(casa, { recursive: true })
  // stdio para arquivo, e nao 'ignore': quando o painel nao subir, o motivo
  // precisa estar em algum lugar — senao o atalho falha em silencio.
  const log = openSync(join(casa, 'customcc.log'), 'a')

  // detached + unref: sem isso o servidor morre junto com este lancador, e o
  // painel cairia no instante em que o atalho terminasse de abrir a janela.
  const filho = spawn(process.execPath, [join(root, 'bin', 'customcc.mjs'), '--no-open'], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, CUSTOMCC_PORT: String(port) },
  })
  filho.unref()
}

/** Espera o painel atender. A primeira execucao compila o frontend antes. */
async function esperar(limiteMs) {
  const fim = Date.now() + limiteMs
  while (Date.now() < fim) {
    if (await respondendo()) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

/**
 * Navegadores que abrem em janela de aplicativo (`--app=`): sem barra de
 * endereco, com icone proprio na barra de tarefas. Cair no navegador padrao
 * funciona igual, so fica com cara de aba.
 */
const NAVEGADORES = [
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.ProgramFiles ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
].map((p) => resolve(p))

function abrirJanela() {
  const navegador = NAVEGADORES.find((p) => existsSync(p))
  if (navegador) {
    spawn(navegador, [`--app=${url}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  // Sem Chrome nem Edge: o navegador padrao resolve. `start` precisa do
  // primeiro argumento vazio, senao ele o trata como titulo da janela.
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

const jaEstava = await respondendo()
if (!jaEstava) {
  subirServidor()
  // 90s porque a primeira execucao compila o frontend antes de escutar a
  // porta; depois disso o servidor sobe em cerca de dois segundos.
  const subiu = await esperar(90_000)
  if (!subiu) {
    console.error(`[customcc] o servidor nao respondeu em ${url}. Log: ${join(casa, 'customcc.log')}`)
    process.exit(1)
  }
}

abrirJanela()
