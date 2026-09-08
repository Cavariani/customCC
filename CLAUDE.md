# customCC

Painel para rodar o Claude Code com três contas Pro e trocar entre elas sem
perder a conversa. O servidor **nunca** fala com a API da Anthropic: ele roda
o binário oficial `claude` dentro de um pty. Ver `COMO-FUNCIONA.md`.

## Subir o projeto

```
npm install     # instala e liga o hook de cota (ver abaixo)
npm run dev     # backend em 5181 + vite em 5180 → abre http://localhost:5180
npm start       # modo único: compila e serve tudo em 5181
npm test        # 138 casos, ~30s
```

`npm run dev` e o serviço launchd disputam a porta 5181. Antes de subir o dev,
pare o serviço: `launchctl bootout gui/$(id -u)/com.pedrocavariani.customcc`.

## Máquina nova: a ordem que funciona

1. `git clone` + `npm install` — o hook de cota é instalado sozinho aqui
2. copiar o `.env` para `~/.claude-multi-account/.env` (ver abaixo)
3. `npm run dev` e abrir **5180**

Se o `~/.claude` ainda não existir (Claude Code nunca rodou), o passo 1 avisa e
não instala nada. Rode `claude` uma vez e depois `npm run hook`.

## O `.env` fica fora do repositório, de propósito

Ele mora em `~/.claude-multi-account/.env` e tem os três tokens de longa
duração (`CLAUDE_TOKEN_1..3`) mais rótulo e e-mail de cada conta.

**Nunca commitar este arquivo, nem colar o conteúdo dele numa conversa.** Não é
formalidade: o histórico do git é permanente, e a proteção que revogaria um
token vazado só age em repositório público — num privado ninguém avisa. Se o
repositório algum dia virar público, os tokens estarão no histórico.

Sem o `.env`, o painel sobe e o terminal funciona na credencial do ambiente; o
que não funciona é a troca de contas.

## O hook de cota

`hooks/statusline-quota.mjs`, instalado por `scripts/instalar-hook.mjs`.

**Por que existe:** a cota real — os números que o `/usage` mostra — não está em
lugar nenhum do disco. Ela chega uma vez só, num JSON que o Claude Code entrega
ao comando de statusline, com `rate_limits.five_hour.used_percentage`,
`resets_at` e o `seven_day`. O hook guarda esse JSON em
`~/.claude-multi-account/quota/<sessão>.json` e o painel lê de lá.

**Como funciona sem roubar a barra:** o instalador guarda a statusline que já
existia em `~/.claude/customcc-statusline.json` e aponta a do Claude Code para o
hook. O hook grava o JSON, chama a antiga com o mesmo stdin e deixa a saída dela
passar. Se não havia nenhuma, ele desenha uma barra mínima.

**Está em Node, e não em shell, de propósito.** A primeira versão era um `.sh`
com `jq` e `tee >(...)`: nenhum dos três existe no Windows por padrão.

Comandos:

```
npm run hook    # instala ou reinstala; idempotente
```

Para desligar: apague `statusLine` de `~/.claude/settings.json`, ou restaure
`~/.claude/settings.json.antes-do-customcc`. Sem o hook o painel funciona igual,
só que o bloco "cota da api" não aparece — nada mais depende dele.

## Onde as coisas moram

| caminho | o quê |
| --- | --- |
| `~/.claude/projects/<slug>/*.jsonl` | transcripts; fonte de tokens, títulos e conversas |
| `~/.claude/sessions/*.json` | uma por processo vivo do Claude Code; alimenta a frota |
| `~/.claude-multi-account/.env` | os três tokens **(fora do git)** |
| `~/.claude-multi-account/state.json` | conta ativa, janelas, períodos, cota guardada |
| `~/.claude-multi-account/quota/` | o que o hook captura |
| `~/.claude-multi-account/lixeira/` | conversas apagadas, recuperáveis |

## Regras deste projeto

**Testar antes de afirmar.** Várias conclusões "óbvias" desta base se provaram
erradas quando medidas: o carimbo de `~/.claude/sessions` parece heartbeat e não
é (só muda quando o estado muda); o cache é ~99% dos tokens, então somar tudo
num número dá "cache relido", não trabalho.

**Escrita nunca aponta para o repositório real em teste.** Todo teste roda com
`HOME` próprio e `cwd` em pasta temporária. Matar o servidor de teste é por
porta — `pkill -f "CUSTOMCC_PORT=..."` não casa, porque a atribuição é variável
de ambiente e não entra no argv.

**Design: sem caixa, sem glow, sem número em escala de pôster.** O painel é
saída de terminal — colunas alinhadas, medidor segmentado, ação como faixa de
largura total. Cor carrega estado, nunca identidade. Nada de texto abaixo de
11px, e valor numérico nunca em cinza apagado.

**Não construir porque o dado existe.** Duas telas foram feitas e removidas por
isso (um gráfico de 30 fatias e uma linha do tempo de contas): tinham dado
verdadeiro e não respondiam pergunta nenhuma.

Comentários em português, explicando *por quê* — de preferência o bug que a
linha evita. Mensagens de commit em português.

## Windows

`WINDOWS.md` tem o guia. Os dois riscos que continuam sem teste em Windows são o
`resolveClaudeBin` (um npm global instala `claude`, `claude.cmd` e `claude.ps1`;
só o `.cmd` roda no ConPTY) e o `projectSlug` — se a regra de slug for outra
lá, a contabilidade fica zerada e o resto continua funcionando.
