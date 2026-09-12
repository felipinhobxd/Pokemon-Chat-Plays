from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    s = read(path)
    if old not in s:
        raise SystemExit(f'pattern not found in {path}: {old[:180]!r}')
    write(path, s.replace(old, new, 1))


def append_once(path, marker, block):
    s = read(path)
    if marker in s:
        return
    write(path, s.rstrip() + '\n\n' + block.rstrip() + '\n')


# ---------------------------------------------------------------------------
# jogo.js: launchers podem iniciar o jogo real sem serem o processo vigiado.
# ---------------------------------------------------------------------------
replace_once(
    'src/utils/jogo.js',
    "  vidaMinimaMs: 15000,\n};\n\nlet procAtual = null;",
    "  vidaMinimaMs: 15000,\n  startupGraceMs: 0,\n  nomeGerenciado: '',\n};\n\nlet procAtual = null;"
)
replace_once(
    'src/utils/jogo.js',
    "let detectorDeProcesso = null;\n\n/** Notifica o index.js",
    "let detectorDeProcesso = null;\nlet lancadorCustom = null;\nlet aguardandoSubidaAte = 0;\n\nfunction nomeGerenciado() {\n  return String(cfg.nomeGerenciado || '').trim() || nomeDoProcesso(cfg.exe);\n}\n\n/** Notifica o index.js"
)

old_lancar = '''/** Abre o jogo (exe + ROM + args). Resolve true se o processo nasceu. */
function lancar() {
  const { file, args, cwd } = montarLinhaComando(cfg);
  if (!file) return false;

  try {
    const filho = spawn(file, args, {
      cwd: cwd || undefined,
      stdio: 'ignore',       // a saída do jogo não polui o terminal do bot
      detached: false,       // filho morde o mesmo console (sem flash de cmd)
    });
    procAtual = filho;
    inicioDaVida = Date.now();
    rodando = true;
    modoOperacao = 'spawn';

    const geracaoLancamento = geracao;
    const ehAtual = () => filho === procAtual && geracaoLancamento === geracao;

    filho.on('error', (err) => {
      // spawn falhou (exe não existe etc.) — o 'exit' pode nem chegar
      logger.erro(`[Jogo] Não consegui abrir "${file}" (${err.message}).`);
      if (ehAtual()) tratarFechamento();
    });
    filho.on('exit', (codigo) => {
      if (!ehAtual()) return; // notícia de processo velho — ignora
      logger.info(`[Jogo] Processo terminou (código ${codigo}).`);
      tratarFechamento();
    });
    return true;
  } catch (err) {
    logger.erro(`[Jogo] Erro ao abrir "${file}": ${err.message}`);
    tratarFechamento();
    return false;
  }
}'''
new_lancar = '''/**
 * Abre o jogo. Em fluxos normais faz spawn(exe). Com `lancadorCustom`, o
 * executável configurado é apenas o launcher e o processo real é detectado
 * separadamente (ex.: ATLauncher -> javaw.exe do Minecraft).
 */
async function lancar() {
  if (lancadorCustom) {
    const minhaGeracao = geracao;
    try {
      const ok = await Promise.resolve().then(() => lancadorCustom());
      if (!ok || minhaGeracao !== geracao || encerrando) return false;
      procAtual = null;
      rodando = false;
      inicioDaVida = 0;
      modoOperacao = 'launcher';
      aguardandoSubidaAte = Date.now() + Math.max(0, Number(cfg.startupGraceMs) || 0);
      notificar('launcher-acionado', { aguardandoSubida: true });
      iniciarPing();
      return true;
    } catch (err) {
      logger.erro(`[Jogo] Launcher falhou: ${err?.message || err}`);
      return false;
    }
  }

  const { file, args, cwd } = montarLinhaComando(cfg);
  if (!file) return false;

  try {
    const filho = spawn(file, args, {
      cwd: cwd || undefined,
      stdio: 'ignore',       // a saída do jogo não polui o terminal do bot
      detached: false,       // filho morde o mesmo console (sem flash de cmd)
    });
    procAtual = filho;
    inicioDaVida = Date.now();
    aguardandoSubidaAte = 0;
    rodando = true;
    modoOperacao = 'spawn';

    const geracaoLancamento = geracao;
    const ehAtual = () => filho === procAtual && geracaoLancamento === geracao;

    filho.on('error', (err) => {
      // spawn falhou (exe não existe etc.) — o 'exit' pode nem chegar
      logger.erro(`[Jogo] Não consegui abrir "${file}" (${err.message}).`);
      if (ehAtual()) tratarFechamento();
    });
    filho.on('exit', (codigo) => {
      if (!ehAtual()) return; // notícia de processo velho — ignora
      logger.info(`[Jogo] Processo terminou (código ${codigo}).`);
      tratarFechamento();
    });
    return true;
  } catch (err) {
    logger.erro(`[Jogo] Erro ao abrir "${file}": ${err.message}`);
    tratarFechamento();
    return false;
  }
}'''
replace_once('src/utils/jogo.js', old_lancar, new_lancar)

