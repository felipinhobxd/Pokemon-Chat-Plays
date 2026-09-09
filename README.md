# Pokemon Chat Plays - SindromeGames Edition

> Bot que permite que o chat da **Twitch** e do **YouTube** jogue Pokemon (ou qualquer outro jogo de GameBoy/GBA) enviando comandos no chat — agora com **segurar teclas (hold)**!

Versao brasileira, melhorada e bilingue do projeto [twitch-chat-plays-pokemon](https://github.com/William-Droin/twitch-chat-plays-pokemon), criada para o canal **[SindromeGames](https://www.twitch.tv/sindromegames)** no Twitch e no YouTube **[@SindromeGames](https://www.youtube.com/@SindromeGames)**.

---

## Sumario

- [Modo Plug-and-Play (sem programar)](#modo-plug-and-play-sem-programar)
- [O que e](#o-que-e)
- [Funcionalidades](#funcionalidades)
- [Modo Desenvolvedor (Node.js)](#modo-desenvolvedor-nodejs)
- [Configuracao](#configuracao)
- [Uso](#uso)
- [Comandos](#comandos)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como gerar o .exe](#como-gerar-o-exe)
- [Solucao de problemas](#solucao-de-problemas)
- [Creditos](#creditos)
- [Licenca](#licenca)

---

## Modo Plug-and-Play (sem programar)

Se voce so quer USAR o bot (sem programar nada):

1. Baixe o arquivo `.zip` da release mais recente em:
   **https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases**
2. Descompacte o `.zip` em qualquer pasta (ex: `Meus Documents\Chat Joga\`).
3. Abra o arquivo `.env` com o Bloco de Notas e preencha:
   - `TWITCH_BOT_USERNAME` = nome do seu bot
   - `TWITCH_OAUTH_TOKEN` = Access token gerado em https://twitchtokengenerator.com/ (pode colar com ou sem o prefixo `oauth:`)
   - `TWITCH_CHANNEL` = `sindromegames` (ou seu canal)
   - *(opcional)* `YOUTUBE_ENABLED`, `YOUTUBE_API_KEY`, `YOUTUBE_VIDEO_ID` para YouTube
4. Salve e feche o `.env`.
5. Abra o emulador (VisualBoyAdvance-M) e deixe em foco (clique na janela dele).
6. De um duplo-clique em **`iniciar.bat`**.
7. Pronto! O chat da sua live ja controla o jogo. 🎮

> **Como obter o token da Twitch (passo a passo):**
> 1. Acesse https://twitchtokengenerator.com/ (logado com a conta do seu bot)
> 2. Clique em **"Bot Chat Token"** (o card do robô verde)
> 3. Clique em **"Generate Token!"** e autorize a aplicacao
> 4. Na tela de resultado, copie o campo **"Access token"**
> 5. Cole o valor em `TWITCH_OAUTH_TOKEN` (pode ser com ou sem o prefixo `oauth:` — o bot detecta automaticamente)
>
> *Os outros campos que aparecem (Refresh token, Client ID) NAO sao necessarios para este bot.*
> *(O site antigo twitchapps.com/tmi/ foi descontinuado em 2024 e nao funciona mais.)*

> **Importante:** o bot so funciona com o emulador em foco. Se voce clicar em outra janela, os comandos vao para o programa errado.

> **Windows pode exibir "Windows protegeu seu PC"** ao rodar o `.exe` pela primeira vez. Clique em **Mais informacoes > Executar mesmo assim**. O arquivo e seguro e nao tem assinatura digital porque e um projeto gratuito.

---

## O que e

Este projeto e um bot Node.js que:

1. Conecta-se ao chat da sua live na **Twitch** (e opcionalmente no **YouTube**).
2. Fica monitorando cada mensagem enviada pelo publico.
3. Quando alguem digita um comando como `a`, `b`, `up`, `down`, etc., o bot simula a tecla correspondente no seu teclado.
4. Com um emulador (como o VisualBoyAdvance) em foco, o jogo responde como se fosse voce jogando - mas quem esta no controle e o chat!

E exatamente a mesma ideia do famoso "Twitch Plays Pokemon", mas rodando localmente na sua maquina e na sua propria live.

---

## Funcionalidades

Comparado ao projeto original, esta versao traz:

- **Suporte a Twitch e YouTube simultaneamente.** Voce pode ativar uma ou as duas plataformas.
- **SEGURAR TECLAS (hold)!** O chat pode mandar `hold cima`, `hold baixo 3`, `hold up 500ms` para manter uma tecla pressionada por um tempo (perfeito para andar/correr, nadar contra corredeira, etc).
- **Soltar tudo com um comando.** `soltar` libera todas as teclas presas na hora.
- **Configuracao via arquivo `.env`.** Nada mais de credenciais hardcoded no codigo.
- **Cooldown anti-spam.** Cada usuario so pode enviar um comando a cada X segundos, evitando que um unico usuario domine o jogo.
- **Cooldown global.** Limita a taxa total de comandos para nao sobrecarregar o emulador.
- **Comandos em portugues e ingles.** `cima`/`up`, `baixo`/`down`, `esquerda`/`left`, `direita`/`right`, `seleciona`/`select`, `segurar`/`hold` etc.
- **Comandos `start` e `select`.** O original so tinha direcionais + A/B/L/R.
- **`!comandos` COMPLETO e organizado.** Lista TODOS os comandos em mensagens formatadas com emojis e separadores — nada fica de fora.
- **`!stats` e `!top`.** Estatisticas da live e ranking dos jogadores que mais mandaram comandos.
- **Anuncio automatico dos comandos.** A cada X minutos (configuravel) o bot lembra o chat quais sao os comandos.
- **Anti-flood de respostas.** Se 20 pessoas pedirem `!comandos` ao mesmo tempo, o bot responde uma vez so (protege o canal de spam e rate-limit).
- **Estatisticas de uso.** Conta quantas vezes cada comando foi executado, por plataforma e por usuario (incluindo holds).
- **Logs coloridos com niveis.** Facil de debugar, com arquivos de log por dia.
- **Encerramento limpo com `Ctrl+C`.** Solta todas as teclas presas antes de desligar — o jogo nunca fica travado.
- **Teclado 100% assincrono.** Fila de teclas nunca congela o bot, nem com o chat em chamas.
- **Backend de teclado SEM compilar C++.** Usa PowerShell + keybd_event (Windows), xdotool (Linux) ou osascript (macOS) - zero build tools necessarias.
- **Empacotavel em .exe.** A GitHub Action gera o `.exe` automaticamente quando voce cria uma tag.
- **Setup interativo.** Para iniciantes que nunca mexeram em `.env`.
- **Testes automatizados.** `npm test` roda 40+ testes offline com o node:test nativo (zero dependencias extras).
- **Tratamento de erros robusto.** Reconexao automatica do tmi.js, retentativa no YouTube em caso de quota excedida.
- **README, comentarios e mensagens 100% em portugues.**

---

## Modo Desenvolvedor (Node.js)

Se voce quer rodar via Node.js (para desenvolvimento ou em Linux/macOS):

```bash
# 1. Clone o repositorio
git clone https://github.com/felipinhobxd/Pokemon-Chat-Plays.git
cd Pokemon-Chat-Plays

# 2. Instale as dependencias
npm install

# 3. Copie o .env.example para .env e preencha suas credenciais
cp .env.example .env
# (Windows) copy .env.example .env

# 4. Inicie o bot
npm start
```

> **Nota:** A partir da versao 2.1.0, removemos a dependencia `robotjs` (que exigia Visual Studio Build Tools no Windows). O teclado agora e controlado via PowerShell (Windows), xdotool (Linux) ou osascript (macOS). Resultado: `npm install` roda em qualquer maquina sem precisar de build tools.

### Setup interativo (opcional)

```bash
npm run setup
```

---

## Configuracao

Edite o arquivo `.env`:

```bash
TWITCH_BOT_USERNAME=nome_do_seu_bot
TWITCH_OAUTH_TOKEN=oauth:xxxxxxxxxxxxxxxxxxxx
TWITCH_CHANNEL=sindromegames

YOUTUBE_ENABLED=false
YOUTUBE_API_KEY=sua_chave_aqui
YOUTUBE_VIDEO_ID=ID_DO_VIDEO_DA_LIVE

ACTIVE_PLATFORMS=twitch
COMMAND_COOLDOWN_MS=1500
KEY_PRESS_DURATION_MS=230
ANNOUNCE_INTERVAL_MIN=10

# Novo na v2.2 - segurar teclas (hold)
HOLD_DEFAULT_MS=1000     # tempo padrao do "hold cima" sem numero
HOLD_MAX_MS=10000        # tempo maximo que uma tecla pode ficar presa
CONFIRM_COMMANDS=true    # bot confirma no chat quem segurou/soltou teclas
```

### Twitch

> IMPORTANTE: O gerador antigo `twitchapps.com/tmi/` foi descontinuado em 2024.
> Use o https://twitchtokengenerator.com/ (servico de swiftyspiffy, recomendado pelo proprio twitchapps).

#### Opcao 1 - Rapida (recomendada para usuarios finais)

1. Crie uma conta no Twitch para o seu bot (ou reutilize uma conta secundaria).
2. Acesse https://twitchtokengenerator.com/ estando logado com a conta do bot.
3. Na tela inicial, clique em **"Bot Chat Token"** (o card do robô verde).
4. Clique em **"Generate Token!"** e autorize a aplicacao.
5. Na tela de resultado, voce vera tres campos:
   - **Access token** (este e o que voce precisa!)
   - Refresh token (nao necessario)
   - Client ID (nao necessario)
6. Clique em **Copy** ao lado do **Access token** e cole em `TWITCH_OAUTH_TOKEN`.
   - O bot aceita o token com ou sem o prefixo `oauth:`. Se voce colar apenas o Access Token (sem `oauth:`), o bot adiciona o prefixo automaticamente.
7. Preencha `TWITCH_BOT_USERNAME` com o nome do bot e `TWITCH_CHANNEL` com o nome do seu canal (`sindromegames`).

> Aviso: o twitchtokengenerator.com e um servico terceiro. Para maxima seguranca, voce pode usar a Opcao 2 abaixo.
>
> Importante: o token gerado e mostrado **apenas uma vez**. Copie imediatamente antes de fechar a pagina.

#### Opcao 2 - Oficial (recomendada para desenvolvedores)

1. Acesse https://dev.twitch.tv/console e faca login com a conta do bot.
2. Clique em **Register Your Application**.
3. Preencha:
   - **Name**: Pokemon Chat Plays
   - **OAuth Redirect URLs**: `http://localhost:3000` (nao usado de fato, mas obrigatorio)
   - **Category**: Chat Bot
4. Salve e copie o **Client ID**.
5. Va em **Manage** > gere um **Client Secret**.
6. Use o fluxo OAuth Authorization Code com os escopos `chat:read` e `chat:edit`.
   Documentacao oficial: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
7. O token final sera no formato `oauth:xxxx` e pode ser usado em `TWITCH_OAUTH_TOKEN`.

### YouTube

> O YouTube exige uma chave de API. Nao existe alternativa simples sem OAuth2.

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto (ou use um existente).
3. No menu, va em **APIs & Services > Library** e ative a **YouTube Data API v3**.
4. Em **APIs & Services > Credentials**, crie uma **API Key**.
5. Restrinja a chave para "YouTube Data API v3" (recomendado).
6. Copie a chave para `YOUTUBE_API_KEY` no `.env`.
7. Quando voce estiver com a live aberta no YouTube, copie o ID do video da URL:
   - URL: `https://www.youtube.com/watch?v=ABC123DEF`
   - ID: `ABC123DEF`
8. Coloque em `YOUTUBE_VIDEO_ID`.
9. Defina `YOUTUBE_ENABLED=true` e `ACTIVE_PLATFORMS=twitch,youtube`.

> **Limitacao importante:** com apenas uma **API Key** (sem OAuth2), o bot consegue *ler* mensagens do chat da live, mas **nao consegue enviar** mensagens. Para o uso deste projeto (le comandos e executa no teclado), API Key e suficiente.

---

## Uso

1. **Abra o emulador** (VisualBoyAdvance-M) e carregue a ROM do jogo.
2. **Configure os controles no emulador** de acordo com o mapeamento padrao:

   | Botao GBA     | Tecla        |
   |---------------|--------------|
   | Seta Cima     | `↑` (up)     |
   | Seta Baixo    | `↓` (down)   |
   | Seta Esquerda | `←` (left)   |
   | Seta Direita  | `→` (right)  |
   | A             | `X`          |
   | B             | `Z`          |
   | L             | `A`          |
   | R             | `S`          |
   | Start         | `Enter`      |
   | Select        | `Backspace`  |

   > Voce pode mudar o mapeamento editando `MAPEAMENTO_PADRAO` no arquivo `src/controllers/keyboard.js`.

3. **Deixe o emulador em foco** (clique na janela dele uma vez).
4. **Inicie o bot**:
   - Modo plug-and-play: duplo-clique em `iniciar.bat`.
   - Modo desenvolvedor: `npm start`.
5. **Va para sua live** e peca para o chat digitar os comandos. Pronto! 🎮

> Dica: Use modo janela no emulador para alternar entre emulador e terminal do bot. Nao precisa ficar com o emulador sempre em foco - apenas quando os comandos devem ser executados nele.

---

## Comandos

Qualquer mensagem no chat que seja exatamente um destes comandos aciona o bot (sem prefixo):

### Comandos de jogo

| Comando                          | Acao                                 |
|----------------------------------|--------------------------------------|
| `a`                              | Botao A                              |
| `b`                              | Botao B                              |
| `up`, `cima`, `sobe`, `subir`    | Seta para cima                       |
| `down`, `baixo`, `desce`         | Seta para baixo                      |
| `left`, `esquerda`, `esq`        | Seta para esquerda                   |
| `right`, `direita`, `dir`        | Seta para direita                    |
| `l`                              | Botao L (ombro esquerdo)             |
| `r`                              | Botao R (ombro direito)              |
| `start`                          | Botao Start                          |
| `select`, `seleciona`            | Botao Select                         |

### Segurar teclas (hold) — novo na v2.2!

| Comando                           | Acao                                        |
|-----------------------------------|---------------------------------------------|
| `hold cima` (ou `segurar cima`)   | Segura a tecla por 1 segundo (padrao)       |
| `hold baixo 3`                    | Segura por 3 segundos                       |
| `hold up 500ms`                   | Segura por meio segundo                     |
| `hold left 2s`                    | Aceita sufixo `s` ou `ms`                   |
| `holdcima`, `holda`               | Tambem funciona com o botao colado          |
| `soltar` (ou `solta`/`release`)   | Solta TODAS as teclas presas na hora        |

Regras de tempo (documentadas tambem no `!segurar` do chat):
- Numero **sem sufixo e <= 30** = segundos (`hold cima 3` = 3s)
- Numero **sem sufixo e > 30** = milissegundos (`hold cima 500` = meio segundo)
- Sufixo explicito sempre vale: `500ms`, `2s`, `2seg`, `2segundos`
- Tempo maximo: 10 segundos (`HOLD_MAX_MS`) — evita o chat travar o jogo de proposito
- Quem segura recebe confirmacao no chat (ex: `🔒 @user segurou ⬆ CIMA por 3s`)

### Comandos de informacao

| Comando              | Acao                                               |
|----------------------|----------------------------------------------------|
| `!comandos`          | Lista COMPLETA de comandos (2 mensagens formatadas)|
| `!ajuda` / `!help`   | Mesma lista completa                               |
| `!segurar` / `!hold` | Ajuda detalhada so dos comandos de segurar         |
| `!stats`             | Estatisticas da live (total, uptime, plataformas)  |
| `!top` / `!ranking`  | Top 5 jogadores que mais mandaram comandos         |
| `ola` / `oi`         | Boas-vindas com dica rapida dos comandos           |

> Todas as respostas do bot sao formatadas com emojis, separadores e multi-linhas — muito mais legiveis no chat da Twitch. E tem anti-flood integrado: mesmo se 20 pessoas pedirem `!comandos` em 5 segundos, o bot responde so uma vez (sem risco de rate-limit).

---

## Estrutura do projeto

```
Pokemon-Chat-Plays/
├── .env.example              # Template de configuracao (copie para .env)
├── .gitignore
├── .github/
│   └── workflows/
│       └── build-release.yml # CI: gera .exe automaticamente
├── LICENSE
├── README.md
├── iniciar.bat                # Duplo-clique para iniciar no Windows
├── package.json
├── scripts/
│   ├── build.js              # Build local do .exe (via pkg)
│   └── setup.js              # Setup interativo (npm run setup)
└── src/
    ├── index.js             # Ponto de entrada principal
    ├── config.js            # Carrega e valida o .env
    ├── commands.js          # Registro central de comandos + parser (hold, soltar...)
    ├── messages.js          # Todas as mensagens do chat, formatadas e bonitas
    ├── handlers.js          # Pipeline compartilhado Twitch/YouTube + anti-flood
    ├── controllers/
    │   ├── twitch.js        # Cliente Twitch (tmi.js) com fila de envio
    │   ├── youtube.js       # Cliente YouTube (googleapis)
    │   └── keyboard.js      # Teclado assincrono com hold (PowerShell/xdotool/osascript)
    ├── utils/
    │   ├── logger.js        # Logger colorido com niveis
    │   ├── cooldown.js      # Anti-spam por usuario + global
    │   └── stats.js         # Estatisticas de uso (com holds)
    └── tests/               # Testes automatizados (npm test)
        ├── commands.test.js
        ├── messages.test.js
        └── handlers.test.js
```

---

## Como gerar o .exe

### Metodo 1: Automático (recomendado)

Crie uma tag git e empurre:

```bash
git tag v2.1.0
git push origin v2.1.0
```

A GitHub Action em `.github/workflows/build-release.yml` vai automaticamente:
1. Compilar o projeto em `windows-latest`
2. Gerar `PokemonChatPlays.exe`
3. Empacotar junto com `.env.example`, `README.md`, `iniciar.bat`, `LICENSE`
4. Criar uma Release no GitHub com o `.zip` anexado

### Metodo 2: Local (Windows)

```bash
npm install -g pkg
node scripts/build.js
```

O `.exe` e os arquivos auxiliares ficam na pasta `dist/`.

### Metodo 3: Manual

```bash
npm install
pkg . --targets node18-win-x64 --output PokemonChatPlays.exe --compress GZip
```

---

## Solucao de problemas

### "Windows protegeu seu PC" ao rodar o .exe

O `.exe` nao tem assinatura digital porque e um projeto gratuito. Clique em:
**Mais informacoes > Executar mesmo assim**.

### Os comandos nao fazem nada

- Verifique se o **emulador esta em foco**. Clique na janela do emulador uma vez.
- Verifique se o **mapeamento de teclas no emulador** corresponde ao mapeamento do arquivo `keyboard.js`.
- Ative `DEBUG=true` no `.env` para ver logs detalhados.

### `Permission denied` ou `403` no YouTube

- Sua chave de API pode estar invalida ou voce atingiu a quota diaria.
- Verifique se a **YouTube Data API v3** esta ativada no projeto.
- A quota padrao e 10.000 unidades/dia. Cada `liveChatMessages.list` custa ~5 unidades.

### O bot envia mensagens repetidas

- Pode ser o cooldown desativado ou muito baixo. Defina `COMMAND_COOLDOWN_MS=1500` ou maior.

### Erro `EADDRINUSE` ou porta em uso

- Outro processo Node pode estar rodando. Mate todos com `pkill -f node` (Linux/macOS) ou feche no Gerenciador de Tarefas (Windows).

### O bot nao reconhece comandos em portugues

- Os aliases (`cima`, `baixo`, `esquerda`, `direita`, `seleciona`, `segurar`...) estao mapeados em `src/commands.js` no objeto `ALIASES`. Edite a vontade.

### As teclas ficam presas / o personagem anda sozinho

- Mande `soltar` no chat (solta todas as teclas na hora).
- O bot tambem solta tudo sozinho ao ser fechado com `Ctrl+C`.
- Se ainda assim uma tecla ficar presa (ex: processo morto no meio), clique na janela do jogo e aperte a tecla correspondente no teclado fisico.

### O bot fala demais no chat

- As confirmacoes de hold/soltar podem ser desativadas: `CONFIRM_COMMANDS=false` no `.env`.
- O anti-flood ja limita respostas repetidas de `!comandos`, `!stats` etc (8s entre repeticoes).

### Como rodar os testes

```bash
npm test
```

Roda 40+ testes automaticos (parser de comandos, mensagens e pipeline). Nao precisa de emulador nem credenciais — os testes rodam offline.

### PowerShell bloqueado por politica corporativa

Se o PowerShell estiver bloqueado (raro em maquinas domésticas), o teclado nao vai funcionar. Solucao: rodar como Administrador ou desbloquear via `Set-ExecutionPolicy RemoteSigned`.

---

## Creditos

- Projeto original: [William-Droin/twitch-chat-plays-pokemon](https://github.com/William-Droin/twitch-chat-plays-pokemon)
- Versao melhorada e traduzida por **SindromeGames** ([Twitch](https://www.twitch.tv/sindromegames) / [YouTube](https://www.youtube.com/@SindromeGames))
- Bibliotecas usadas:
  - [tmi.js](https://github.com/tmijs/tmi.js) - cliente IRC da Twitch
  - [googleapis](https://github.com/googleapis/google-api-nodejs-client) - YouTube Data API
  - [dotenv](https://github.com/motdotla/dotenv) - variaveis de ambiente
  - [pkg](https://github.com/vercel/pkg) - empacotamento em .exe

---

## Licenca

MIT - veja o arquivo [LICENSE](./LICENSE).

---

> Aviso legal: Este projeto nao e afiliado a Nintendo, Game Freak, The Pokemon Company, Twitch ou YouTube/Google. "Pokemon" e marca registrada da Nintendo. Use apenas ROMs que voce possui legalmente.
