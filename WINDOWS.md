# customCC no Windows

Guia para levar o painel para uma máquina Windows. O projeto já nasceu com os
desvios de plataforma no lugar (ConPTY no pty, `tsx.cmd` no lançador,
`schtasks` no serviço), então na prática é clonar, instalar e copiar um
arquivo.

## O que precisa estar instalado antes

| O quê | Por quê |
| --- | --- |
| **Node** (a mesma linha maior usada no Mac) | o `node-pty` baixa um prebuild compilado por versão do Node; se não houver prebuild para a sua, o `npm install` cai para compilar do zero e aí pede as Build Tools do Visual Studio |
| **Git**, no PATH | o painel de git chama o executável `git` direto, não uma biblioteca |
| **Claude Code**, no PATH | o servidor nunca fala com a API da Anthropic; ele só roda o binário oficial dentro de um pty |

Confira com `node -v`, `git --version` e `where claude`.

## Passo a passo

```powershell
git clone https://github.com/Cavariani/customCC.git
cd customCC
npm install
```

Depois copie as credenciais do Mac. No Mac elas estão em:

```
~/.claude-multi-account/.env
```

No Windows o mesmo arquivo vai para:

```
C:\Users\<você>\.claude-multi-account\.env
```

Crie a pasta se ela não existir. O formato do arquivo é neutro de plataforma —
`CLAUDE_TOKEN_1`, `ACCOUNT_1_LABEL`, `ACCOUNT_1_EMAIL`, e assim por diante — e o
leitor é feito à mão, sem depender de shell.

**Não** copie o `state.json` junto. Ele é só o histórico local de janelas de 5h
e se refaz sozinho na primeira leitura dos transcripts. Levar o do Mac faria o
painel começar mostrando janelas que não existem nessa máquina.

Suba o painel:

```powershell
npm start
```

E abra <http://localhost:5181>. Para instalar como tarefa que sobe no login:

```powershell
node scripts/service.mjs
```

Isso cria uma tarefa `customCC` no Agendador de Tarefas com gatilho de logon e
privilégio limitado. Para remover: `node scripts/service.mjs uninstall`.

## Segurança: o `.env` fica em texto puro

No Mac esse arquivo está com permissão `600` — só o seu usuário lê. O Windows
não tem equivalente direto: o arquivo herda a ACL da pasta do usuário. Ou seja,
qualquer processo rodando como você consegue ler os tokens.

Se a máquina for compartilhada, não copie o arquivo: rode `claude setup-token`
uma vez por conta direto no Windows e monte um `.env` novo lá. É também o que
fazer se os tokens copiados forem recusados — pode ser que estejam atrelados ao
dispositivo de origem, o que não dá para verificar de fora.

Esse arquivo vive **fora** do repositório, em `~/.claude-multi-account/`, então
não há risco de commitá-lo por acidente. O `.gitignore` cobre um `.env` na raiz
do projeto, que é outro arquivo — se algum dia você criar um ali, ele já está
protegido.

## Se algo não funcionar

### O terminal não sobe, ou morre na hora de abrir a aba

Um npm global no Windows instala **três** arquivos com o mesmo nome: `claude`
(script sh, para Git Bash), `claude.cmd` e `claude.ps1`. O `where claude` lista
os três, e o sem extensão costuma vir primeiro — que é justamente o único que o
ConPTY não consegue executar.

O `resolveClaudeBin` já prefere `.cmd`, `.bat` ou `.exe` quando está no Windows.
Se ainda assim escolher errado, aponte na mão:

```powershell
setx CUSTOMCC_CLAUDE_BIN "C:\Users\<você>\AppData\Roaming\npm\claude.cmd"
```

Essa variável tem prioridade sobre a busca no PATH. Abra um terminal novo depois
do `setx` para ela valer.

### As contas aparecem com 0 tokens

Esse é o ponto que mais merece atenção na primeira execução, e é o único que não
foi testado no Windows.

O painel acha os transcripts convertendo o caminho absoluto do projeto em um
"slug", trocando todo caractere não alfanumérico por `-`. No Mac,
`/Users/pedro/Documents/Programação/customCC` vira
`-Users-pedro-Documents-Programa--o-customCC`. No Windows, `C:\Users\pedro\proj`
deveria virar `C--Users-pedro-proj`.

Se o Claude Code no Windows usar outra regra, o painel não encontra os arquivos e
**toda a contabilidade fica zerada** — o terminal, o git e a troca de conta
continuam funcionando normalmente, só os números somem.

Para conferir, compare as duas listas:

```powershell
dir $env:USERPROFILE\.claude\projects
```

com o slug que o painel espera. Se não baterem, o ajuste é em
`projectSlug`, em `server/transcript.ts`.

### O `npm install` tenta compilar o node-pty

Significa que não há prebuild para a sua versão do Node. Duas saídas: trocar
para a versão de Node que tem prebuild, ou instalar as Build Tools do Visual
Studio com a carga de trabalho de C++.

O `postinstall` (`scripts/fix-node-pty.mjs`) não faz nada no Windows, e isso é
esperado: ele só conserta o bit de execução do `spawn-helper`, que existe apenas
no macOS e no Linux. No Windows o pty é o ConPTY, sem helper.

### A porta 5181 já está em uso

```powershell
$env:CUSTOMCC_PORT = "5182"
npm start
```

O servidor escuta somente em loopback nos dois sistemas, então deixá-lo ligado o
tempo todo não expõe nada na rede.

## O que muda de comportamento

Nada no painel. As diferenças ficam todas na camada de baixo:

- o pty usa **ConPTY**, e o tipo de terminal informado a ele vira `xterm-color`
  em vez de `xterm-256color` (a variável `TERM` do processo segue
  `xterm-256color` nos dois sistemas)
- o serviço é uma tarefa do **Agendador**, não um `launchd`. Uma diferença real:
  o `launchd` tem `KeepAlive` e reergue o processo se ele cair; o gatilho
  `ONLOGON` do `schtasks` não faz isso — se o servidor morrer, só volta no
  próximo logon ou rodando `npm start` na mão
- o `open` para abrir o navegador vira `start`