replace_once(
    'src/utils/jogo.js',
    "  inicioDaVida = 0;\n\n  const decisao = avaliarQueda({",
    "  inicioDaVida = 0;\n  aguardandoSubidaAte = 0;\n\n  const decisao = avaliarQueda({"
)
replace_once(
    'src/utils/jogo.js',
    "  timerReabrir = setTimeout(() => {\n    timerReabrir = null;\n    if (encerrando || desistiu || geracaoAgendada !== geracao) return;\n    const nasceu = lancar();\n    if (nasceu) {\n      reinicios++;\n      notificar('reaberto');\n    }\n  }, Math.max(0, Number(cfg.delayMs) || 0));",
    "  timerReabrir = setTimeout(async () => {\n    timerReabrir = null;\n    if (encerrando || desistiu || geracaoAgendada !== geracao) return;\n    const nasceu = await lancar();\n    if (nasceu && !encerrando && geracaoAgendada === geracao) {\n      reinicios++;\n      notificar('reaberto');\n    }\n  }, Math.max(0, Number(cfg.delayMs) || 0));"
)

old_ping = '''function iniciarPing() {
  pararPing();
  const minhaGeracao = geracao;
  const ciclo = async () => {
    timerPing = null;
    if (minhaGeracao !== geracao || encerrando || desistiu || procAtual) return;
    if (pingEmVoo) return;
    pingEmVoo = true;
    let vivo = null;
    try { vivo = await jogoEstaRodando(); } finally { pingEmVoo = false; }
    if (minhaGeracao !== geracao || encerrando || desistiu || procAtual) return;
    if (vivo === false) {
      logger.info('[Jogo] Detectei que o jogo foi fechado (vigília por ping).');
      inicioDaVida = inicioDaVida || (Date.now() - INTERVALO_PING_MS * 2);
      tratarFechamento();
      return;
    }
    // true ou null: nunca sobrepõe uma nova consulta à anterior.
    timerPing = setTimeout(ciclo, INTERVALO_PING_MS);
    timerPing.unref?.();
  };
  timerPing = setTimeout(ciclo, INTERVALO_PING_MS);
  timerPing.unref?.();
}'''
new_ping = '''function iniciarPing() {
  pararPing();
  const minhaGeracao = geracao;
  const reagendar = (ciclo) => {
    timerPing = setTimeout(ciclo, INTERVALO_PING_MS);
    timerPing.unref?.();
  };
  const ciclo = async () => {
    timerPing = null;
    if (minhaGeracao !== geracao || encerrando || desistiu || procAtual) return;
    if (pingEmVoo) { reagendar(ciclo); return; }
    pingEmVoo = true;
    let vivo = null;
    try { vivo = await jogoEstaRodando(); } finally { pingEmVoo = false; }
    if (minhaGeracao !== geracao || encerrando || desistiu || procAtual) return;

    if (vivo === true) {
      if (!rodando) {
        rodando = true;
        inicioDaVida = Date.now();
        aguardandoSubidaAte = 0;
        notificar('detectado');
        logger.info(`[Jogo] ✅ ${nomeGerenciado()} detectado — vigília ativa.`);
      }
      reagendar(ciclo);
      return;
    }

    if (vivo === false) {
      if (!rodando && aguardandoSubidaAte > Date.now()) {
        // Launcher já foi acionado, mas Java/Minecraft ainda está subindo.
        reagendar(ciclo);
        return;
      }
      if (!rodando && aguardandoSubidaAte) {
        logger.aviso(`[Jogo] ${nomeGerenciado()} não apareceu dentro do tempo de inicialização.`);
      } else {
        logger.info('[Jogo] Detectei que o jogo foi fechado (vigília por ping).');
      }
      inicioDaVida = inicioDaVida || (Date.now() - INTERVALO_PING_MS * 2);
      tratarFechamento();
      return;
    }

    // null = detector indisponível: nunca assume que o jogo morreu.
    reagendar(ciclo);
  };
  reagendar(ciclo);
}'''
replace_once('src/utils/jogo.js', old_ping, new_ping)

