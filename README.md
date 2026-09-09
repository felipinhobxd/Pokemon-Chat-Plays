# Pokemon Chat Plays - SindromeGames Edition

> Bot que permite que o chat da **Twitch** e do **YouTube** jogue Pokémon (ou qualquer outro jogo de GameBoy/GBA) enviando comandos no chat.

Versão brasileira, melhorada e bilingue do projeto [twitch-chat-plays-pokemon](https://github.com/William-Droin/twitch-chat-plays-pokemon), criada para o canal **[SindromeGames](https://www.twitch.tv/sindromegames)** no Twitch e no YouTube **[@SindromeGames](https://www.youtube.com/@SindromeGames)**.

---

## Sumário

- [O que é](#o-que-é)
- [Funcionalidades](#funcionalidades)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
  - [Twitch](#twitch)
  - [YouTube](#youtube)
- [Uso](#uso)
- [Comandos](#comandos)
- [Personalização](#personalização)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Créditos](#créditos)
- [Licença](#licença)

---

## O que é

Este projeto é um bot Node.js que:

1. Conecta-se ao chat da sua live na **Twitch** (e opcionalmente no **YouTube**).
2. Fica monitorando cada mensagem enviada pelo público.
3. Quando alguém digita um comando como `a`, `b`, `up`, `down`, etc., o bot simula a tecla correspondente no seu teclado.
4. Com um emulador (como o VisualBoyAdvance) em foco, o jogo responde como se fosse você jogando — mas quem está no controle é o chat!

É exatamente a mesma ideia do famoso "Twitch Plays Pokémon", mas rodando localmente na sua máquina e na sua própria live.

---

## Funcionalidades

Comparado ao projeto original, esta versão traz:

- **Suporte a Twitch e YouTube simultaneamente.** Você pode ativar uma ou as duas plataformas.
- **Configuração via arquivo `.env`.** Nada mais de credenciais hardcoded no código.
- **Cooldown anti-spam.** Cada usuário só pode enviar um comando a cada X segundos, evitando que um único usuário domine o jogo.
- **Cooldown global.** Limita a taxa total de comandos para não sobrecarregar o emulador.
- **Comandos em português e inglês.** `cima`/`up`, `baixo`/`down`, `esquerda`/`left`, `direita`/`right`, `seleciona`/`select`, etc.
- **Comandos `start` e `select`.** O original só tinha direcionais + A/B/L/R.
- **Anúncio automático dos comandos.** A cada X minutos (configurável) o bot lembra o chat quais são os comandos.
- **Estatísticas de uso.** Conta quantas vezes cada comando foi executado, por plataforma e por usuário.
- **Logs coloridos com níveis.** Fácil de debugar, com arquivos de log por dia.
- **Encerramento limpo com `Ctrl+C`.** Desconecta tudo de forma segura.
- **Script de setup interativo.** Para iniciantes que nunca mexeram em `.env`.
- **Tratamento de erros robusto.** Reconexão automática do tmi.js, retentativa no YouTube em caso de quota excedida.
- **README, comentários e mensagens 100% em português.**

---

## Pré-requisitos

Antes de começar, você precisa de:

1. **Node.js 18+** instalado. Baixe em https://nodejs.org/
2. **Um emulador de GameBoy Advance** (recomendado: [VisualBoyAdvance-M](https://vba-m.com/)).
3. **Uma ROM de Pokémon** (Fire Red foi o jogo testado, mas funciona com qualquer GBA).
   > ⚠️ Por questões de direitos autorais, **não** incluímos ROMs no projeto. Você precisa obter a sua própria.
4. **Uma conta bot na Twitch** (recomendado: crie uma segunda conta só para o bot, em vez de usar sua conta principal).
5. **Token OAuth da Twitch** — gere em https://twitchapps.com/tmi/
6. *(Opcional)* **Chave de API do YouTube** — crie em https://console.cloud.google.com/ habilitando a "YouTube Data API v3".

---

## Instalação

```bash
# 1. Clone o repositorio
git clone https://github.com/felipinhobxd/Pokemon-Chat-Plays.git
cd Pokemon-Chat-Plays

# 2. Instale as dependencias
npm install
```

> **Aviso sobre `robotjs`:** este módulo é nativo (C++) e pode exigir build tools no seu sistema.
> - **Windows:** instale o [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) ou Visual Studio com "Desktop development with C++".
> - **macOS:** `xcode-select --install`
> - **Linux:** `sudo apt-get install build-essential libxtst-dev libpng-dev`

---

## Configuração

### Passo único: copiar `.env.example` para `.env`

```bash
# Linux / macOS
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

Ou rode o setup interativo:

```bash
npm run setup
```

Edite o arquivo `.env` com suas credenciais:

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
```

### Twitch

1. Crie uma conta no Twitch para o seu bot (ou reutilize uma conta secundária).
2. Acesse https://twitchapps.com/tmi/ estando logado com a conta do bot e clique em "Connect".
3. Copie o token gerado (formato `oauth:abcd1234...`) e cole em `TWITCH_OAUTH_TOKEN`.
4. Preencha `TWITCH_BOT_USERNAME` com o nome do bot e `TWITCH_CHANNEL` com o nome do seu canal (`sindromegames`).

### YouTube

> ⚠️ O YouTube exige uma chave de API. Não existe alternativa simples sem OAuth2.

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto (ou use um existente).
3. No menu, vá em **APIs & Services → Library** e ative a **YouTube Data API v3**.
4. Em **APIs & Services → Credentials**, crie uma **API Key**.
5. Restrinja a chave para "YouTube Data API v3" (recomendado).
6. Copie a chave para `YOUTUBE_API_KEY` no `.env`.
7. Quando você estiver com a live aberta no YouTube, copie o ID do vídeo da URL:
   - URL: `https://www.youtube.com/watch?v=ABC123DEF`
   - ID: `ABC123DEF`
8. Coloque em `YOUTUBE_VIDEO_ID`.
9. Defina `YOUTUBE_ENABLED=true` e `ACTIVE_PLATFORMS=twitch,youtube`.

> **Limitação importante:** com apenas uma **API Key** (sem OAuth2), o bot consegue *ler* mensagens do chat da live, mas **não consegue enviar** mensagens. Para enviar mensagens via bot no YouTube seria necessário OAuth2 com credenciais de aplicativo, o que é mais complexo. Para o uso deste projeto (lê comandos e executa no teclado), API Key é suficiente.

---

## Uso

1. **Abra o emulador** (VisualBoyAdvance-M) e carregue a ROM do jogo.
2. **Configure os controles no emulador** de acordo com o mapeamento padrão:

   | Botão GBA     | Tecla        |
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

   > Você pode mudar o mapeamento editando `MAPEAMENTO_PADRAO` no arquivo `src/controllers/keyboard.js`.

3. **Deixe o emulador em foco** (clique na janela dele uma vez).
4. **Inicie o bot**:

   ```bash
   npm start
   ```

5. **Vá para sua live** e peça para o chat digitar os comandos. Pronto! 🎮

> 💡 **Dica:** Use modo janela no emulador para alternar entre emulador e terminal do bot. Não precisa ficar com o emulador sempre em foco — apenas quando os comandos devem ser executados nele.

---

## Comandos

Qualquer mensagem no chat que contenha exatamente uma destas palavras (em minúsculas) aciona o bot:

| Comando              | Ação                     |
|----------------------|--------------------------|
| `a`                  | Botão A                  |
| `b`                  | Botão B                  |
| `up` ou `cima`       | Seta para cima           |
| `down` ou `baixo`    | Seta para baixo          |
| `left` ou `esquerda` | Seta para esquerda       |
| `right` ou `direita` | Seta para direita        |
| `l`                  | Botão L (ombro esquerdo) |
| `r`                  | Botão R (ombro direito)  |
| `start`              | Botão Start              |
| `select` ou `seleciona` | Botão Select          |

### Comandos administrativos

| Comando       | Ação                              |
|---------------|-----------------------------------|
| `!comandos`   | Bot responde com a lista completa |
| `!ajuda`      | Idem                              |
| `!help`       | Idem                              |
| `ola` / `olá` | Bot dá boas-vindas ao usuário     |

---

## Personalização

Todas as opções ficam no arquivo `.env`:

| Variável                  | Padrão     | Descrição                                            |
|---------------------------|------------|------------------------------------------------------|
| `TWITCH_BOT_USERNAME`     | —          | Nome do bot na Twitch                                |
| `TWITCH_OAUTH_TOKEN`      | —          | Token OAuth (gerar em twitchapps.com/tmi)            |
| `TWITCH_CHANNEL`          | sindromegames | Canal a monitorar                                  |
| `YOUTUBE_ENABLED`         | false      | Liga/desliga o cliente YouTube                       |
| `YOUTUBE_API_KEY`         | —          | Chave de API do YouTube                              |
| `YOUTUBE_VIDEO_ID`        | —          | ID do vídeo da live                                  |
| `ACTIVE_PLATFORMS`        | twitch     | Plataformas ativas, separadas por vírgula            |
| `COMMAND_COOLDOWN_MS`     | 1500       | Cooldown por usuário (ms)                            |
| `KEY_PRESS_DURATION_MS`   | 230        | Tempo que cada tecla fica pressionada (ms)          |
| `ANNOUNCE_INTERVAL_MIN`   | 10         | Intervalo do anúncio automático (min, 0 = desligado) |
| `ENABLE_STATS`            | true       | Ativa estatísticas de uso                            |
| `DEBUG`                   | false      | Liga logs de debug                                   |
| `ADMIN_PREFIX`             | !          | Prefixo para comandos administrativos                |

---

## Estrutura do projeto

```
Pokemon-Chat-Plays/
├── .env.example              # Template de configuracao (copie para .env)
├── .gitignore
├── LICENSE
├── package.json
├── README.md
├── scripts/
│   └── setup.js              # Setup interativo (npm run setup)
└── src/
    ├── index.js             # Ponto de entrada principal
    ├── config.js            # Carrega e valida o .env
    ├── controllers/
    │   ├── twitch.js        # Cliente Twitch (tmi.js)
    │   ├── youtube.js       # Cliente YouTube (googleapis)
    │   └── keyboard.js      # Mapeamento de comandos -> teclas (robotjs)
    └── utils/
        ├── logger.js        # Logger colorido com níveis
        ├── cooldown.js      # Anti-spam por usuário + global
        └── stats.js        # Estatísticas de uso
```

---

## Solução de problemas

### `Error: Cannot find module 'robotjs'`

Você não rodou `npm install`, ou o robotjs falhou ao compilar. Veja os pré-requisitos.

### O bot conecta, mas os comandos não fazem nada

- Verifique se o **emulador está em foco**. Clique na janela do emulador uma vez.
- Verifique se o **mapeamento de teclas no emulador** corresponde ao mapeamento do arquivo `keyboard.js`.
- Ative `DEBUG=true` no `.env` para ver logs detalhados.

### `Permission denied` ou `403` no YouTube

- Sua chave de API pode estar inválida ou você atingiu a quota diária.
- Verifique se a **YouTube Data API v3** está ativada no projeto.
- A quota padrão é 10.000 unidades/dia. Cada `liveChatMessages.list` custa ~5 unidades.

### O bot envia mensagens repetidas

- Pode ser o cooldown desativado ou muito baixo. Defina `COMMAND_COOLDOWN_MS=1500` ou maior.

### Erro `EADDRINUSE` ou porta em uso

- Outro processo Node pode estar rodando. Mate todos com `pkill -f node` (Linux/macOS) ou feche no Gerenciador de Tarefas (Windows).

### O bot não reconhece comandos em português

- Os aliases (`cima`, `baixo`, `esquerda`, `direita`, `seleciona`) estão mapeados em `src/controllers/keyboard.js` no objeto `ALIASES_PT`. Edite à vontade.

---

## Créditos

- Projeto original: [William-Droin/twitch-chat-plays-pokemon](https://github.com/William-Droin/twitch-chat-plays-pokemon)
- Versão melhorada e traduzida por **SindromeGames** ([Twitch](https://www.twitch.tv/sindromegames) / [YouTube](https://www.youtube.com/@SindromeGames))
- Bibliotecas usadas:
  - [tmi.js](https://github.com/tmijs/tmi.js) — cliente IRC da Twitch
  - [robotjs](https://github.com/octalmage/robotjs) — automação de teclado/mouse
  - [googleapis](https://github.com/googleapis/google-api-nodejs-client) — YouTube Data API
  - [dotenv](https://github.com/motdotla/dotenv) — variáveis de ambiente

---

## Licença

MIT — veja o arquivo [LICENSE](./LICENSE).

---

> ⚠️ **Aviso legal:** Este projeto não é afiliado à Nintendo, Game Freak, The Pokémon Company, Twitch ou YouTube/Google. "Pokémon" é marca registrada da Nintendo. Use apenas ROMs que você possui legalmente.
