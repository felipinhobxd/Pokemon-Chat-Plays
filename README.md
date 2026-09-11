# Pokémon Chat Plays

> **Your Twitch/YouTube chat plays the game.** A bot that turns live chat messages into real key presses on a Game Boy emulator — the classic Twitch Plays Pokémon experience, running on your own stream.

[![Release](https://img.shields.io/github/v/release/felipinhobxd/Pokemon-Chat-Plays?label=release)](https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases)
[![License](https://img.shields.io/github/license/felipinhobxd/Pokemon-Chat-Plays)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-270%20%E2%9C%94-brightgreen)](#development-nodejs--18)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-9146FF)](#development-nodejs--18)
[![Twitch chat](https://img.shields.io/badge/chat-Twitch-9146FF?logo=twitch&logoColor=white)](https://www.twitch.tv/sindromegames)
[![YouTube chat](https://img.shields.io/badge/chat-YouTube-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@SindromeGames)

## Highlights

- **Plug-and-play** — run `PokemonChatPlays-Setup.exe`, the config wizard opens in your browser, done. No Node.js, no build tools, no Notepad.
- **Setup wizard on every start** — opening `iniciar.bat` always shows the config UI in your browser, **pre-filled with everything you saved before** (Twitch bot, keys — shown masked —, game paths…): review, tweak, hit *Save & start*. Toggle Twitch/YouTube, **test each connection** before saving, set the **game path + ROM** with a one-click launch. `--direto` skips it; `npm run assistente` opens it standalone.
- **Any game, any emulator** — paste the path of ANY executable (VBA-M, mGBA, RetroArch, even Minecraft): the bot **opens it with the ROM**, and if the game closes mid-stream it **reopens it automatically** with the same ROM (crash-loop safe: 5 instant-crashes → gives up and warns).
- **Window mode** — keys go **straight to the emulator window** (via `PostMessage`), even minimized or unfocused. You're free to use OBS while the chat plays.
- **Fully configurable chat controls** — the wizard's **🎮 Chat Controls** section maps *any action* to *any key* and *any chat word*: remap A/B/directions, or add brand-new actions (`Pular → Space → pular, jump, espaço`). Aliases are auto-suggested (PT-BR + EN), editable, and checked for conflicts/reserved words before saving. Works for **any game** — Minecraft, Terraria, whatever — with no code changes. Both Twitch and YouTube read the same registry; `!comandos` and the auto-announcement always reflect what you configured. Presets (VBA-M, mGBA, DeSmuME, RetroArch) are just **starting templates**.
- **Democracy / Anarchy** — the classic vote mode: chat votes each step, only the most-voted input runs (works with custom controls too).
- **Save states from chat** — `salvar` / `carregar` let the crowd rewind time.
- **Hold keys** — real keydown/keyup: the chat can hold a direction to run or swim (custom controls too, when the key is holdable).
- **Streamer kit** — hotkey pause (F9), OBS overlay with live feed and ranking, persistent stats, auto update check.
- **Solid** — 270 automated tests, async key queue, anti-spam, auto-reconnect, clean `Ctrl+C`.

## Quick start (Windows)

1. **Download and run** `PokemonChatPlays-Setup.exe` from the [latest release](https://github.com/felipinhobxd/Pokemon-Chat-Plays/releases/latest) — installs per-user (no admin), with Start menu shortcuts and uninstaller. *(Portable alternative: `PokemonChatPlays-Windows.zip`.)*
2. **Every start opens the setup wizard** in your browser, **pre-filled with what you saved last time** — toggle Twitch/YouTube, paste your bot credentials and the live URL; the wizard **tests each connection** before saving. Then hit **Save & start** (or *Start without saving*). Saved keys come back **masked** (`••••••••abcd`): leave the field as-is to keep the saved value, clear it to remove, paste a new one to replace.
3. In the wizard's **🎮 Game / Emulator** card, paste the game executable path (any program works) and, for emulators, the **ROM path** — the bot verifies both and can even **launch the game** for you.
4. In the wizard's **🎮 Chat Controls** card, check the action → key → chat-word mapping. Apply a **template** (VBA-M, mGBA, DeSmuME, RetroArch) as a starting point and then customize freely: capture keys with the ⌨ button, add controls like `Pular → Space → pular, jump`, disable what the game doesn't use.
5. Hit **Save & start** — the bot **opens the game with the ROM automatically** (or attaches to it if already running) and announces the commands in chat. If the game crashes, the bot **reopens it** with the same ROM.

> 🛡️ *Windows says "protected your PC"? The exe has no digital signature — click **More info → Run anyway**.*
> 🔒 *Never share your `.env` — it contains your bot token.*

## Chat commands

No prefix needed — any message that is exactly a command triggers it. Accents are ignored. **The list below is the default control set** — everything is editable in the wizard (see [Chat Controls](#chat-controls-fully-configurable)).

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

## Chat Controls (fully configurable)

Every control is a triple: **action → keyboard key → chat words**. The wizard's **🎮 Chat Controls** card edits them all — and new controls need **zero code changes**:

- **Remap built-ins** — change the key or the chat words of `A`, `B`, directions, Start, Select, savestates.
- **Add any action** — Minecraft in 2 minutes: `Pular → Space → pular, pulo, jump` · `Inventário → E → inventario, inventory, e` · `Agachar → Shift → agachar, crouch`.
- **Key capture** — press the ⌨ button and then the physical key: `Space`→`space`, `Shift+F5`→`shift+f5`, arrows, `F1`–`F12`… Only keys the keyboard backend actually supports are accepted.
- **Auto-suggested aliases** — from the key (`space` → `space, espaço, barra de espaço`; `up` → `up, cima`) and the action name; always visible and editable. Accents are normalized (`espaço` ≡ `espaco`), duplicates collapse.
- **Conflict protection** — the same chat word on two active controls, or reserved system words (`hold`, `soltar`, `comandos`…), are **rejected before saving** — the wizard never silently picks a winner.
- **Same registry everywhere** — Twitch and YouTube, `!comandos`, the auto-announcement, democracy voting, hold, stats and the OBS overlay all read the same control list. Overlay, confirmations and winner messages use your action names.
- **Persistence** — controls are saved in `dados/controles.json` (versioned, atomic writes, survives reinstall/uninstall). Until you save controls in the wizard, `EMULADOR_PRESET` + `TECLA_*` from `.env` keep working exactly as before.
- **Templates, not limits** — the presets below just pre-fill the list; after applying one, edit whatever you want (the badge shows *Personalizado*).

## Emulator templates

The bot ships with key presets (set `EMULADOR_PRESET` in `.env`, or apply one in the wizard):

| Preset | A | B | L | R | Start | Select | Save / Load |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `vbam` *(default)* | X | Z | A | S | Enter | Backspace | Shift+F5 / F5 |
| `mgba` | X | Z | A | S | Enter | Backspace | Shift+F5 / F5 |
| `desmume` | X | Z | Q | W | Enter | Shift | Shift+F5 / F5 |
| `retroarch` | X | Z | Q | W | Enter | Shift | F2 / F4 |

Override any single key with `TECLA_A=x`, `TECLA_SALVAR=shift+f1`, etc. Accepted names: arrows, `enter`, `backspace`, `space`, `tab`, `esc`, `shift`, `f1`–`f12`, `a`–`z`, `0`–`9`, and combos like `shift+f5`. Invalid keys never crash the bot — it warns and keeps the default.

> ⚠️ **RetroArch** reads the keyboard by polling, not messages — use `MODO_TECLADO=global` for it.

## Game manager (open · watch · reopen)

Set `EMULADOR_EXE` (the wizard does it for you) and the bot takes care of the game itself:

- **On boot** — game not running? The bot opens it: `spawn(exe, [ROM, ...args])`. Already running? It just **attaches** (no second instance) and watches it.
- **Watchdog** — the game closes mid-stream → the bot waits `JOGO_REINICIAR_DELAY_MS` (3 s) and **reopens it with the same ROM**. The OBS overlay shows 🎮 running / 🔄 reopening live.
- **Crash-loop guard** — if the game dies "instantly" (under `JOGO_VIDA_MINIMA_MS`, 5 times in a row — wrong ROM, broken exe…), the bot **gives up** and warns instead of reopening forever. A run that lasted longer resets the counter, so real mid-stream crashes always get a reopen.
- **Ctrl+C never kills your game** — the watchdog stops, the game stays.

It works with anything you can launch: `EMULADOR_EXE=C:\Emuladores\visualboyadvance-m.exe` + `JOGO_ROM=C:\Games\Pokemon - Emerald.gba`, a launcher `.bat`, a `.jar`… For extra flags (RetroArch cores etc.) use `JOGO_ARGS`.

## Configuration (`.env`)

Copy `.env.example` → `.env` — or just open `iniciar.bat` (the wizard opens on every start, pre-filled) and fill everything in the browser. The essentials:

| Variable | Default | Description |
|---|:---:|---|
| `TWITCH_BOT_USERNAME` / `TWITCH_OAUTH_TOKEN` / `TWITCH_CHANNEL` | — | Twitch bot credentials (token from [twitchtokengenerator.com](https://twitchtokengenerator.com/)) |
| `YOUTUBE_ENABLED` / `YOUTUBE_API_KEY` / `YOUTUBE_VIDEO_ID` | `false` | Optional YouTube live chat (read-only, API key). `YOUTUBE_VIDEO_ID` accepts the **full live URL** — the bot extracts the ID |
| `ACTIVE_PLATFORMS` | `twitch` | Platforms to connect (`twitch,youtube`) |
| `COMMAND_COOLDOWN_MS` | `1500` | Per-user cooldown — nobody solo-controls the game |
| `KEY_PRESS_DURATION_MS` | `230` | How long each key tap lasts |
| `EMULADOR_PRESET` / `EMULADOR_EXE` / `MODO_TECLADO` | `vbam` / *(ask at boot)* / `janela` | Emulator layout, target exe and key delivery mode |
| `CONTROLES_ARQUIVO` | `dados/controles.json` | Where the wizard-saved control registry lives (has priority over `EMULADOR_PRESET`/`TECLA_*`) |
| `JOGO_ROM` / `JOGO_ARGS` / `JOGO_AUTO_REINICIAR` | — / — / `true` | Game manager: ROM opened with the exe, extra launch args, auto-reopen on crash |
| `JOGO_REINICIAR_DELAY_MS` / `JOGO_TENTATIVAS_MAX` / `JOGO_VIDA_MINIMA_MS` | `3000` / `5` / `15000` | Reopen delay and crash-loop limits |
| `MODO_INICIAL` / `VOTACAO_INTERVALO_MS` / `VOTACAO_TROCA_MIN_MS` | `anarquia` / `10000` / `30000` | Democracy settings |
| `TECLA_PAUSA` / `TECLA_MODO` | `f9` / `f8` | Streamer hotkeys (`off` disables) |
| `OVERLAY_ATIVA` / `OVERLAY_PORTA` | `true` / `8899` | OBS overlay server |
| `STATS_PERSISTENTES` / `STATS_ARQUIVO` | `true` / `dados/stats.json` | Persistent stats |

See `.env.example` for the full annotated list — every option has a comment explaining it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Windows blocked the exe | More info → Run anyway (no digital signature) |
| Keys don't reach the game | Emulator closed? The bot warns when the target window is missing — and with `EMULADOR_EXE` set it **reopens the game for you**. RetroArch: set `MODO_TECLADO=global` |
| Bot stopped reopening the game | Crash-loop guard kicked in: the game died instantly 5× in a row. Check the ROM path (`JOGO_ROM`) and whether the emulator opens it manually |
| Arrows move the character diagonally / wrong | Emulator remapped? Fix with `TECLA_UP` etc. |
| `Login authentication failed` | Regenerate the OAuth token — it expired or belongs to another account |
| `API key not valid` (YouTube) | Wrong `YOUTUBE_API_KEY` — create one at console.cloud.google.com with the **YouTube Data API v3** enabled |
| YouTube says quota exceeded | The free daily quota (10k units) reset at midnight Pacific time — the bot backs off and retries automatically |
| The live hasn't started yet | The bot keeps retrying YouTube every 60 s until the chat is live |
| Two bots answering | Another instance is running — close the old window |

## Development (Node.js ≥ 18)

```bash
npm install     # deps (tmi.js, googleapis, dotenv)
npm start       # run the bot
npm run dev     # run with auto-restart on file change
npm run assistente   # setup wizard in the browser
npm run setup   # terminal-only .env wizard (legacy)
npm test        # 270 offline tests (no emulator/chat needed)
npm run build   # build the .exe + setup.exe locally (requires pkg; NSIS optional)
```

Works on Windows (PowerShell), Linux (xdotool) and macOS (osascript). GitHub Actions builds `PokemonChatPlays-Setup.exe` (NSIS installer) and the portable zip on every `v*` tag, after tests pass.

<details>
<summary>Project structure</summary>

```
src/
├── index.js              # entry point / lifecycle
├── config.js             # .env loading and validation
├── controles.js          # central chat-control registry (aliases, keys, persistence)
├── commands.js           # chat message parser (reads the registry)
├── handlers.js           # central pipeline (cooldown, pause, votes)
├── messages.js           # chat replies (PT-BR, emoji formatted, dynamic)
├── presets.js            # emulator key presets (control templates)
├── overlay.js            # embedded OBS overlay (HTTP, zero deps)
├── controllers/
│   ├── keyboard.js       # key injection (worker, PostMessage, combos)
│   ├── twitch.js         # tmi.js client + send queue
│   └── youtube.js        # YouTube Data API polling
├── utils/                # logger, stats, cooldown, pause, votes, update check, game manager
└── tests/                # 270 tests (node:test)
```

</details>

## Credits & license

Inspired by the original [Twitch Plays Pokémon](https://www.twitch.tv/twitchplayspokemon). This is a fan project — Pokémon and its trademarks belong to Nintendo/Game Freak/Creatures Inc.

MIT License — see [LICENSE](./LICENSE).