replace_once(
    'src/utils/jogo.js',
    " * Define os parâmetros do gerenciador.\n * @param {object} opts - { exe, rom, args, autoReiniciar, delayMs,\n *   tentativasMax, vidaMinimaMs, aoEvento, detector (testes) }",
    " * Define os parâmetros do gerenciador.\n * @param {object} opts - { exe, rom, args, autoReiniciar, delayMs,\n *   tentativasMax, vidaMinimaMs, aoEvento, detector, lancador,\n *   startupGraceMs, nomeGerenciado }"
)
replace_once(
    'src/utils/jogo.js',
    "    vidaMinimaMs: Number(opts.vidaMinimaMs) >= 0 ? Number(opts.vidaMinimaMs) : 15000,\n  };\n  if (typeof opts.aoEvento === 'function') aoEvento = opts.aoEvento;\n  detectorDeProcesso = typeof opts.detector === 'function' ? opts.detector : null;",
    "    vidaMinimaMs: Number(opts.vidaMinimaMs) >= 0 ? Number(opts.vidaMinimaMs) : 15000,\n    startupGraceMs: Number(opts.startupGraceMs) >= 0 ? Number(opts.startupGraceMs) : 0,\n    nomeGerenciado: String(opts.nomeGerenciado || ''),\n  };\n  if (typeof opts.aoEvento === 'function') aoEvento = opts.aoEvento;\n  detectorDeProcesso = typeof opts.detector === 'function' ? opts.detector : null;\n  lancadorCustom = typeof opts.lancador === 'function' ? opts.lancador : null;"
)
replace_once(
    'src/utils/jogo.js',
    "    logger.info(`[Jogo] 🎮 \"${nomeDoProcesso(cfg.exe)}\" já está rodando — só vigiando (reabro se fechar).`);",
    "    logger.info(`[Jogo] 🎮 \"${nomeGerenciado()}\" já está rodando — só vigiando (reabro se fechar).`);"
)
replace_once(
    'src/utils/jogo.js',
    "  const nasceu = lancar();\n  if (nasceu) {\n    notificar('aberto');\n    const romTxt = cfg.rom ? ` com ${nomeDoProcesso(cfg.rom)}` : '';\n    logger.info(`[Jogo] 🚀 Abri o jogo \"${nomeDoProcesso(cfg.exe)}\"${romTxt} — reabro sozinho se fechar (JOGO_AUTO_REINICIAR=${cfg.autoReiniciar ? 'on' : 'off'}).`);\n  }\n  return { ok: nasceu, modo: nasceu ? 'spawn' : 'off' };",
    "  const nasceu = await lancar();\n  if (nasceu) {\n    notificar('aberto');\n    const romTxt = cfg.rom ? ` com ${nomeDoProcesso(cfg.rom)}` : '';\n    if (lancadorCustom) {\n      logger.info(`[Jogo] 🚀 Launcher acionado para abrir ${nomeGerenciado()} — aguardando o processo real do jogo.`);\n    } else {\n      logger.info(`[Jogo] 🚀 Abri o jogo \"${nomeGerenciado()}\"${romTxt} — reabro sozinho se fechar (JOGO_AUTO_REINICIAR=${cfg.autoReiniciar ? 'on' : 'off'}).`);\n    }\n  }\n  return { ok: nasceu, modo: nasceu ? (lancadorCustom ? 'launcher' : 'spawn') : 'off' };"
)
replace_once(
    'src/utils/jogo.js',
    "  pararPing();\n  procAtual = null;\n  rodando = false;\n}",
    "  pararPing();\n  procAtual = null;\n  aguardandoSubidaAte = 0;\n  rodando = false;\n}"
)
replace_once(
    'src/utils/jogo.js',
    "    nome: nomeDoProcesso(cfg.exe),",
    "    nome: nomeGerenciado(),\n    aguardandoSubida: Boolean(aguardandoSubidaAte && aguardandoSubidaAte > Date.now()),"
)
replace_once(
    'src/utils/jogo.js',
    "  detectorDeProcesso = null;\n  pingEmVoo = false;\n  geracao = 0;\n  cfg = {\n    exe: '', rom: '', args: '', autoReiniciar: true,\n    delayMs: 3000, tentativasMax: 5, vidaMinimaMs: 15000,\n  };",
    "  detectorDeProcesso = null;\n  lancadorCustom = null;\n  aguardandoSubidaAte = 0;\n  pingEmVoo = false;\n  geracao = 0;\n  cfg = {\n    exe: '', rom: '', args: '', autoReiniciar: true,\n    delayMs: 3000, tentativasMax: 5, vidaMinimaMs: 15000,\n    startupGraceMs: 0, nomeGerenciado: '',\n  };"
)

