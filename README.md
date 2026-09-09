<div align="center">

# 🎮 Pokémon Chat Plays

### O chat da sua live no controle do jogo

**Twitch + YouTube** · **Segurar teclas (hold)** · **Português & English** · **Plug-and-play**

[![Release](https://img.shields.io/github/v/release/felipinhobxd/Pokemon-Chat-Plays?label=release)](https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases)
[![Licença](https://img.shields.io/github/license/felipinhobxd/Pokemon-Chat-Plays)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Testes](https://img.shields.io/badge/testes-40%20%E2%9C%94-brightgreen)](#testes)
[![Plataformas](https://img.shields.io/badge/plataforma-Windows%20%7C%20Linux%20%7C%20macOS-9146FF)](#modo-desenvolvedor-nodejs)
[![Chat Twitch](https://img.shields.io/badge/chat-Twitch-9146FF?logo=twitch&logoColor=white)](https://www.twitch.tv/sindromegames)
[![Chat YouTube](https://img.shields.io/badge/chat-YouTube-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@SindromeGames)

**[⬇️ Baixar a última release](https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases/latest)** ·
**[🕹️ Emulador: visualboyadvance.org](https://visualboyadvance.org/)** ·
**[📜 Lista de comandos](#comandos)** ·
**[❓ FAQ](#faq)**

```text
     CHAT DA SUA LIVE                BOT (Node.js)                    O JOGO
  ┌───────────────────┐      ┌───────────────────────────┐      ┌──────────────────┐
  │  "up"             │      │  interpreta o comando     │      │                  │
  │  "a"              │ ───► │  aplica anti-spam         │ ───► │   EMULADOR VBA   │
  │  "hold cima 3"    │      │  simula o teclado         │      │   (em foco)      │
  │  "soltar"         │      │  pressiona ou SEGURA      │      │                  │
  └───────────────────┘      └───────────────────────────┘      └──────────────────┘
     Twitch / YouTube              aperta, segura e solta           VisualBoyAdvance
```

</div>

---

> Versão brasileira, turbinada e bilíngue do projeto [twitch-chat-plays-pokemon](https://github.com/William-Droin/twitch-chat-plays-pokemon), criada para o canal **[SindromeGames](https://www.twitch.tv/sindromegames)** 🇧🇷

## Sumário

- [O que é este projeto?](#o-que-é-este-projeto)
- [Início rápido (plug-and-play)](#início-rápido-plug-and-play)
- [O emulador (Visual Boy Advance)](#o-emulador-visual-boy-advance)
- [Credenciais passo a passo](#credenciais-passo-a-passo)
- [Comandos](#comandos)
- [Configuração (referência do .env)](#configuração-referência-do-env)
- [Funcionalidades](#funcionalidades)
- [Modo desenvolvedor (Node.js)](#modo-desenvolvedor-nodejs)
- [Testes](#testes)
- [Como gerar o .exe](#como-gerar-o-exe)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [FAQ](#faq)
- [Créditos](#créditos)
- [Licença e aviso legal](#licença-e-aviso-legal)

---

## O que é este projeto?

É um bot que transforma o **chat da sua live no controle do videogame**. Ele conecta na Twitch (e opcionalmente no YouTube), fica lendo cada mensagem do público, e quando alguém digita `up`, `a`, `hold cima 3` ou qualquer outro comando, o bot **simula a tecla correspondente no seu teclado**. Com o emulador aberto e em foco, o jogo responde como se fosse você jogando — só que quem está no controle é o chat inteiro.

É a mesma ideia do lendário **Twitch Plays Pokémon**, mas rodando na sua própria máquina, na sua própria live, com suporte a **segurar teclas** (perfeito para correr, nadar contra a correnteza ou segurar a bicicleta), mensagens bonitas no chat, estatísticas e ranking de jogadores.

O diferencial desta versão:

1. **Plug-and-play de verdade** — baixe o `.zip`, preencha o `.env`, dê dois cliques no `iniciar.bat`. Zero programação, zero compilação, zero build tools.
2. **Hold real** — keydown e keyup separados: o chat consegue *segurar* uma tecla por segundos e *soltar* depois.
3. **Feito para o Brasil** — comandos em português e inglês, mensagens formatadas com emojis, README 100% em PT-BR.
4. **Robusto** — 40 testes automatizados, fila de teclas assíncrona, anti-spam, anti-flood, reconexão automática e encerramento limpo com `Ctrl+C` (nunca deixa tecla presa).

---

## Início rápido (plug-and-play)

> 🎯 **Para quem só quer usar o bot.** Você não precisa instalar Node.js, Git nem qualquer outra coisa — o `.zip` da release já vem com o `PokemonChatPlays.exe` pronto.

### 1. Baixe o bot

Baixe o **`PokemonChatPlays-Windows.zip`** na página de releases:

👉 **https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases/latest**

O `.zip` contém:

| Arquivo | Para que serve |
|---|---|
| `PokemonChatPlays.exe` | O bot compilado — não precisa instalar nada |
| `.env.example` | Modelo de configuração (você preenche com suas credenciais) |
| `iniciar.bat` | Duplo clique aqui para iniciar |
| `README.md` | Esta documentação |
| `LICENSE` | Licença MIT |

### 2. Descompacte

Extraia o `.zip` em qualquer pasta de fácil acesso, por exemplo:

```
C:\ChatJoga\
```

### 3. Baixe o emulador

> 🕹️ **Baixe o Visual Boy Advance aqui: https://visualboyadvance.org/**

O **VisualBoyAdvance-M (VBA-M)** é o emulador de Game Boy / Game Boy Color / Game Boy Advance recomendado para este projeto — ele roda Pokémon de GBA (Esmeralda, Fire Red, Ruby...) e GB/GBC (Red, Blue, Gold...). Instale-o como qualquer programa do Windows e volte aqui para configurar os controles na [seção do emulador](#o-emulador-visual-boy-advance).

### 4. Configure o bot

Dê um **duplo clique em `iniciar.bat`**. Na primeira execução ele:

1. Cria o arquivo `.env` automaticamente a partir do `.env.example`;
2. Abre o Bloco de Notas para você preencher.

Preencha as 3 linhas essenciais da Twitch:

```bash
TWITCH_BOT_USERNAME=nome_do_seu_bot        # a conta do bot (pode ser uma secundária)
TWITCH_OAUTH_TOKEN=oauth:xxxxxxxxxxxxx     # token gerado em https://twitchtokengenerator.com/
TWITCH_CHANNEL=seu_canal                   # o canal que o bot vai monitorar
```

> 📝 **Como gerar o token da Twitch em 1 minuto:** acesse **https://twitchtokengenerator.com/** logado com a conta do *bot* → clique em **"Bot Chat Token"** (o card do robô verde) → **"Generate Token!"** → copie o **Access token**. O bot aceita o token com ou sem o prefixo `oauth:`. Guia completo com screenshots descritas na [seção de credenciais](#credenciais-passo-a-passo).

Salve o `.env`, feche o Bloco de Notas e rode o `iniciar.bat` de novo.

### 5. Abra o jogo

1. Abra o **emulador VBA-M** e carregue a ROM do jogo (File → Open);
2. Confira se os controles estão no mapeamento padrão ([tabela abaixo](#o-emulador-visual-boy-advance));
3. **Clique uma vez na janela do emulador** para deixá-lo em foco.

### 6. VAI!

O bot conecta no seu canal e anuncia os comandos no chat. Manda um `up` aí de teste... e assista o seu chat virar o jogador. 🎮

> ⚠️ **O emulador precisa estar em foco** para receber as teclas. Se você clicar em outra janela, os comandos vão parar no programa errado. Dica: deixe o emulador em modo janela ao lado do terminal do bot.
>
> 🛡️ **O Windows mostrou "Protegeu seu PC"?** É normal — o `.exe` não tem assinatura digital porque é um projeto gratuito. Clique em **Mais informações → Executar mesmo assim**.
>
> 🔒 **Nunca compartilhe seu `.env`** — ele contém o token do seu bot.

---

## O emulador (Visual Boy Advance)

### Onde baixar

<div align="center">

### 👉 **https://visualboyadvance.org/**

*VisualBoyAdvance-M — Game Boy, Game Boy Color e Game Boy Advance*

</div>

O **VBA-M** é a continuação mantida do clássico VisualBoyAdvance e é o emulador recomendado para este bot. Qualquer versão recente para Windows serve. Funciona com qualquer jogo de GB/GBC/GBA — Pokémon, Mario, Zelda, Kirby, Metroid... Se o jogo tem setas + A/B/L/R + Start/Select, o chat consegue jogar.

### Mapeamento padrão de teclas

O bot pressiona as teclas abaixo. Confira em **Options → Joypad → Configure 1** do emulador se o mapeamento bate (é o padrão do VBA-M):

| Botão do controle | Comando no chat | Tecla no seu PC |
|:---:|---|:---:|
| ⬆ Direção cima | `up` / `cima` | `↑` |
| ⬇ Direção baixo | `down` / `baixo` | `↓` |
| ⬅ Direção esquerda | `left` / `esquerda` | `←` |
| ➡ Direção direita | `right` / `direita` | `→` |
| 🅰 A | `a` | `X` |
| 🅱 B | `b` | `Z` |
| 🔵 L | `l` | `A` |
| 🔴 R | `r` | `S` |
| ▶ Start | `start` | `Enter` |
| ▦ Select | `select` / `seleciona` | `Backspace` |

> ✏️ Seu emulador usa outras teclas? Edite o objeto `MAPEAMENTO_PADRAO` no início de [`src/controllers/keyboard.js`](src/controllers/keyboard.js) — cada botão aceita setas, letras, números, `enter`, `backspace`, `space`, `tab` e `esc`.

### Foco na janela

O bot simula teclas **na janela que estiver em foco** no momento do comando. Isso significa:

- ✅ Emulador em foco → o jogo recebe o comando;
- ❌ Outra janela em foco → o comando "vaza" para o programa errado.

A prática que funciona em live: emulador em **modo janela** no lado esquerdo da tela, terminal do bot à direita. Você clica no emulador uma vez, dá play na live e não precisa mais mexer — o bot roda sozinho.

---

## Credenciais passo a passo

### Twitch (obrigatório)

<details open>
<summary><b>Opção 1 — Rápida com o twitchtokengenerator.com</b> (recomendada)</summary>

1. Crie uma conta no Twitch para ser o seu **bot** (ou reutilize uma conta secundária — nunca use a sua conta principal, o bot precisa "falar" no chat).
2. Acesse **https://twitchtokengenerator.com/** logado com a **conta do bot**.
3. Na tela inicial, clique em **"Bot Chat Token"** — é o card do robôzinho verde.
4. Clique em **"Generate Token!"** e autorize a aplicação.
5. Na tela de resultado aparecerão três campos — você só precisa do **Access token**:
   - ✅ **Access token** → cole em `TWITCH_OAUTH_TOKEN`
   - ❌ Refresh token → não é necessário
   - ❌ Client ID → não é necessário
6. Preencha também:
   - `TWITCH_BOT_USERNAME` = nome de usuário da conta do bot
   - `TWITCH_CHANNEL` = o canal que o bot vai monitorar (ex: `sindromegames`, sem `#`)

**Sobre o token:**
- O bot aceita com ou sem o prefixo `oauth:` (detecta e corrige sozinho);
- O token é exibido **apenas uma vez** — copie antes de fechar a página;
- O site é um serviço de terceiros (do swiftyspiffy, o mesmo autor do antigo twitchapps.com, que foi descontinuado em 2024). Para máxima segurança, use a Opção 2.

</details>

<details>
<summary><b>Opção 2 — Oficial via Twitch Developers</b> (para quem quer o caminho 100% oficial)</summary>

1. Acesse **https://dev.twitch.tv/console** logado com a conta do bot.
2. Clique em **Register Your Application**.
3. Preencha:
   - **Name**: `Pokemon Chat Plays` (ou qualquer nome)
   - **OAuth Redirect URLs**: `http://localhost:3000` (não é usado de fato, mas o campo é obrigatório)
   - **Category**: Chat Bot
4. Salve e copie o **Client ID**.
5. Em **Manage**, gere um **Client Secret**.
6. Rode o fluxo OAuth Authorization Code com os escopos `chat:read` e `chat:edit`. Guia oficial: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
7. O token final (formato `oauth:xxxx...`) vai em `TWITCH_OAUTH_TOKEN`.

</details>

### YouTube (opcional)

<details>
<summary><b>Como ativar o chat do YouTube</b></summary>

> O YouTube exige uma chave de API — não existe atalho sem OAuth2/API Key.

1. Acesse o **[Google Cloud Console](https://console.cloud.google.com/)** e crie (ou escolha) um projeto.
2. No menu, vá em **APIs & Services → Library** e ative a **YouTube Data API v3**.
3. Em **APIs & Services → Credentials**, clique em **Create Credentials → API Key**.
4. *(Recomendado)* Em **Restrict key**, limite a chave para *YouTube Data API v3*.
5. Copie a chave para `YOUTUBE_API_KEY` no `.env`.
6. Com a live aberta, copie o ID do vídeo da URL:
   - URL: `https://www.youtube.com/watch?v=ABC123DEF` → ID: `ABC123DEF`
7. Coloque em `YOUTUBE_VIDEO_ID` e ative:
   ```bash
   YOUTUBE_ENABLED=true
   ACTIVE_PLATFORMS=twitch,youtube
   ```

**Limitação importante:** com apenas uma API Key (sem OAuth2) o bot consegue **ler** o chat da live, mas não consegue enviar mensagens — o que não atrapalha, pois o bot precisa mesmo é de *ler os comandos*.

</details>

---

## Comandos

Não tem prefixo: qualquer mensagem do chat que seja **exatamente** um dos comandos abaixo aciona o bot. Acentos são ignorados automaticamente (`segurar cimá` funciona igual).

### Direções

| Comando | Ação |
|---|---|
| `up` · `cima` · `sobe` · `subir` | ⬆ Andar para cima |
| `down` · `baixo` · `desce` · `descer` | ⬇ Andar para baixo |
| `left` · `esquerda` · `esq` | ⬅ Andar para a esquerda |
| `right` · `direita` · `dir` | ➡ Andar para a direita |

### Botões

| Comando | Ação |
|---|---|
| `a` | 🅰 Botão A (confirmar, interagir) |
| `b` | 🅱 Botão B (cancelar, correr) |
| `l` | 🔵 Botão L |
| `r` | 🔴 Botão R |
| `start` | ▶ Botão Start (menu) |
| `select` · `seleciona` · `selecionar` | ▦ Botão Select |

### Segurar teclas (hold) — o pulo do gato da v2.2 🏆

O chat pode **segurar** uma tecla por um tempo, em vez de só dar um toque — perfeito para correr longas distâncias, nadar contra corredeira, escapar de pokémon selvagem sem parar...

| Comando | O que faz |
|---|---|
| `hold cima` (ou `segurar cima`) | Segura ⬆ por **1 segundo** (padrão) |
| `hold baixo 3` | Segura ⬇ por **3 segundos** |
| `hold up 500ms` | Segura ⬆ por **meio segundo** |
| `hold left 2s` | Aceita sufixo `s` ou `ms` (também `seg`, `segundos`) |
| `holdcima` · `holda` · `seguraresquerda` | Funciona também com o botão colado |
| `soltar` · `solta` · `solte` · `release` · `largar` | **Solta TODAS as teclas presas** na hora |

**Regras de tempo** (o `!segurar` no chat explica tudo isso também):

- Sem número → usa o padrão (`HOLD_DEFAULT_MS` = 1s);
- Número **≤ 30** sem sufixo → **segundos** (`hold cima 3` = 3s);
- Número **> 30** sem sufixo → **milissegundos** (`hold cima 500` = 0,5s);
- Sufixo explícito sempre vale: `500ms`, `2s`, `2seg`, `2segundos`;
- Máximo de **10 segundos** (`HOLD_MAX_MS`) — o chat não pode travar o jogo de propósito;
- Quem segurou recebe confirmação no chat: `🔒 @user segurou ⬆ CIMA por 3s`.

### Comandos de informação

| Comando | Ação |
|---|---|
| `!comandos` · `!commands` · `!cmd` | Lista **COMPLETA** de comandos (2 mensagens formatadas) |
| `!ajuda` · `!help` · `!socorro` | Mesma lista completa |
| `!segurar` · `!hold` · `!segura` | Ajuda detalhada só dos comandos de segurar |
| `!stats` · `!estatisticas` · `!status` | Estatísticas da live (total de comandos, tempo ligado, plataformas) |
| `!top` · `!ranking` · `!rank` · `!placar` | 🏆 Top 5 jogadores que mais mandaram comandos |
| `ola` · `oi` · `oie` · `hello` · `hey` · `hi` · `eae` · `salve` | Boas-vindas com dica rápida dos comandos |

> 💡 Todas as respostas do bot são formatadas com **emojis, separadores e múltiplas linhas** — muito mais legíveis no chat da Twitch. E o **anti-flood** cuida do resto: se 20 pessoas pedirem `!comandos` no mesmo segundo, o bot responde só uma vez (sem risco de rate-limit).
>
> 🚦 **Anti-spam:** cada usuário só pode mandar um comando a cada 1,5s (`COMMAND_COOLDOWN_MS`) — ninguém sozinho domina o jogo.

---

## Configuração (referência do .env)

Todas as opções ficam no arquivo `.env` (copiado do `.env.example`). Esta é a referência completa:

### Twitch

| Variável | Padrão | Descrição |
|---|:---:|---|
| `TWITCH_BOT_USERNAME` | — | **(obrigatório)** Nome de usuário da conta do bot |
| `TWITCH_OAUTH_TOKEN` | — | **(obrigatório)** Token OAuth (com ou sem prefixo `oauth:`) |
| `TWITCH_CHANNEL` | `sindromegames` | Canal que o bot vai monitorar (sem `#`) |

### YouTube

| Variável | Padrão | Descrição |
|---|:---:|---|
| `YOUTUBE_ENABLED` | `false` | Ativa o suporte ao YouTube |
| `YOUTUBE_API_KEY` | — | Chave da YouTube Data API v3 |
| `YOUTUBE_VIDEO_ID` | — | ID do vídeo da live (a parte depois de `v=` na URL) |

### Geral

| Variável | Padrão | Descrição |
|---|:---:|---|
| `ACTIVE_PLATFORMS` | `twitch` | Plataformas ativas, separadas por vírgula (`twitch,youtube`) |
| `COMMAND_COOLDOWN_MS` | `1500` | Cooldown por usuário, em ms — evita que um único viewer domine |
| `KEY_PRESS_DURATION_MS` | `230` | Quanto tempo cada toque de tecla dura (precisão dos passos) |
| `ANNOUNCE_INTERVAL_MIN` | `10` | Anuncia os comandos no chat a cada N minutos (0 = desativado) |
| `ENABLE_STATS` | `true` | Ativa as estatísticas (`!stats`, `!top`) |
| `DEBUG` | `false` | Logs detalhados para depuração |
| `ADMIN_PREFIX` | `!` | Prefixo dos comandos de informação |

### Segurar teclas (hold)

| Variável | Padrão | Descrição |
|---|:---:|---|
| `HOLD_DEFAULT_MS` | `1000` | Duração padrão do `hold cima` sem número |
| `HOLD_MAX_MS` | `10000` | Tempo máximo que uma tecla pode ficar presa (segurança) |
| `CONFIRM_COMMANDS` | `true` | Bot confirma no chat quem segurou/soltou teclas |

---

## Funcionalidades

> 🆕 **Novidades da v2.2.0:** segurar teclas (`hold`/`segurar`/`soltar`), `!comandos` completo e formatado, `!stats` e `!top` com ranking, refatoração total com 40 testes e CI com testes antes do build.

Comparado ao projeto original que o inspirou, esta versão traz:

**🎮 Jogo e controle**
- **Segurar teclas (hold) real** — keydown e keyup separados em todas as plataformas; `soltar` libera tudo na hora;
- **Twitch + YouTube simultâneos** — ative uma ou as duas plataformas;
- **Comandos em português E inglês** — `cima`/`up`, `esquerda`/`left`, `segurar`/`hold`, `seleciona`/`select`...;
- **`start` e `select`** funcionando (o original não tinha);
- **Acentos ignorados automaticamente** — `olá`, `cimá`, `segurá` tudo funciona.

**🛡️ Proteção para a sua live**
- **Cooldown por usuário** — ninguém sozinho domina o jogo;
- **Cooldown global** — não sobrecarrega o emulador nem degrada o jogo;
- **Anti-flood de respostas** — 20 pedidos de `!comandos` = 1 resposta;
- **Anúncio automático** dos comandos a cada X minutos (configurável);
- **Encerramento limpo** — `Ctrl+C` solta TODAS as teclas presas antes de desligar.

**🧱 Arquitetura**
- **Teclado 100% assíncrono** com fila sequencial — o bot nunca congela;
- **Backend sem compilação** — PowerShell + `keybd_event` (Windows), `xdotool` (Linux) ou `osascript` (macOS). Zero build tools, zero Visual Studio, zero robotjs;
- **Configuração via `.env`** — nada de credenciais escondidas no código;
- **Logs coloridos com níveis** e arquivo de log por dia;
- **40 testes automatizados** rodando offline com o `node:test` nativo;
- **CI no GitHub Actions** — os testes rodam antes de todo build do `.exe`;
- **.exe gerado automaticamente** a cada tag `v*` via GitHub Actions;
- **Setup interativo** (`npm run setup`) para quem nunca mexeu com `.env`.

---

## Modo desenvolvedor (Node.js)

Para desenvolvimento, Linux ou macOS — requer [Node.js 18+](https://nodejs.org/):

```bash
# 1. Clone o repositório
git clone https://github.com/felipinhobxd/Pokemon-Chat-Plays.git
cd Pokemon-Chat-Plays

# 2. Instale as dependências (sem build tools!)
npm install

# 3. Crie e preencha o .env
cp .env.example .env        # Windows: copy .env.example .env

# 4. Rode o bot
npm start
```

Scripts disponíveis:

| Comando | O que faz |
|---|---|
| `npm start` | Inicia o bot |
| `npm run dev` | Inicia com **auto-restart** ao editar o código (`node --watch`) |
| `npm run setup` | Setup interativo (pergunta tudo e monta o `.env`) |
| `npm test` | Roda os 40 testes automatizados |
| `npm run build` | Gera o `.exe` localmente (requer `pkg`) |

### Requisitos por sistema

| Sistema | Requisito | Observação |
|---|---|---|
| **Windows** | nada além do Node | usa PowerShell (já vem no Windows) |
| **Linux** | `xdotool` | `sudo apt install xdotool` (Debian/Ubuntu) |
| **macOS** | nada além do Node | usa osascript (já vem no macOS) |

---

## Testes

```bash
npm test
```

- **40 testes** cobrindo: parser de comandos (botões, aliases, hold com todas as unidades de tempo, soltar, acentos), formatação de mensagens e pipeline de mensagens com anti-flood;
- **100% offline** — não precisa de emulador, Twitch nem credenciais;
- **Compatível com Node 18, 20, 22 e 24+** (o wrapper `scripts/run-tests.js` lista os arquivos explicitamente, contornando as diferenças do runner entre versões);
- Roda automaticamente no **CI antes de todo build** do `.exe`.

---

## Como gerar o .exe

### Método 1 — Automático via GitHub Actions (recomendado)

Crie uma tag e empurre:

```bash
git tag v2.3.0
git push origin v2.3.0
```

A GitHub Action (`.github/workflows/build-release.yml`) roda os testes, compila no `windows-latest`, empacota o `.zip` e **cria a Release automaticamente** com tudo anexado.

### Método 2 — Local com o script

```bash
npm install -g pkg
node scripts/build.js
```

O `.exe` e os arquivos auxiliares ficam na pasta `dist/`.

### Método 3 — Manual

```bash
npm install
pkg . --targets node18-win-x64 --output PokemonChatPlays.exe --compress GZip
```

---

## Estrutura do projeto

```text
Pokemon-Chat-Plays/
├── .env.example               # Template de configuração (copie para .env)
├── .github/workflows/
│   └── build-release.yml      # CI: testes + build do .exe + release automática
├── iniciar.bat                # Duplo clique para iniciar no Windows
├── package.json
├── scripts/
│   ├── build.js               # Build local do .exe (via pkg)
│   ├── run-tests.js           # Wrapper de testes (compatível Node 18-24)
│   └── setup.js               # Setup interativo (npm run setup)
└── src/
    ├── index.js               # Ponto de entrada (banner, ciclo de vida, Ctrl+C)
    ├── config.js              # Carrega e valida o .env
    ├── commands.js            # Registro central de comandos + parser (hold, soltar)
    ├── messages.js            # Todas as mensagens do chat, formatadas e bonitas
    ├── handlers.js            # Pipeline compartilhado Twitch/YouTube + anti-flood
    ├── controllers/
    │   ├── twitch.js          # Cliente Twitch (tmi.js) com fila de envio
    │   ├── youtube.js         # Cliente YouTube (googleapis)
    │   └── keyboard.js        # Teclado assíncrono com hold (PowerShell/xdotool/osascript)
    ├── utils/
    │   ├── logger.js          # Logger colorido com níveis
    │   ├── cooldown.js        # Anti-spam por usuário + global
    │   └── stats.js           # Estatísticas de uso (com holds)
    └── tests/                 # 40 testes automatizados (node:test)
        ├── commands.test.js
        ├── messages.test.js
        └── handlers.test.js
```

---

## Solução de problemas

<details open>
<summary><b>🖥️ "Windows protegeu seu PC" ao rodar o .exe</b></summary>

O `.exe` não tem assinatura digital porque é um projeto gratuito e comunitário. Clique em **Mais informações → Executar mesmo assim**.

</details>

<details>
<summary><b>🎮 Os comandos não fazem nada</b></summary>

1. **O emulador está em foco?** Clique uma vez na janela do emulador (barra de título fica destacada).
2. **O mapeamento bate?** Compare o seu Joypad Config com a [tabela de mapeamento](#o-emulador-visual-boy-advance).
3. Ative `DEBUG=true` no `.env` e veja no terminal se os comandos estão chegando e as teclas sendo enviadas.

</details>

<details>
<summary><b>🔒 As teclas ficam presas / o personagem anda sozinho</b></summary>

1. Mande **`soltar`** no chat — libera todas as teclas na hora;
2. Feche o bot com `Ctrl+C` — ele solta tudo sozinho antes de encerrar;
3. Último caso: clique na janela do jogo e **aperte a tecla correspondente** no teclado físico para "resetar" o estado dela.

</details>

<details>
<summary><b>🤖 O bot não conecta na Twitch</b></summary>

- Verifique se `TWITCH_BOT_USERNAME` é o nome **da conta do bot** (não do seu canal);
- Verifique se o token foi gerado **logado com a conta do bot**;
- O token pode ter expirado — gere um novo em https://twitchtokengenerator.com/;
- Confirme que o bot aparece na lista de viewers do canal (ele precisa "entrar" no chat).

</details>

<details>
<summary><b>🔴 Erro 403 / cota excedida no YouTube</b></summary>

- Verifique se a **YouTube Data API v3** está ativada no projeto do Google Cloud;
- A cota padrão é 10.000 unidades/dia; cada leitura do chat custa ~5 unidades;
- Confirme que a API Key não está restrita para outro serviço/IP.

</details>

<details>
<summary><b>💬 O bot fala demais no chat</b></summary>

- As confirmações de hold/soltar podem ser desligadas: `CONFIRM_COMMANDS=false`;
- O anúncio automático pode ser espaçado ou desligado: `ANNOUNCE_INTERVAL_MIN=0`;
- O anti-flood já limita respostas repetidas (8s entre repetições).

</details>

<details>
<summary><b>⚠️ PowerShell bloqueado por política corporativa</b></summary>

Raro em máquinas domésticas. Se o teclado não funcionar em ambiente corporativo: rode como Administrador ou libere com `Set-ExecutionPolicy RemoteSigned`.

</details>

<details>
<summary><b>❓ Outro problema</b></summary>

1. Rode com `DEBUG=true` no `.env` e leia o terminal;
2. Veja os arquivos de log do dia em `logs/`;
3. Abra uma issue: https://github.com/felipinhobxd/Pokemon-Chat-Plays/issues

</details>

---

## FAQ

<details>
<summary><b>Posso usar em jogos que não sejam Pokémon?</b></summary>

Pode! Qualquer jogo de GB/GBC/GBA (ou até emuladores de outras plataformas) que use setas + A/B/L/R + Start/Select no teclado funciona — Mario, Zelda, Kirby, Metroid, Golden Sun... Ajuste o `MAPEAMENTO_PADRAO` em `src/controllers/keyboard.js` se precisar.

</details>

<details>
<summary><b>Onde eu consigo o emulador?</b></summary>

Em **https://visualboyadvance.org/** — baixe o VisualBoyAdvance-M (VBA-M) para o seu sistema. A configuração de controles está na [seção do emulador](#o-emulador-visual-boy-advance).

</details>

<details>
<summary><b>Preciso de duas contas na Twitch?</b></summary>

Recomendado, sim: uma conta principal (a que faz a live) e uma para o bot. O bot precisa entrar no chat e enviar mensagens, e usar a conta principal para isso polui o chat com mensagens duplicadas. Mas funciona com uma conta só se você quiser.

</details>

<details>
<summary><b>Quantos viewers aguentam?</b></summary>

O pipeline é assíncrono com fila de teclas, então o bot não trava. O limite prático é o **cooldown** (`COMMAND_COOLDOWN_MS`): com 1,5s por usuário, uma live com 100 viewers ativos dá ~60 comandos/segundo — muito acima do que o jogo consegue processar. Para chats gigantes, aumente o cooldown.

</details>

<details>
<summary><b>Funciona no Linux ou macOS?</b></summary>

Sim! No modo desenvolvedor (`npm start`). O teclado usa `xdotool` no Linux e `osascript` no macOS. O `.exe` plug-and-play é para Windows.

</details>

<details>
<summary><b>O bot pode banir ou modar o chat?</b></summary>

Não — ele usa apenas os escopos `chat:read` e `chat:edit` (ler e enviar mensagens). Nada de moderação, banimento ou acesso à sua conta.

</details>

---

## Créditos

- 🎮 **Projeto original:** [William-Droin/twitch-chat-plays-pokemon](https://github.com/William-Droin/twitch-chat-plays-pokemon) — a faísca inicial;
- 🇧🇷 **Versão brasileira turbinada:** **SindromeGames** — [Twitch](https://www.twitch.tv/sindromegames) · [YouTube](https://www.youtube.com/@SindromeGames);
- 🧰 **Bibliotecas:**
  - [tmi.js](https://github.com/tmijs/tmi.js) — cliente de chat da Twitch;
  - [googleapis](https://github.com/googleapis/google-api-nodejs-client) — YouTube Data API;
  - [dotenv](https://github.com/motdotla/dotenv) — variáveis de ambiente;
  - [pkg](https://github.com/vercel/pkg) — empacotamento em `.exe`.

Encontrou um bug ou tem uma ideia? Abra uma issue ou mande um PR — contribuições são muito bem-vindas! 🤝

---

## Licença e aviso legal

Distribuído sob a licença **MIT** — veja o arquivo [LICENSE](./LICENSE). Você pode usar, modificar e distribuir livremente, inclusive comercialmente, desde que mantenha o aviso de licença.

> ⚖️ **Aviso legal:** este projeto não é afiliado à Nintendo, Game Freak, The Pokémon Company, Twitch ou YouTube/Google. "Pokémon" é marca registrada da Nintendo. Use apenas ROMs de jogos que você possui legalmente.

