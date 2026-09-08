# Como a troca de contas funciona

Três contas Pro comuns, nenhuma chave de API, nenhum crédito de API. Este
documento explica o truque em cinco passos.

## 1. Não existe API nenhuma nisso

O servidor **nunca** fala com a Anthropic. Ele só roda o binário oficial
`claude` dentro de um pty — um terminal falso. É idêntico a você digitar
`claude` no terminal de verdade: consome o plano Pro, não crédito de API.

É por isso que funciona sem chave. Quem se autentica, quem fala com a
Anthropic e quem cobra a quota é sempre o binário oficial. O painel é só uma
casca em volta dele.

## 2. O token representa a assinatura, não crédito

`claude setup-token` faz login numa conta e devolve um token longo, com
prefixo `sk-ant-oat`, que representa **aquela assinatura Pro**. Rodado uma vez
por conta, o resultado vive em `~/.claude-multi-account/.env`:

```
CLAUDE_TOKEN_1=sk-ant-oat...
ACCOUNT_1_LABEL=Pessoal
ACCOUNT_1_EMAIL=...
```

O servidor lê esse arquivo e nada mais. O valor do token nunca sai dele para
lugar nenhum além do ambiente do subprocesso.

## 3. A troca é uma variável de ambiente

O `claude` aceita `CLAUDE_CODE_OAUTH_TOKEN`. Trocar de conta é derrubar o
processo e subir outro com um token diferente no ambiente do filho:

```ts
const env = { ...process.env, TERM: 'xterm-256color' }
for (const key of INHERITED_MARKERS) delete env[key]
env.CLAUDE_CODE_OAUTH_TOKEN = token da conta escolhida
pty.spawn(bin, args, { env, ... })
```

Como a credencial é por processo, as contas não se misturam: não há estado
global de onde uma possa vazar para a outra.

## 4. A conversa sobrevive à troca

É essa parte que faz a troca parecer limpa em vez de um recomeço.

Antes de derrubar o processo, o painel descobre o **id da sessão** daquela
aba. Depois sobe o processo novo com `--resume <id>`, retomando exatamente
aquela conversa — agora cobrada na outra conta. Você vê uma pausa, não uma
tela em branco.

Um detalhe que parece pedantismo e não é: a retomada usa `--resume <id>` e
**nunca** `--continue`. O `--continue` pega a conversa mais recente do
diretório, que pode ser de outra aba ou de um Claude Code que você abriu por
fora — a troca de conta sequestraria a sessão errada. Sem id descoberto, a
aba sobe limpa em vez de arriscar.

## 5. A contabilidade é lida, não medida

O próprio `claude` escreve tudo em `~/.claude/projects/<slug>/*.jsonl`,
incluindo os tokens de cada mensagem. O painel só lê esses arquivos.

Para saber de quem é cada mensagem, o estado guarda uma linha do tempo de
períodos:

```json
{ "periods": [
  { "accountId": 1, "from": 1788800000000, "to": 1788803600000 },
  { "accountId": 3, "from": 1788803600000, "to": null }
]}
```

Cada mensagem cai na conta que estava ativa no instante dela. É assim que o
consumo continua certo mesmo quando você troca de conta no meio de uma
sessão. Ninguém conta nada por fora, e nada é estimado.

## O detalhe que quase estragou tudo

O Claude Code marca o ambiente com `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`,
`CLAUDE_CODE_ENTRYPOINT` e afins. Se o processo filho herdasse esses
marcadores, ele se declararia **sessão aninhada** e desligaria o transcript.

Sem transcript não há dado de consumo nem diff — o painel inteiro ficaria
cego, e sem mensagem de erro nenhuma. Por isso cada aba apaga esses
marcadores antes de subir:

```ts
const INHERITED_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
]
```

Cada aba precisa ser uma sessão de primeira classe, não filha da anterior.

## O que isto não é

Não driva o limite de nenhuma conta. São três assinaturas reais, usadas uma
de cada vez, cada uma com a sua própria janela de 5h. O ganho é não ficar
parado quando uma bate o teto: você troca e continua na próxima, sem perder a
conversa.

## Onde cada peça mora

| Arquivo | Papel |
| --- | --- |
| `server/accounts.ts` | lê o `.env`, guarda a linha do tempo de períodos, soma o consumo por conta |
| `server/pty.ts` | sobe e derruba o `claude` com o token certo no ambiente |
| `server/transcript.ts` | lê os `.jsonl` que o `claude` escreve |
| `server/index.ts` | rota `/api/accounts/:id/activate`, que orquestra a troca |