# ---------------------------------------------------------------------------
# Mouse global: Minecraft pode usar a janela em foco sem confundir launcher.
# ---------------------------------------------------------------------------
replace_once(
    'src/controllers/mouse.js',
    '    [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorPos(out POINT lpPoint);',
    '    [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorPos(out POINT lpPoint);\n    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();'
)
replace_once(
    'src/controllers/mouse.js',
    '''    static IntPtr FindWindow() {
        if (String.IsNullOrWhiteSpace(Target)) return IntPtr.Zero;
        string name;''',
    '''    static IntPtr FindWindow(bool allowForeground) {
        if (String.IsNullOrWhiteSpace(Target)) return allowForeground ? GetForegroundWindow() : IntPtr.Zero;
        string name;'''
)
replace_once(
    'src/controllers/mouse.js',
    '''        return fallback;
    }

    static bool GetArea(out IntPtr hwnd, out RECT rect, out POINT origin) {
        hwnd = FindWindow();''',
    '''        if (fallback != IntPtr.Zero) return fallback;
        return allowForeground ? GetForegroundWindow() : IntPtr.Zero;
    }

    static bool GetArea(out IntPtr hwnd, out RECT rect, out POINT origin, bool allowForeground = false) {
        hwnd = FindWindow(allowForeground);'''
)
replace_once(
    'src/controllers/mouse.js',
    "        if (!GetArea(out hwnd, out rect, out origin)) return false;\n        GetCursorPos(out cursor);",
    "        if (!GetArea(out hwnd, out rect, out origin, true)) return false;\n        GetCursorPos(out cursor);"
)
replace_once(
    'src/controllers/mouse.js',
    "function iniciarWorker() {\n  if (plataformaAtual() !== 'win32' || modo === 'off' || !alvoExe) return false;",
    "function iniciarWorker() {\n  if (plataformaAtual() !== 'win32' || modo === 'off' || (modo === 'janela' && !alvoExe)) return false;"
)
replace_once(
    'src/controllers/mouse.js',
    "        env: { ...process.env, CHATPLAYS_MOUSE_TARGET: alvoExe },",
    "        env: { ...process.env, CHATPLAYS_MOUSE_TARGET: alvoExe || '' },"
)
# two guards: enviar() and segurar()
s = read('src/controllers/mouse.js')
guard = "  if (!alvoExe) {\n    avisar('configure EMULADOR_EXE para limitar o mouse à janela do jogo.');\n    return false;\n  }"
if s.count(guard) != 2:
    raise SystemExit(f'expected 2 mouse target guards, got {s.count(guard)}')
s = s.replace(guard, "  if (modo === 'janela' && !alvoExe) {\n    avisar('configure EMULADOR_EXE para usar o mouse em modo janela.');\n    return false;\n  }")
write('src/controllers/mouse.js', s)

