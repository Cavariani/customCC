# Projeto: Terminal Web Custom para Claude Code Multi-Conta

## Objetivo

Pedro usa Claude Code em 100% das sessões de programação e mantém 3 contas
Claude Pro (nenhuma com API key ou plano pay-as-you-go). Ao bater o limite de
5h de uma conta, ele precisa trocar de conta manualmente hoje, o que exige um
fluxo longo (Chrome > logout > login > email > confirmar > VS Code > /login >
autorizar). Esse projeto elimina essa fricção construindo uma interface web
local que roda o Claude Code de verdade (o binário real, não uma
reimplementação) dentro de um terminal embutido no navegador, com um botão
para trocar de conta preservando o contexto da conversa.

## Restrição importante (compliance)

O token OAuth de contas Free/Pro/Max é licenciado pela Anthropic
exclusivamente para uso dentro do Claude Code e do claude.ai. Por isso este
projeto NUNCA deve reimplementar o protocolo de autenticação ou falar direto
com `api.anthropic.com` usando esse token. A app deve sempre rodar o binário
real `claude` como subprocesso (via `node-pty`) e só trocar variáveis de
ambiente / reiniciar esse subprocesso. Isso é o que garante que a app
continua sendo "Claude Code rodando numa casca diferente" e não uma
ferramenta de terceiro que bypassa a autenticação oficial.

## Decisões já tomadas

- **Formato do app**: web local (aba do navegador), não Electron nem Tauri.
- **Número de contas**: fixo em 3 (não precisa ser configurável para N).
- **Painel de status**: sim, quer ver as 3 contas com indicação de qual está
  ativa agora e tempo estimado até o reset da janela de 5h.
- **Continuidade de contexto**: ao trocar de conta, o processo `claude` atual
  é encerrado e um novo é aberto com `claude --continue` no mesmo pty, então
  a sessão/transcript retomam de onde pararam. A troca de conta não depende
  de detecção automática de rate limit, é sempre um clique manual do usuário.
- **Autenticação por conta**: cada uma das 3 contas gera um token de longa
  duração via `claude setup-token` (feito uma vez por conta, manualmente, via
  browser). Os 3 tokens ficam guardados localmente (arquivo fora do repo,
  nunca commitado) e a app seleciona qual token vira a variável de ambiente
  `CLAUDE_CODE_OAUTH_TOKEN` antes de subir o processo `claude`.

## Arquitetura

```
[Browser: xterm.js]  <--WebSocket-->  [Servidor Node local]  <--pty-->  [processo `claude` real]
        |
   [Painel de status das 3 contas]
```

- **Backend**: Node.js, `node-pty` para abrir o pseudo-terminal e rodar o
  `claude` real dentro dele, `ws` (ou similar) para o WebSocket, um servidor
  HTTP simples (Express) servindo o frontend.
- **Frontend**: `xterm.js` renderizando o terminal, mais um painel lateral ou
  superior com 3 indicadores de conta (nome/número, se está ativa, tempo
  estimado até reset).
- **Stack de UI**: React (Vite) + TypeScript, consistente com o stack que
  Pedro já usa no dia a dia (React 19, TS). Assumido por default; ajustar se
  ele preferir algo mais simples (vanilla JS/HTML) para esse ferramenta
  pessoal.
- **Estado de contas**: um arquivo de estado local (JSON) guarda, por conta:
  qual token usar (referência, não o valor em si, isso fica em variável de
  ambiente/arquivo separado), timestamp de quando a janela de 5h daquela
  conta começou a ser usada pela última vez, e qual conta está ativa agora.
  O cálculo de "tempo estimado até reset" é aproximado (início da última
  janela + 5h), já que o Claude Code não expõe uma API pública de quota
  restante por conta.

## Fases de construção

### Fase 1: UI isolada (sem backend real)

Construir só a interface: o terminal embutido (pode ser um terminal "mockado"
que só ecoa o que for digitado, ou já plugado no xterm.js mas sem processo
real por trás ainda), o painel de status das 3 contas com dados fake, e o
botão de trocar de conta que só atualiza o estado visual (qual conta está
"ativa"). O objetivo desta fase é fechar o layout, a navegação entre contas e
a experiência de uso antes de plugar o Claude Code de verdade.

### Fase 2: conectar o backend real

Depois que a UI estiver validada: subir o servidor Node com `node-pty`,
rodar o `claude` real dentro do pty, conectar o WebSocket ao xterm.js, e
implementar a lógica real de troca de conta (matar processo, trocar
`CLAUDE_CODE_OAUTH_TOKEN`, respawnar com `--continue`). Também plugar o
cálculo real de tempo até reset usando o arquivo de estado.

## Setup manual que o Pedro precisa fazer fora do código (pré-requisito)

Para cada uma das 3 contas, uma vez:

```bash
claude setup-token
```

Fazer login na conta correspondente no navegador quando solicitado, copiar o
token gerado (`sk-ant-oat...`) e guardar num arquivo local fora do repositório
(ex: `~/.claude-multi-account/.env`, nunca commitado, no `.gitignore`).