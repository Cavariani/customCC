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

Suba o painel. Há dois modos, e eles abrem em **portas diferentes**:

```powershell
npm run dev     # desenvolvimento: backend em 5181 + vite em 5180
```

Abra <http://localhost:5180>. O vite serve a página e repassa `/api` e `/pty`
para o backend que ele mesmo subiu. É o modo com recarga automática.

```powershell
npm start       # uso normal: compila e serve tudo numa porta so
```

Abra <http://localhost:5181>. É o modo equivalente ao serviço do Mac.

Não confunda: no Mac você se acostuma com o 5181 porque o serviço launchd
já serve o build pronto. Rodando `npm run dev`, a página está no 5180.

## Uso diário: o atalho

Para não depender de terminal nenhum no dia a dia:

```powershell
npm run atalho
```

Isso cria um atalho **customCC** na área de trabalho e no menu Iniciar. Um
clique sobe o servidor, se ele ainda não estiver de pé, espera ficar pronto e
abre o painel numa janela de aplicativo — sem barra de endereço, com ícone
próprio na barra de tarefas. Clique com o direito no atalho para fixar.

Medido nesta máquina: **3,3s** do clique até o painel no ar com tudo desligado,
e **0,5s** quando o servidor já está rodando.

O servidor fica de pé depois que você fecha a janela, de propósito: fechar o
painel não pode matar um `claude` no meio de uma tarefa. Para encerrar:

```powershell
npm run parar
```

**Rode isso antes do `npm run dev`** — os dois disputam a porta 5181, e como o
atalho sobe o servidor sem janela de console, não há Ctrl+C para dar.

Para remover o atalho: `npm run atalho -- desinstalar`.

Três peças, todas em `~/.claude-multi-account/`: o `.ico` (o mascote do painel,
desenhado a partir da mesma grade que o favicon usa), o `abrir-customcc.vbs`
e o `customcc.log`. O `.vbs` existe porque o atalho não pode chamar o Node
direto: um processo de console pisca uma janela preta na tela a cada clique.

### E a tarefa que sobe no login?

`node scripts/service.mjs` deveria criar uma tarefa `customCC` no Agendador
com gatilho de logon. **Nesta máquina ele falha com `Acesso negado`** — o
`schtasks /Create` é recusado mesmo para tarefa do próprio usuário, o que
costuma ser política de máquina corporativa.

O atalho acima não depende disso: é um arquivo comum, sem permissão especial.
Se num PC pessoal o serviço funcionar, ele continua valendo — mas o atalho
sozinho já resolve, e tem a vantagem de não deixar o painel rodando nas horas
em que você não está usando.

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

**Antes de investigar, use o painel por alguns minutos.** A contabilidade sai
dos transcripts que o próprio `claude` grava nesta máquina, e um PC recém-clonado
não tem nenhum. Zero em todas as contas antes da primeira conversa é o esperado,
não um defeito.

O que indica problema é continuar zerado **depois** de você conversar um pouco.
Esse é o único ponto do guia que não foi testado no Windows.

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
- não há equivalente do `launchd`. O caminho do Windows é o **atalho**
  (`npm run atalho`), que sobe o painel sob demanda em vez de mantê-lo ligado
  o dia inteiro. A tarefa do Agendador existe no código mas foi recusada com
  `Acesso negado` na máquina testada; e mesmo funcionando ela não teria o
  `KeepAlive` do `launchd` — o gatilho `ONLOGON` não reergue processo caído
- o `open` para abrir o navegador vira `start`

## A cota real (o que o `/usage` mostra)

O painel mostra a cota de 5h e de 7 dias com o teto de verdade. Esse dado não
vem do transcript: chega num JSON que o Claude Code entrega ao comando de
statusline, e um hook o guarda em disco.

**O `npm install` já instala o hook.** Não há nada a copiar do Mac — o script
está no repositório, em `hooks/statusline-quota.mjs`, e é Node, então roda igual
nos dois sistemas. Se quiser reinstalar depois:

```powershell
npm run hook
```

Se o `~/.claude` ainda não existir na máquina (o `claude` nunca rodou ali), o
`npm install` avisa e não instala nada. Rode `claude` uma vez e depois
`npm run hook`.

O instalador preserva a statusline que já existia: ele a guarda em
`~/.claude/customcc-statusline.json` e o hook a chama, deixando a saída passar.
A barra continua exatamente como estava. Há uma cópia do settings em
`~/.claude/settings.json.antes-do-customcc`.

Sem o hook o painel funciona igual, só que o bloco "cota da api" não aparece.