# ---------------------------------------------------------------------------
# index.js: ATLauncher é launcher; Java/Minecraft é o processo real.
# ---------------------------------------------------------------------------
replace_once(
    'src/index.js',
    "const jogo = require('./utils/jogo');\nconst votacao = require('./utils/votacao');",
    "const jogo = require('./utils/jogo');\nconst minecraftLauncher = require('./utils/minecraft-launcher');\nconst votacao = require('./utils/votacao');"
)
replace_once(
    'src/index.js',
    "function iniciarGerenciadorJogo() {\n  if (!exeDoJogo) return;\n\n  jogo.configurar({",
    "function iniciarGerenciadorJogo() {\n  if (!exeDoJogo) return;\n\n  const usarLauncherMinecraft =\n    String(config.teclado.preset || '').toLowerCase() === 'minecraft' &&\n    minecraftLauncher.ehAtLauncher(exeDoJogo);\n\n  if (usarLauncherMinecraft) {\n    logger.info('[Minecraft] ATLauncher configurado — o ChatPlays vai abrir/reutilizar o launcher e acionar Instances → Play.');\n  }\n\n  jogo.configurar({"
)
replace_once(
    'src/index.js',
    "    vidaMinimaMs: config.jogo.vidaMinimaMs,\n    aoEvento: (ev) => {",
    "    vidaMinimaMs: config.jogo.vidaMinimaMs,\n    detector: usarLauncherMinecraft ? () => minecraftLauncher.minecraftEstaRodando() : undefined,\n    lancador: usarLauncherMinecraft ? () => minecraftLauncher.iniciarAtLauncher(exeDoJogo) : undefined,\n    startupGraceMs: usarLauncherMinecraft ? 180000 : 0,\n    nomeGerenciado: usarLauncherMinecraft ? 'Minecraft' : '',\n    aoEvento: (ev) => {"
)
replace_once(
    'src/index.js',
    "  // Mouse/gamepad são importados antes do wizard pelo pipeline; sincronize-os\n  // agora com a configuração FINAL para não manter modo/alvo antigo.\n  mouse.configurar({\n    modo: config.mouse.modo,\n    alvoExe: exeDoJogo,\n    passoPx: config.mouse.passoPx,\n  });",
    "  // Minecraft Java é iniciado pelo launcher, mas teclado/mouse precisam agir\n  // no JOGO real. No ATLauncher, input global evita usar a janela do launcher\n  // como alvo; o mouse global usa a janela em foco (Minecraft).\n  const launcherMinecraftAtivo =\n    String(config.teclado.preset || '').toLowerCase() === 'minecraft' &&\n    minecraftLauncher.ehAtLauncher(exeDoJogo);\n  if (launcherMinecraftAtivo && config.teclado.modo !== 'global') {\n    teclado.configurarAlvoJanela(null);\n    overlay.setAlvo(null);\n    logger.aviso('[Minecraft] ATLauncher detectado: forçando teclado GLOBAL para controlar o Minecraft, não o launcher.');\n  }\n\n  // Mouse/gamepad são importados antes do wizard pelo pipeline; sincronize-os\n  // agora com a configuração FINAL para não manter modo/alvo antigo.\n  mouse.configurar({\n    modo: launcherMinecraftAtivo ? 'global' : config.mouse.modo,\n    alvoExe: launcherMinecraftAtivo ? null : exeDoJogo,\n    passoPx: config.mouse.passoPx,\n  });"
)

# ---------------------------------------------------------------------------
# Wizard: caminho pode ser launcher; preset Minecraft configura input global.
# ---------------------------------------------------------------------------
replace_once(
    'src/assistente-pagina.js',
    "  '      <label for=\"f-exe\">Caminho do executável (o jogo que o bot abre e controla)</label>',\n  '      <input id=\"f-exe\" placeholder=\"C:\\\\Users\\\\Admin\\\\Downloads\\\\visualboyadvance-m-Win-x86_64\\\\visualboyadvance-m.exe\" autocomplete=\"off\" spellcheck=\"false\">',\n  '      <div class=\"dica\">Cola o caminho completo do <b>.exe</b> (clique direito no arquivo → “Copiar como caminho”). Serve <b>qualquer programa</b>: VBA-M, mGBA, RetroArch, DeSmuME, Minecraft… Se já estiver aberto, o bot só vigia (não abre 2º).</div>',",
    "  '      <label for=\"f-exe\">Caminho do executável ou launcher</label>',\n  '      <input id=\"f-exe\" placeholder=\"C:\\\\Users\\\\Admin\\\\AppData\\\\Roaming\\\\ATLauncher\\\\ATLauncher.exe\" autocomplete=\"off\" spellcheck=\"false\">',\n  '      <div class=\"dica\">Emuladores/jogos: cole o <b>.exe</b>. Para <b>Minecraft Java</b>, cole o launcher. Com o modelo Minecraft + <b>ATLauncher</b>, o ChatPlays abre/reutiliza o launcher, entra em <b>Instances</b> e aperta <b>Play</b> automaticamente.</div>',"
)
replace_once(
    'src/assistente-pagina.js',
    "  '  if (sel === \"minecraft\") {',\n  '    $(\"f-modo-mouse\").value = \"global\";',",
    "  '  if (sel === \"minecraft\") {',\n  '    $(\"f-modo-teclado\").value = \"global\";',\n  '    $(\"f-modo-mouse\").value = \"global\";',"
)
replace_once(
    'src/assistente-pagina.js',
    "  '  if (sel === \"minecraft\") mostrarRes($(\"res-controles\"), \"ok\", \"✔ Minecraft pronto: WASD + mouse global; use mouse/olhar cima, baixo, esquerda e direita.\");',",
    "  '  if (sel === \"minecraft\") mostrarRes($(\"res-controles\"), \"ok\", \"✔ Minecraft pronto: teclado + mouse globais. Com ATLauncher, informe o launcher; o bot faz Instances → Play automaticamente.\");',"
)

