/**
 * Copiar e colar no terminal.
 *
 * A API `navigator.clipboard` so existe em contexto seguro. `localhost`
 * conta, mas abrir o painel de outra maquina, por `http://192.168.x.x:5181`,
 * nao conta — e e assim que o painel e usado de vez em quando. Por isso o
 * caminho antigo, com textarea escondida e `execCommand`, fica como reserva
 * em vez de o copiar simplesmente nao acontecer.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false

  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    /* sem permissao ou fora de contexto seguro: cai para a reserva */
  }

  try {
    const campo = document.createElement('textarea')
    campo.value = texto
    // Fora da vista, mas dentro do documento: `execCommand` ignora elemento
    // com display none, e `position: fixed` evita o pulo de rolagem.
    campo.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(campo)
    campo.select()
    const ok = document.execCommand('copy')
    campo.remove()
    return ok
  } catch {
    return false
  }
}

/** Texto da area de transferencia, ou vazio quando o navegador recusa. */
export async function lerTexto(): Promise<string> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export interface AnexoSalvo {
  arquivo: string
  caminho: string
}

/**
 * Manda a imagem para o servidor, que a grava em disco e devolve o caminho.
 * O caminho e o que o `claude` sabe ler: o painel nunca fala com a API.
 */
export async function enviarImagem(arquivo: File | Blob): Promise<AnexoSalvo> {
  const resposta = await fetch('/api/anexos', {
    method: 'POST',
    headers: { 'content-type': arquivo.type || 'image/png' },
    body: arquivo,
  })
  const dado = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(dado.error ?? `HTTP ${resposta.status}`)
  return dado as AnexoSalvo
}

/** Imagens de um evento de colar ou de arrastar, ignorando o resto. */
export function imagensDe(dados: DataTransfer | null): File[] {
  if (!dados) return []
  const arquivos = [...(dados.files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (arquivos.length > 0) return arquivos
  // Print de tela colado chega so como item, sem entrar em `files`.
  return [...(dados.items ?? [])]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null)
}
