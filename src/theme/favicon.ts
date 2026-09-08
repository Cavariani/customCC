/**
 * O mascote em pixel art, desenhado como favicon na cor do tema ativo.
 *
 * E gerado em SVG na hora, e nao servido como .png, por um motivo so: a
 * cor tem que acompanhar a troca de tema. Um arquivo estatico ficaria com
 * o vermelho de um tema enquanto o app inteiro estivesse noutro.
 */

/** Grade de 16x16. Cada '#' e um pixel aceso; '.' fica transparente. */
const PIXELS = [
  '................',
  '................',
  '..############..',
  '..############..',
  '..############..',
  '..##.######.##..',
  '..##.######.##..',
  '################',
  '################',
  '..############..',
  '..############..',
  '...#.#....#.#...',
  '...#.#....#.#...',
  '................',
  '................',
  '................',
]

/**
 * Cada sequencia horizontal de pixels acesos vira um retangulo so. Um
 * <rect> por pixel daria 150 nos, e o navegador redesenha o favicon a
 * cada troca de tema.
 */
function shapes(): string {
  const out: string[] = []
  PIXELS.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== '#') {
        x += 1
        continue
      }
      const start = x
      while (x < row.length && row[x] === '#') x += 1
      out.push(`<rect x="${start}" y="${y}" width="${x - start}" height="1"/>`)
    }
  })
  return out.join('')
}

const SHAPES = shapes()

let link: HTMLLinkElement | null = null

export function paintFavicon(color: string): void {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" ` +
    `shape-rendering="crispEdges" fill="${color}">${SHAPES}</svg>`

  if (!link) {
    link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
  }
  // encodeURIComponent, e nao btoa: a cor pode vir com caractere fora do
  // latin1 num tema futuro, e o btoa lanca nesse caso.
  link.type = 'image/svg+xml'
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}