replace_once(
    'src/assistente.js',
    "    '# Caminho completo do .exe do jogo/emulador (qualquer programa serve:',\n    '# VBA-M, mGBA, RetroArch, Minecraft...). Vazio = o bot pergunta no terminal.',\n    `EMULADOR_EXE=${val('EMULADOR_EXE')}`,",
    "    '# Caminho do jogo/emulador OU launcher. Para Minecraft Java, use o launcher.',\n    '# ATLauncher: o ChatPlays abre/reutiliza, entra em Instances e aperta Play.',\n    '# Ex.: C:\\\\Users\\\\Admin\\\\AppData\\\\Roaming\\\\ATLauncher\\\\ATLauncher.exe',\n    `EMULADOR_EXE=${val('EMULADOR_EXE')}`,"
)

replace_once(
    '.env.example',
    "# Serve QUALQUER programa: VBA-M, mGBA, RetroArch, DeSmuME, Minecraft...\n# Deixe VAZIO para o bot perguntar no terminal ao iniciar (o caminho\n# fica salvo em dados/emulador.json — Enter mantém o último usado).\n# EMULADOR_EXE=C:\\\\Emuladores\\\\visualboyadvance-m.exe",
    "# Serve qualquer jogo/emulador. Para Minecraft Java, configure\n# EMULADOR_PRESET=minecraft e coloque aqui o LAUNCHER. O ATLauncher é\n# automatizado: o bot abre/reutiliza, entra em Instances e aperta Play.\n# Deixe VAZIO para o bot perguntar no terminal ao iniciar.\n# EMULADOR_EXE=C:\\\\Users\\\\Admin\\\\AppData\\\\Roaming\\\\ATLauncher\\\\ATLauncher.exe"
)

# ---------------------------------------------------------------------------
# README + documentação específica.
# ---------------------------------------------------------------------------
replace_once(
    'README.md',
    '- **Any game, any emulator** — paste the path of ANY executable (VBA-M, mGBA, RetroArch, even Minecraft): the bot **opens it with the ROM**, and if the game closes mid-stream it **reopens it automatically** with the same ROM (crash-loop safe: 5 instant-crashes → gives up and warns).',
    '- **Any game, any emulator — plus Minecraft launchers** — normal games/emulators use their `.exe`; for Minecraft Java, select the Minecraft preset and paste the launcher path. **ATLauncher is automated**: ChatPlays opens/reuses it, goes to **Instances → Play**, then watches the real Java/Minecraft process and can relaunch it after a crash.'
)
replace_once(
    'README.md',
    '3. In the wizard\'s **🎮 Game / Emulator** card, paste the game executable path (any program works) and, for emulators, the **ROM path** — the bot verifies both and can even **launch the game** for you.',
    '3. In **🎮 Game / Emulator**, paste the game/emulator executable. For **Minecraft Java**, choose the Minecraft preset and paste the launcher path (example: `C:\\Users\\Admin\\AppData\\Roaming\\ATLauncher\\ATLauncher.exe`). ATLauncher is opened/reused and ChatPlays drives **Instances → Play** automatically.'
)
replace_once(
    'README.md',
    '- **On boot** — game not running? The bot opens it: `spawn(exe, [ROM, ...args])`. Already running? It just **attaches** (no second instance) and watches it.',
    '- **On boot** — normal games use `spawn(exe, [ROM, ...args])`. With the Minecraft preset + ATLauncher, the configured `.exe` is treated as a **launcher**: ChatPlays opens/reuses ATLauncher and triggers **Instances → Play**, while the watchdog tracks the real Java/Minecraft process instead of the launcher.'
)
replace_once(
    'README.md',
    '- **Watchdog** — the game closes mid-stream → the bot waits `JOGO_REINICIAR_DELAY_MS` (3 s) and **reopens it with the same ROM**. The OBS overlay shows 🎮 running / 🔄 reopening live.',
    '- **Watchdog** — the game closes mid-stream → the bot waits `JOGO_REINICIAR_DELAY_MS` (3 s) and reopens it. Minecraft gets a startup grace period while Java loads; the launcher staying open does **not** count as the game running.'
)
replace_once(
    'README.md',
    'It works with anything you can launch: `EMULADOR_EXE=C:\\Emuladores\\visualboyadvance-m.exe` + `JOGO_ROM=C:\\Games\\Pokemon - Emerald.gba`, a launcher `.bat`, a `.jar`… For extra flags (RetroArch cores etc.) use `JOGO_ARGS`.',
    'It works with anything you can launch: `EMULADOR_EXE=C:\\Emuladores\\visualboyadvance-m.exe` + `JOGO_ROM=C:\\Games\\Pokemon - Emerald.gba`. Minecraft Java is special: use `EMULADOR_PRESET=minecraft` + an ATLauncher path. See [Minecraft + ATLauncher](docs/MINECRAFT-ATLAUNCHER.md). For extra flags (RetroArch cores etc.) use `JOGO_ARGS`.'
)

