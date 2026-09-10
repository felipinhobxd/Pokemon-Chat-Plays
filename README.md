# Pokémon Chat Plays

> **Your Twitch/YouTube chat plays the game.** A bot that turns live chat messages into real key presses on a Game Boy emulator — the classic Twitch Plays Pokémon experience, running on your own stream.

[![Release](https://img.shields.io/github/v/release/felipinhobxd/Pokemon-Chat-Plays?label=release)](https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases)
[![Licença](https://img.shields.io/github/license/felipinhobxd/Pokemon-Chat-Plays)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-137%20%E2%9C%94-brightgreen)](#development-nodejs--18)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-9146FF)](#development-nodejs--18)
[![Chat Twitch](https://img.shields.io/badge/chat-Twitch-9146FF?logo=twitch&logoColor=white)](https://www.twitch.tv/sindromegames)
[![Chat YouTube](https://img.shields.io/badge/chat-YouTube-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@SindromeGames)

## Highlights

- **Plug-and-play** — download the zip, fill `.env`, double-click `iniciar.bat`. No Node.js, no build tools.
- **Window mode** — keys go **straight to the emulator window** (via `PostMessage`), even minimized or unfocused. You're free to use OBS while the chat plays.
- **Democracy / Anarchy** — the classic vote mode: chat votes each step, only the most-voted input runs.
- **Save states from chat** — `salvar` / `carregar` let the crowd rewind time.
- **Hold keys** — real keydown/keyup: the chat can hold a direction to run or swim.
- **Streamer kit** — hotkey pause (F9), OBS overlay with live feed and ranking, persistent stats, auto update check.
- **Solid** — 137 automated tests, async key queue, anti-spam, auto-reconnect, clean `Ctrl+C`.

## Quick start (Windows)

1. **Download** `PokemonChatPlays-Windows.zip` from the [latest release](https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases/latest) and extract it.
2. **Copy** `.env.example` to `.env` and fill in your Twitch bot account:
   ```env
   TWITCH_BOT_USERNAME=your_bot_account
   TWITCH_OAUTH_TOKEN=oauth:your_token   # generate at twitchtokengenerator.com
   TWITCH_CHANNEL=your_channel
   ```
3. **Start the emulator** ([VBA-M](https://visualboyadvance.org/) recommended) and load your game.
4. **Run** `iniciar.bat`. When asked, paste the emulator `.exe` path (it's saved for next time — just press Enter afterwards). The bot connects and announces the commands in chat.

> 🛡️ *Windows says "protected your PC"? The exe has no digital signature — click **More info → Run anyway**.*
> 🔒 *Never share your `.env` — it contains your bot token.*

## Chat commands

No prefix needed — any message that is exactly a command triggers it. Accents are ignored.

| Command | Action |
|---|---|
| `up` `down` `left` `right` (or `cima` `baixo` `esquerda` `direita`) | Move |
| `a` `b` `l` `r` `start` `select` | Buttons |
| `hold cima` · `hold baixo 3` · `hold up 500ms` | Hold a key (seconds by default, `s`/`ms` suffixes) |
| `soltar` / `release` | Release all held keys |
| `salvar` / `carregar` (or `save` / `load`) | Emulator save state / load state |

**Info commands** (with `!`): `!comandos` (full list) · `!stats` · `!top` · `!uptime` · `!recorde` · `!democracia` / `!anarquia` / `!votacao` · `!segurar` (hold help). Greetings like `oi`/`hello` get a friendly reply with a command tip.

## Democracy × Anarchy

| Mode | How it works |
|---|---|
| ⚡ **Anarchy** (default) | Every command runs immediately, in arrival order — classic chaos |
| 🗳️ **Democracy** | Chat votes during a window (default 10 s); only the most-voted command runs at the end |

- Switch with `!democracia` / `!anarquia` / `!votacao` — chat changes respect a 30 s cooldown; the **channel owner** switches instantly.
- **Streamer hotkey F8** toggles the mode at any time.
- Voting works like playing: sending `up` or `a` counts as one vote (changeable — last vote wins). Ties go to whoever got the first vote sooner.
- The OBS overlay shows the live tally with countdown.

## Streamer tools

| Tool | How |
|---|---|
| ⏸️ **Pause the chat** | Press **F9** anywhere (configurable via `TECLA_PAUSA`). Releases held keys, warns the chat, overlay turns red. ENTER in the terminal also works. |
| 🗳️ **Switch mode** | Press **F8** (configurable via `TECLA_MODO`). Or type `modo` in the terminal. |
| 🖥️ **OBS overlay** | Add a Browser source pointing to `http://localhost:8899` — live feed, vote tally, gamepad, top players, held keys and status. |
| 📊 **Persistent stats** | Ranking and uptime survive restarts (`dados/stats.json`). |
| 📦 **Update check** | The bot warns in the terminal when a new release is out. |

**While paused:** game commands are blocked (including democracy winners) — info commands still work. The channel owner is exempt from cooldown.

## Emulator setup

The bot ships with presets (set `EMULADOR_PRESET` in `.env`):

| Preset | A | B | L | R | Start | Select | Save / Load |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `vbam` *(default)* | X | Z | A | S | Enter | Backspace | Shift+F5 / F5 |
| `mgba` | X | Z | A | S | Enter | Backspace | Shift+F5 / F5 |
| `desmume` | X | Z | Q | W | Enter | Shift | Shift+F5 / F5 |
| `retroarch` | X | Z | Q | W | Enter | Shift | F2 / F4 |

Override any single key with `TECLA_A=x`, `TECLA_SALVAR=shift+f1`, etc. Accepted names: arrows, `enter`, `backspace`, `space`, `tab`, `esc`, `shift`, `f1`–`f12`, `a`–`z`, `0`–`9`, and combos like `shift+f5`. Invalid keys never crash the bot — it warns and keeps the default.

> ⚠️ **RetroArch** reads the keyboard by polling, not messages — use `MODO_TECLADO=global` for it.

## Configuration (`.env`)

Copy `.env.example` → `.env`. The essentials:

| Variable | Default | Description |
|---|:---:|---|
| `TWITCH_BOT_USERNAME` / `TWITCH_OAUTH_TOKEN` / `TWITCH_CHANNEL` | — | Twitch bot credentials (token from [twitchtokengenerator.com](https://twitchtokengenerator.com/)) |
| `YOUTUBE_ENABLED` / `YOUTUBE_API_KEY` / `YOUTUBE_VIDEO_ID` | `false` | Optional YouTube live chat (read-only, API key) |
| `ACTIVE_PLATFORMS` | `twitch` | Platforms to connect (`twitch,youtube`) |
| `COMMAND_COOLDOWN_MS` | `1500` | Per-user cooldown — nobody solo-controls the game |
| `KEY_PRESS_DURATION_MS` | `230` | How long each key tap lasts |
| `EMULADOR_PRESET` / `EMULADOR_EXE` / `MODO_TECLADO` | `vbam` / *(ask at boot)* / `janela` | Emulator layout, target exe and key delivery mode |
| `MODO_INICIAL` / `VOTACAO_INTERVALO_MS` / `VOTACAO_TROCA_MIN_MS` | `anarquia` / `10000` / `30000` | Democracy settings |
| `TECLA_PAUSA` / `TECLA_MODO` | `f9` / `f8` | Streamer hotkeys (`off` disables) |
| `OVERLAY_ATIVA` / `OVERLAY_PORTA` | `true` / `8899` | OBS overlay server |
| `STATS_PERSISTENTES` / `STATS_ARQUIVO` | `true` / `dados/stats.json` | Persistent stats |

See `.env.example` for the full annotated list — every option has a comment explaining it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Windows blocked the exe | More info → Run anyway (no digital signature) |
| Keys don't reach the game | Emulator closed? The bot warns when the target window is missing. RetroArch: set `MODO_TECLADO=global` |
| Arrows move the character diagonally / wrong | Emulator remapped? Fix with `TECLA_UP` etc. |
| `Login authentication failed` | Regenerate the OAuth token — it expired or belongs to another account |
| Two bots answering | Another instance is running — close the old window |

## Development (Node.js ≥ 18)

```bash
npm install     # deps (tmi.js, googleapis, dotenv)
npm start       # run the bot
npm run dev     # run with auto-restart on file change
npm run setup   # interactive .env wizard
npm test        # 137 offline tests (no emulator/chat needed)
npm run build   # build the .exe locally (requires pkg)
```

Works on Windows (PowerShell), Linux (xdotool) and macOS (osascript). The `.exe` is built automatically by GitHub Actions on every `v*` tag, after tests pass.

<details>
<summary>Project structure</summary>

```
src/
├── index.js              # entry point / lifecycle
├── config.js             # .env loading and validation
├── commands.js           # chat message parser
├── handlers.js           # central pipeline (cooldown, pause, votes)
├── messages.js           # chat replies (PT-BR, emoji formatted)
├── presets.js            # emulator key presets
├── overlay.js            # embedded OBS overlay (HTTP, zero deps)
├── controllers/
│   ├── keyboard.js       # key injection (worker, PostMessage, combos)
│   ├── twitch.js         # tmi.js client + send queue
│   └── youtube.js        # YouTube Data API polling
└── utils/                # logger, stats, cooldown, pause, votes, update check
└── tests/                # 137 tests (node:test)
```

</details>

## Credits & license

Inspired by the original [Twitch Plays Pokémon](https://www.twitch.tv/twitchplayspokemon). This is a fan project — Pokémon and its trademarks belong to Nintendo/Game Freak/Creatures Inc.

MIT License — see [LICENSE](./LICENSE).