write('docs/MINECRAFT-ATLAUNCHER.md', r'''# Minecraft + ATLauncher

ChatPlays treats Minecraft Java differently from a normal game executable: the configured path can be the **launcher**, while the watchdog follows the **real Java/Minecraft process**.

## Setup

1. In the wizard, apply the **Minecraft** controls template.
2. In **Game / Emulator**, use the ATLauncher executable, for example:

   `C:\Users\Admin\AppData\Roaming\ATLauncher\ATLauncher.exe`

3. Save and start ChatPlays.

The Minecraft template switches keyboard and mouse to **Global**. This is intentional: after the launcher starts Minecraft, inputs must reach the actual game window rather than ATLauncher.

## Automatic launch flow

When Minecraft is not already running, ChatPlays:

1. opens or reuses ATLauncher;
2. tries Windows UI Automation to find **Instances**;
3. opens **Instances**;
4. finds and invokes **Play**;
5. waits for the real Minecraft Java process (`javaw.exe` / `java.exe`);
6. watches that process for crashes and can repeat the launcher flow when necessary.

If Windows UI Automation cannot expose the ATLauncher controls, ChatPlays takes a **temporary screenshot of the launcher window**, uses the relative layout calibrated from the reference screenshots below to click **Instances** and **Play**, and deletes the temporary PNG immediately afterward. The temporary screenshot is never kept in the project or user data.

## Reference screenshots

These are the references supplied for the ATLauncher layout. They are documentation and calibration references; screenshots captured at runtime are temporary.

![ATLauncher News](minecraft-atlauncher/01-news.png)

![Instances selected](minecraft-atlauncher/02-instances-selected.png)

![Instances normal](minecraft-atlauncher/03-instances-normal.png)

![Instances page](minecraft-atlauncher/04-instances-page.png)

![Play button](minecraft-atlauncher/05-play.png)

## Notes

- ATLauncher automation is currently Windows-only.
- If Minecraft is already running, ChatPlays does not click Play again; it attaches to the existing Minecraft process.
- The fallback clicks use window-relative coordinates, so they continue to work when the launcher window moves on screen.
- The watchdog never treats ATLauncher itself as proof that Minecraft is running.
''')

# ---------------------------------------------------------------------------
# Tests.
# ---------------------------------------------------------------------------
replace_once(
    'src/tests/minecraft-preset.test.js',
    "test('assistente Minecraft configura o mouse global e persiste o preset correto', () => {\n  assert.match(PAGINA, /if \\(sel === \"minecraft\"\\)/);\n  assert.match(PAGINA, /f-modo-mouse/);\n  assert.match(PAGINA, /value = \"global\"/);",
    "test('assistente Minecraft configura teclado e mouse globais e persiste o preset correto', () => {\n  assert.match(PAGINA, /if \\(sel === \"minecraft\"\\)/);\n  assert.match(PAGINA, /f-modo-teclado/);\n  assert.match(PAGINA, /f-modo-mouse/);\n  assert.match(PAGINA, /f-modo-teclado\\\"\\)\\.value = \\"global\\\"/);\n  assert.match(PAGINA, /f-modo-mouse\\\"\\)\\.value = \\"global\\\"/);"
)

write('src/tests/minecraft-launcher.test.js', r'''const assert = require('assert');
const test = require('node:test');
const launcher = require('../utils/minecraft-launcher');
const jogo = require('../utils/jogo');
const mouse = require('../controllers/mouse');

test('ATLauncher: reconhece caminho real e rejeita exe comum', () => {
  assert.strictEqual(launcher.ehAtLauncher('C:\\Users\\Admin\\AppData\\Roaming\\ATLauncher\\ATLauncher.exe'), true);
  assert.strictEqual(launcher.ehAtLauncher('C:\\Apps\\ATLauncher-3.4.39.0.exe'), true);
  assert.strictEqual(launcher.ehAtLauncher('C:\\Games\\MinecraftLauncher.exe'), false);
});

test('ATLauncher: fallback usa os pontos relativos calibrados pelas referências', () => {
  assert.deepStrictEqual(launcher.coordenadaFallback('instances', 1188, 696), { x: 1107, y: 239 });
  assert.deepStrictEqual(launcher.coordenadaFallback('play', 1187, 696), { x: 427, y: 399 });
});

test('ATLauncher: script prefere UI Automation e apaga screenshot temporária', () => {
  const s = launcher.montarScriptAtLauncher('C:\\ATLauncher\\ATLauncher.exe', 'C:\\Temp\\chatplays-shot.png');
  assert.match(s, /UIAutomationClient/);
  assert.match(s, /Find-ByName \$root 'Instances'/);
  assert.match(s, /Find-ByName \$root 'Play'/);
  assert.match(s, /CopyFromScreen/);
  assert.match(s, /0\.932 0\.343/);
  assert.match(s, /0\.360 0\.573/);
  assert.match(s, /finally \{[\s\S]*Remove-Item -LiteralPath \$shot -Force/);
});

test('gerenciador: launcher customizado não confunde launcher com Minecraft', async () => {
  jogo.__resetTeste();
  let lancamentos = 0;
  try {
    jogo.configurar({
      exe: 'C:\\ATLauncher\\ATLauncher.exe',
      detector: async () => false,
      lancador: async () => { lancamentos++; return true; },
      startupGraceMs: 30000,
      nomeGerenciado: 'Minecraft',
      autoReiniciar: false,
    });
    const r = await jogo.iniciar();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.modo, 'launcher');
    assert.strictEqual(lancamentos, 1);
    const st = jogo.status();
    assert.strictEqual(st.nome, 'Minecraft');
    assert.strictEqual(st.rodando, false, 'acionar launcher não significa Minecraft rodando');
    assert.strictEqual(st.aguardandoSubida, true);
  } finally {
    jogo.__resetTeste();
  }
});

test('gerenciador: Minecraft já rodando anexa sem clicar Play de novo', async () => {
  jogo.__resetTeste();
  let lancamentos = 0;
  try {
    jogo.configurar({
      exe: 'C:\\ATLauncher\\ATLauncher.exe',
      detector: async () => true,
      lancador: async () => { lancamentos++; return true; },
      nomeGerenciado: 'Minecraft',
    });
    const r = await jogo.iniciar();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.modo, 'anexar');
    assert.strictEqual(lancamentos, 0);
    assert.strictEqual(jogo.status().rodando, true);
  } finally {
    jogo.__resetTeste();
  }
});

test('mouse global: funciona sem EMULADOR_EXE e usa janela em foco', () => {
  const antes = mouse.status();
  const linhas = [];
  try {
    mouse.configurar({ modo: 'global', alvoExe: null, passoPx: 40 });
    mouse.__test.simular({ plataforma: 'win32', linhas });
    assert.strictEqual(mouse.mover(1, 0), true);
    assert.deepStrictEqual(linhas, ['MG 40 0']);
    const fonte = mouse.__test.fonteWorker();
    assert.match(fonte, /GetForegroundWindow/);
    assert.match(fonte, /GetArea\(out hwnd, out rect, out origin, true\)/);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: antes.modo, alvoExe: antes.alvoExe, passoPx: antes.passoPx });
  }
});
''')
