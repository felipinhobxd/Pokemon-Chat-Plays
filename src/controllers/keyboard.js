/**
 * Controlador de teclado SEM dependências nativas — versão 2.2.1.
 *
 * Backends por plataforma:
 *  - Windows: PowerShell + keybd_event (user32.dll) via -EncodedCommand
 *             com WORKER RESIDENTE (processo único, teclas em ~1ms)
 *  - Linux:   xdotool (keydown / keyup / sleep)
 *  - macOS:   osascript + System Events (key code / key down / key up)
 *
 * Correções da v2.2.1 (teclas não chegavam no jogo!):
 *  - O tempo do toque agora fica ENTRE o keydown e o keyup. Na v2.2.0 o
 *    Start-Sleep era inserido no lugar errado (antes do keydown), então o
 *    toque durava 0ms e emuladores que leem o teclado por quadro (VBA-M/SDL)
 *    simplesmente não viam a tecla.
 *  - O keybd_event agora envia o SCAN CODE da tecla (via MapVirtualKey).
 *    Vários jogos/emuladores ignoram teclas sintéticas sem scan code.
 *  - PowerShell RODANDO EM SEGUNDO PLANO: o P/Invoke é compilado UMA vez
 *    e cada tecla é enviada por stdin (era ~1,5s por tecla abrindo um
 *    PowerShell novo a cada comando; agora é ~1ms).
 *  - Erros do PowerShell agora APARECEM no terminal (antes eram engolidos).
 *
 * Correção da v2.2.3 (setas apertavam o TECLADO NUMÉRICO!):
 *  - Setas e teclas de navegação são "teclas estendidas" no Windows (scan
 *    code com prefixo E0). Sem a flag KEYEVENTF_EXTENDEDKEY (0x01), o
 *    keybd_event injeta a tecla "gêmea" do teclado numérico (VK_UP vira o
 *    8 do numpad, VK_LEFT vira o 4...) e o emulador não move o personagem.
 *    Agora TODAS as chamadas usam flagsKeybd(), que soma 0x01 às teclas
 *    estendidas no keydown E no keyup (o keyup sem a flag certa nem solta
 *    a tecla de verdade, deixando ela presa no jogo).
 *
 * Novidade da v2.4 (MODO JANELA — o chat controla SÓ o jogo):
 *  - Problema: o keybd_event injeta teclas GLOBALMENTE — elas vão para a
 *    janela em FOCO. Se o streamer está mexendo no OBS e o chat manda "up",
 *    a tecla cai no OBS (muda de cena, abre menu...).
 *  - Solução: classe PCP em C# que descobre a JANELA do emulador (pelo
 *    caminho do .exe pedido no boot) e envia WM_KEYDOWN/WM_KEYUP direto
 *    nela com PostMessage — input em SEGUNDO PLANO: funciona com o
 *    emulador minimizado ou sem foco, e NÃO toca no OBS nem em nada mais.
 *  - O caminho do .exe é perguntado no início (src/utils/emulador.js),
 *    fica salvo em dados/emulador.json e pode vir do EMULADOR_EXE do .env.
 *  - MODO_TECLADO=global no .env devolve o comportamento antigo.
 *
 * Mapeamento padrão (compatível com VisualBoyAdvance-M):
 *   ⬆ up -> seta cima     ⬇ down -> seta baixo
 *   ⬅ left -> seta esq    ➡ right -> seta dir
 *   🅰 A -> X   🅱 B -> Z   🔵 L -> A   🔴 R -> S
 *   ▶ Start -> Enter   ▦ Select -> Backspace
 *
 * Novidade da v2.5 (SAVES NO CHAT + COMBOS):
 *  - Teclas de função F1-F12 nos três backends — savestates dos emuladores
 *    (VBA-M/mGBA/DeSmuME usam F1-F10; F5 carrega o slot 5, Shift+F5 salva).
 *  - Mapeamentos podem ser COMBOS: TECLA_SALVAR=shift+f5 pressiona
 *    shift+F5 numa única ação (mods down -> tecla down -> sleep -> tecla up
 *    -> mods up). Tudo em UMA linha do worker: a ordem nunca se inverte.
 */

const { spawn, execFileSync } = require('child_process');
const logger = require('../utils/logger');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// Mapeamento botão -> tecla genérica (edite aqui se o seu emulador usar outras)
// ---------------------------------------------------------------------------
const MAPEAMENTO_PADRAO = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  a: 'x',
  b: 'z',
  l: 'a',
  r: 's',
  start: 'enter',
  select: 'backspace',
  // v2.5: savestates (layout padrão do VBA-M: F5 carrega, Shift+F5 salva)
  salvar: 'shift+f5',
  carregar: 'f5',
};

let mapeamentoAtual = { ...MAPEAMENTO_PADRAO };
const duracaoPadraoMs = () => config.geral.tempoPressionarTeclaMs;

// ---------------------------------------------------------------------------
// Modo JANELA (v2.4): teclas do chat vão SOMENTE para a janela do emulador
// ---------------------------------------------------------------------------

/** Modos de envio de teclas. */
const MODO_GLOBAL = 'global';
const MODO_JANELA = 'janela';

/** Caminho do .exe do emulador que vai receber as techas (null = global). */
let alvoExe = null;
/** Modo atual de envio. */
let modoTeclado = MODO_GLOBAL;

/** Throttle dos avisos vindos do worker (WARN EMULADOR_OFF). */
let ultimoWarnWorker = 0;
/** Throttle das informações de janela detectada (JANELA ...). */
let ultimoInfoWorker = 0;

/**
 * Define o emulador alvo. Com caminho: modo JANELA (PostMessage na janela
 * do emulador). Sem caminho: modo GLOBAL (keybd_event, como sempre foi).
 * Reinicia o worker para que o alvo seja compilado no boot.
 * @param {string|null} exe
 */
function configurarAlvoJanela(exe) {
  const novo = exe ? normalizarCaminhoAlvo(exe) : null;
  alvoExe = novo;
  modoTeclado = novo ? MODO_JANELA : MODO_GLOBAL;
  if (worker.proc) {
    // o alvo é compilado no boot do worker: mata o atual — a próxima
    // tecla re-sobe o worker já com o novo alvo
    try { worker.proc.kill(); } catch { /* já morreu */ }
  }
  if (novo) {
    logger.info(`[Teclado] 🎯 Modo JANELA: teclas do chat vão DIRETO para o emulador (${novo}) — o resto do PC não é afetado.`);
    if (process.platform !== 'win32') {
      logger.aviso('[Teclado] ⚠️ Modo janela só funciona no Windows — neste sistema as teclas vão para a janela em foco.');
    }
  } else {
    logger.info('[Teclado] Modo GLOBAL: teclas do chat vão para a janela EM FOCO (comportamento antigo).');
  }
}

/**
 * Normaliza o caminho do alvo (remove aspas coladas, espaços, barras duplas).
 * @param {string} exe
 * @returns {string}
 */
function normalizarCaminhoAlvo(exe) {
  let t = String(exe || '').trim();
  const aspas = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  if (aspas && t.length >= 2) t = t.slice(1, -1).trim();
  // barras duplicadas de caminhos UNC mal colados
  t = t.replace(/\\\\+/g, '\\');
  return t;
}

/** @returns {boolean} true se o modo janela está ativo. */
function modoJanela() {
  return modoTeclado === MODO_JANELA && Boolean(alvoExe);
}

// ---------------------------------------------------------------------------
// Tradução de teclas para cada backend
// ---------------------------------------------------------------------------

/** Virtual-key codes do Windows (user32 keybd_event). */
const VK_WINDOWS = {
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  enter: 0x0d,
  return: 0x0d,
  backspace: 0x08,
  space: 0x20,
  tab: 0x09,
  esc: 0x1b,
  escape: 0x1b,
  shift: 0x10,
  ctrl: 0x11,
  alt: 0x12,
  // v2.5: teclas de função — savestates dos emuladores
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
};

/**
 * Converte uma tecla genérica no VK code do Windows.
 * @param {string} tecla
 * @returns {number|null}
 */
function vkWindows(tecla) {
  const t = tecla.toLowerCase();
  if (VK_WINDOWS[t] !== undefined) return VK_WINDOWS[t];
  if (/^[a-z0-9]$/.test(t)) return t.toUpperCase().charCodeAt(0);
  return null;
}

/**
 * VK codes de TECLAS ESTENDIDAS do Windows (físicas mandam scan code com
 * prefixo E0): setas, Page Up/Down, Home, End, Insert, Delete, divisão do
 * numpad, Num Lock, Windows direita e menu de contexto.
 *
 * ⚠️ Sem a flag KEYEVENTF_EXTENDEDKEY, o keybd_event injeta a versão
 * NÃO-estendida da tecla — que é o TECLADO NUMÉRICO (VK_UP e o "8" do
 * numpad com Num Lock desligado são a MESMA tecla virtual). Foi exatamente
 * o bug da v2.2.2: o chat mandava "cima" e o VBA-M recebia o 8 do numpad.
 */
const VK_ESTENDIDOS = new Set([
  0x21, // Page Up
  0x22, // Page Down
  0x23, // End
  0x24, // Home
  0x25, // Left  (seta esquerda)
  0x26, // Up    (seta cima)
  0x27, // Right (seta direita)
  0x28, // Down  (seta baixo)
  0x2d, // Insert
  0x2e, // Delete
  0x5c, // Windows direita
  0x5d, // Menu de contexto
  0x6f, // Divisão do teclado numérico
  0x90, // Num Lock
]);

/** KEYEVENTF_EXTENDEDKEY = 0x01 — transforma a tecla na versão estendida. */
const FLAG_ESTENDIDA = 0x01;
/** KEYEVENTF_KEYUP = 0x02 — solta a tecla. */
const FLAG_KEYUP = 0x02;

/**
 * Flags do keybd_event para pressionar/soltar um VK code.
 * Teclas estendidas (setas!) ganham KEYEVENTF_EXTENDEDKEY no down E no up —
 * sem isso o Windows entrega a tecla "gêmea" do teclado numérico.
 * @param {number} vk - VK code do Windows
 * @param {boolean} down - true = keydown, false = keyup
 * @returns {number} dwFlags pronto para o keybd_event
 */
function flagsKeybd(vk, down) {
  const estendida = VK_ESTENDIDOS.has(vk) ? FLAG_ESTENDIDA : 0;
  return (down ? 0 : FLAG_KEYUP) | estendida;
}

/** Key codes do macOS (System Events). */
const KEYCODES_MAC = {
  a: 0, b: 11, c: 12, d: 2, e: 14, f: 3, g: 15, h: 4, i: 34, j: 38,
  k: 40, l: 37, m: 46, n: 45, o: 31, p: 35, q: 12, r: 15, s: 1, t: 17,
  u: 32, v: 9, w: 13, x: 7, y: 16, z: 6,
  '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26,
  '8': 28, '9': 25,
  up: 126, down: 125, left: 123, right: 124,
  enter: 36, return: 36, backspace: 51, space: 49, tab: 48, esc: 53, escape: 53,
  shift: 56, ctrl: 59, alt: 58,
  // v2.5: teclas de função do macOS
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
};

/**
 * Converte uma tecla genérica no keycode do macOS.
 * @param {string} tecla
 * @returns {number|null}
 */
function keycodeMac(tecla) {
  return KEYCODES_MAC[tecla.toLowerCase()] ?? null;
}

/** Nomes de tecla para o xdotool (Linux). */
const TECLAS_XDOTOOL = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  enter: 'Return',
  return: 'Return',
  backspace: 'BackSpace',
  space: 'space',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  shift: 'Shift_L',
  ctrl: 'Control_L',
  alt: 'Alt_L',
  // v2.5: teclas de função
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
  f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',
};

/**
 * Converte uma tecla genérica no nome aceito pelo xdotool.
 * @param {string} tecla
 * @returns {string|null}
 */
function nomeXdotool(tecla) {
  const t = tecla.toLowerCase();
  return TECLAS_XDOTOOL[t] ?? (/^[a-z0-9]$/.test(t) ? t : null);
}

/**
 * v2.5: Modificadores aceitos em combos (TECLA_SALVAR=shift+f5 etc.).
 */
const MODIFICADORES = ['shift', 'ctrl', 'alt'];

/**
 * v2.5: Resolve uma especificação de tecla (simples OU combo "shift+f5")
 * validando cada parte nos TRÊS backends.
 * @param {string} espec - 'f5' | 'shift+f5' | 'ctrl+alt+f2'...
 * @returns {{modificadores: string[], tecla: string}|null}
 */
function resolverTecla(espec) {
  const partes = String(espec || '')
    .toLowerCase()
    .split('+')
    .map((p) => p.trim());
  // "+f5", "shift+", "a++b" — parte vazia = especificação malformada
  if (partes.some((p) => p === '')) return null;

  const tecla = partes[partes.length - 1];
  const modificadores = partes.slice(0, -1);

  // a tecla principal nunca pode ser um modificador — EXCETO se ela for
  // a ÚNICA parte: "shift" sozinho é uma tecla legítima (Select do
  // DeSmuME/RetroArch); "shift+shift" é que não faz sentido
  if (partes.length > 1 && MODIFICADORES.includes(tecla)) return null;
  // os modificadores têm que ser exatamente os conhecidos
  if (modificadores.some((m) => !MODIFICADORES.includes(m))) return null;

  // cada parte precisa existir nos três backends
  for (const p of partes) {
    if (vkWindows(p) === null || keycodeMac(p) === null || nomeXdotool(p) === null) {
      return null;
    }
  }
  return { modificadores, tecla };
}

// ---------------------------------------------------------------------------
// Fila sequencial de ações de teclado (execução assíncrona, nunca bloqueia)
// ---------------------------------------------------------------------------

const filaAcoes = [];
let processandoAcao = false;
const FILA_MAX = 25;

/**
 * Enfileira uma ação de teclado. Ações são executadas UMA POR VEZ, em ordem,
 * para garantir que keydown/keyup não se invertam entre comandos.
 * @param {(concluir: () => void) => void} acao - Função que roda o processo
 * @param {boolean} [descartavel=false] - true para ações AUTOCONTIDAS (toque
 *   completo down+up): se a fila encher, estas podem ser descartadas. Um
 *   keydown/keyup AVULSO jamais é descartado — perder o keyup de um hold
 *   deixaria a tecla PRESA no jogo até o "soltar" (v2.9.2).
 */
function enfileirar(acao, descartavel = false) {
  acao.descartavel = Boolean(descartavel);
  if (filaAcoes.length >= FILA_MAX) {
    // fila cheia: descarta o TOQUE completo mais antigo (autossuficiente —
    // down e up num só processo, nada fica pendurado). Sem toque na fila,
    // ela cresce além do teto mesmo: o limite físico é o número de teclas
    // (cada hold gera no máximo um keydown + um keyup pendentes).
    const idx = filaAcoes.findIndex((a) => a.descartavel);
    if (idx >= 0) {
      filaAcoes.splice(idx, 1);
      logger.aviso('[Teclado] Fila cheia — toque antigo descartado para não atrasar o jogo.');
    }
  }
  filaAcoes.push(acao);
  processarFila();
}

function processarFila() {
  if (processandoAcao || filaAcoes.length === 0) return;
  processandoAcao = true;
  const acao = filaAcoes.shift();
  try {
    acao(() => {
      processandoAcao = false;
      setImmediate(processarFila);
    });
  } catch (err) {
    processandoAcao = false;
    logger.erro(`[Teclado] Erro ao executar ação: ${err.message}`);
    setImmediate(processarFila);
  }
}

/**
 * Roda um processo filho com timeout e callback de conclusão.
 * @param {string} comando - Executável
 * @param {string[]} args - Argumentos
 * @param {number} timeoutMs - Tempo máximo de vida do processo
 * @param {() => void} aoTerminar - Chamado no exit OU no erro (sempre)
 */
function rodarProcesso(comando, args, timeoutMs, aoTerminar) {
  let terminado = false;
  const finalizar = (codigo) => {
    if (terminado) return;
    terminado = true;
    clearTimeout(mataProcesso);
    aoTerminar(codigo);
  };

  let filho;
  try {
    filho = spawn(comando, args, { stdio: 'ignore', windowsHide: true });
  } catch (err) {
    logger.erro(`[Teclado] Falha ao iniciar "${comando}": ${err.message}`);
    finalizar(-1);
    return;
  }

  const mataProcesso = setTimeout(() => {
    if (!terminado) {
      logger.aviso(`[Teclado] Processo "${comando}" excedeu ${timeoutMs}ms — finalizando.`);
      try { filho.kill(); } catch { /* já morreu */ }
    }
  }, timeoutMs);

  filho.on('exit', (codigo) => finalizar(codigo));
  filho.on('error', (err) => {
    logger.erro(`[Teclado] Processo "${comando}" falhou: ${err.message}`);
    finalizar(-1);
  });
}

// ---------------------------------------------------------------------------
// Windows: PowerShell + keybd_event com WORKER RESIDENTE
// ---------------------------------------------------------------------------

/** Cabeçalho C# com os P/Invokes do keybd_event e MapVirtualKey. */
const PS_KEYBD = [
  "$sig = 'using System;",
  'using System.Runtime.InteropServices;',
  'public class KB {',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
  '  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);',
  "}';",
  'Add-Type -TypeDefinition $sig;',
].join('\n');

/**
 * Fonte C# da classe PCP — teclas direto na JANELA do emulador (v2.4).
 *
 * Por que PostMessage em vez de keybd_event: o keybd_event injeta a tecla
 * no TECLADO DO SISTEMA (vai para a janela em foco — OBS, navegador...).
 * O PostMessage entrega WM_KEYDOWN/WM_KEYUP direto na fila de mensagens da
 * janela do emulador: o jogo recebe MESMO SEM FOCO, e mais nada no PC é
 * afetado. Funciona com VBA-M, mGBA e DeSmuME (todos leem teclado por
 * mensagem). Se _alvo for null, cai no keybd_event antigo (modo global).
 *
 * ⚠️ Não pode conter aspas simples (é embutida numa string PS delimitada
 * por '') — os testes garantem isso.
 */
const CS_PCP = [
  'using System;',
  'using System.IO;',
  'using System.Text;',
  'using System.Collections.Generic;',
  'using System.Diagnostics;',
  'using System.Runtime.InteropServices;',
  'public class PCP {',
  '  [DllImport("user32.dll")]',
  '  static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
  '  [DllImport("user32.dll")]',
  '  static extern uint MapVirtualKey(uint uCode, uint uMapType);',
  '  [DllImport("user32.dll", SetLastError = true)]',
  '  static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);',
  '  [DllImport("user32.dll")]',
  '  static extern bool IsWindow(IntPtr hWnd);',
  '  [DllImport("user32.dll")]',
  '  static extern bool IsWindowVisible(IntPtr hWnd);',
  '  [DllImport("user32.dll")]',
  '  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)]',
  '  static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
  '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
  '  [DllImport("user32.dll")]',
  '  static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
  '  const uint WM_KEYDOWN = 0x0100;',
  '  const uint WM_KEYUP = 0x0101;',
  '  static string _alvo = null;',
  '  static string _alvoNome = null;',
  '  static IntPtr _hwnd = IntPtr.Zero;',
  '  static int _ultimaBusca = -100000;',
  '  static bool _avisada = false;',
  '  static HashSet<int> _pids = new HashSet<int>();',
  '  public static void DefinirAlvo(string caminho) {',
  '    if (String.IsNullOrEmpty(caminho)) { _alvo = null; _alvoNome = null; }',
  '    else {',
  '      try { _alvo = Path.GetFullPath(caminho); } catch { _alvo = caminho; }',
  '      try { _alvoNome = Path.GetFileNameWithoutExtension(_alvo); } catch { _alvoNome = null; }',
  '    }',
  '    _hwnd = IntPtr.Zero;',
  '    _avisada = false;',
  '    _pids.Clear();',
  '  }',
  '  public static string Alvo() { return _alvo; }',
  '  public static IntPtr Janela() { return _hwnd; }',
  '  public static bool EhEstendido(int vk) {',
  '    return vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24',
  '        || (vk >= 0x25 && vk <= 0x28)',
  '        || vk == 0x2D || vk == 0x2E || vk == 0x5C || vk == 0x5D',
  '        || vk == 0x6F || vk == 0x90;',
  '  }',
  '  public static uint MontarLParam(uint scan, bool estendida, bool down) {',
  '    uint lp = 1u | (scan << 16);',
  '    if (estendida) lp |= 0x01000000u;',
  '    if (!down) lp |= 0xC0000000u;',
  '    return lp;',
  '  }',
  '  static void Buscar() {',
  '    _hwnd = IntPtr.Zero;',
  '    int agora = Environment.TickCount;',
  '    if (agora - _ultimaBusca < 2000) return;',
  '    _ultimaBusca = agora;',
  '    _pids.Clear();',
  '    IntPtr achada = IntPtr.Zero;',
  '    try {',
  '      if (_alvoNome != null) {',
  '        // v2.4.1: busca pelo NOME do processo (GetProcessesByName devolve',
  '        // só os candidatos) em vez de varrer TODOS os processos com',
  '        // MainModule.FileName — que é lento e lança exceção em processo',
  '        // protegido. O caminho completo ainda é conferido quando dá para',
  '        // ler; sem permissão, aceita pelo nome.',
  '        Process[] cands = Process.GetProcessesByName(_alvoNome);',
  '        foreach (Process p in cands) {',
  '          try {',
  '            try {',
  '              string exe = p.MainModule.FileName;',
  '              if (!String.Equals(exe, _alvo, StringComparison.OrdinalIgnoreCase)) continue;',
  '            } catch { }',
  '            _pids.Add(p.Id);',
  '            if (achada == IntPtr.Zero && p.MainWindowHandle != IntPtr.Zero) {',
  '              achada = p.MainWindowHandle;',
  '            }',
  '          } catch { }',
  '          finally { try { p.Dispose(); } catch { } }',
  '        }',
  '      }',
  '    } catch { }',
  '    if (achada == IntPtr.Zero && _pids.Count > 0) {',
  '      IntPtr porEnum = IntPtr.Zero;',
  '      EnumWindows(delegate(IntPtr h, IntPtr l) {',
  '        uint pid;',
  '        GetWindowThreadProcessId(h, out pid);',
  '        if (porEnum == IntPtr.Zero && _pids.Contains((int)pid) && IsWindowVisible(h)) {',
  '          StringBuilder sb = new StringBuilder(64);',
  '          if (GetWindowText(h, sb, 64) > 0) { porEnum = h; return false; }',
  '        }',
  '        return true;',
  '      }, IntPtr.Zero);',
  '      achada = porEnum;',
  '    }',
  '    if (achada != IntPtr.Zero) {',
  '      _hwnd = achada;',
  '      if (!_avisada) {',
  '        _avisada = true;',
  '        StringBuilder t = new StringBuilder(256);',
  '        GetWindowText(_hwnd, t, 256);',
  '        Console.Out.WriteLine("JANELA " + t.ToString());',
  '      }',
  '    }',
  '  }',
  '  public static void Env(int vk, int down) {',
  '    if (_alvo == null) {',
  '      uint scanG = MapVirtualKey((uint)vk, 0);',
  '      uint flagsG = (down == 0 ? 2u : 0u) | (EhEstendido(vk) ? 1u : 0u);',
  '      keybd_event((byte)vk, (byte)scanG, flagsG, UIntPtr.Zero);',
  '      return;',
  '    }',
  '    if (_hwnd != IntPtr.Zero && !IsWindow(_hwnd)) { _hwnd = IntPtr.Zero; _avisada = false; }',
  '    if (_hwnd == IntPtr.Zero) Buscar();',
  '    if (_hwnd == IntPtr.Zero) { Console.Out.WriteLine("WARN EMULADOR_OFF"); return; }',
  '    uint scan = MapVirtualKey((uint)vk, 0);',
  '    uint lp = MontarLParam(scan, EhEstendido(vk), down != 0);',
  '    PostMessage(_hwnd, down != 0 ? WM_KEYDOWN : WM_KEYUP, (IntPtr)vk, unchecked((IntPtr)(int)lp));',
  '  }',
  '}',
];

/** PS_PCP: compila a classe PCP (string PS de aspas simples multilinha). */
const PS_PCP = [
  "$sig = '",
  ...CS_PCP,
  "';",
  'Add-Type -TypeDefinition $sig;',
].join('\n');

/** Loop stdin/stdout do worker residente (protocolo READY/OK/ERR). */
const PS_LOOP = [
  "[Console]::Out.WriteLine('READY');",
  'while($true){',
  '  $l = [Console]::In.ReadLine();',
  "  if($null -eq $l -or $l -eq 'QUIT'){ break }",
  "  try { Invoke-Expression $l; [Console]::Out.WriteLine('OK') }",
  "  catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }",
  '}',
].join('\n');

/**
 * Monta o script de boot do worker residente conforme o modo atual:
 *  - janela: compila a PCP (PostMessage) + fixa o alvo + loop
 *  - global: compila a KB (keybd_event) + loop — IGUAL às versões antigas
 * @returns {string}
 */
function montarBootPS() {
  if (modoJanela()) {
    const alvoEscapado = alvoExe.replace(/'/g, "''");
    return [PS_PCP, `[PCP]::DefinirAlvo('${alvoEscapado}');`, PS_LOOP].join('\n');
  }
  return [PS_KEYBD, PS_LOOP].join('\n');
}

/**
 * Monta o script PowerShell (modo compatível / encerramento) que
 * pressiona/solta teclas do Windows.
 * IMPORTANTE: esperaMs é o tempo ENTRE o keydown e o keyup — é isso que faz
 * o "toque" existir de verdade para o jogo (na v2.2.0 era inserido antes
 * do keydown e o toque durava 0ms).
 * @param {Array<{vk: number, down: boolean}>} eventos
 * @param {number} [esperaMs] - Pausa entre o down e o up (tap)
 * @returns {string} Script PowerShell pronto
 */
function scriptWindows(eventos, esperaMs = 0) {
  const partes = [PS_KEYBD];
  for (const ev of eventos) {
    const flags = flagsKeybd(ev.vk, ev.down); // setas: 1 (down) / 3 (up)
    partes.push(`[KB]::keybd_event(${ev.vk},[KB]::MapVirtualKey(${ev.vk},0),${flags},[UIntPtr]::Zero);`);
    // o sleep vem DEPOIS do keydown (e antes do keyup que segue no tap)
    if (ev.down && esperaMs > 0) {
      partes.push(`Start-Sleep -Milliseconds ${Math.round(esperaMs)};`);
    }
  }
  return partes.join('\n');
}

/**
 * Executa um script PowerShell avulso via -EncodedCommand (Base64 UTF-16LE).
 * Usado apenas no modo compatível (worker indisponível) e no encerramento.
 * @param {string} script - Script PowerShell
 * @param {number} timeoutMs
 * @param {() => void} aoTerminar
 */
function rodarPowerShell(script, timeoutMs, aoTerminar) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  rodarProcesso(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    timeoutMs,
    aoTerminar
  );
}

// ---------------------------------------------------------------------------
// Worker PowerShell residente (Windows): rápido e com erros visíveis
// ---------------------------------------------------------------------------

/** Estado do worker PowerShell residente. */
const worker = {
  proc: null,       // processo filho do PowerShell
  pronto: false,    // recebeu READY?
  booting: false,   // está subindo agora
  chegouReady: false, // este processo chegou a ficar pronto alguma vez?
  buffer: '',       // buffer do stdout
  // v2.4.1: ações EM VOO como FILA (era um slot único — se 2+ ações
  // chegassem juntas durante o boot, a 1ª perdia o concluir() e a fila
  // da teclado TRAVAVA para sempre; com FIFO o OK de cada linha conclui
  // a ação mais antiga, que é exatamente a ordem em que o worker responde)
  acoes: [],        // [{ concluir, timeoutId, desc }] em execução no worker
  pendentes: [],    // ações aguardando o worker subir
  timerReady: null,
  falhasBoot: 0,
  legacy: false,    // true = worker não sobe; usar spawn por tecla
};

/** Linha PowerShell que pressiona (down=true) ou solta (down=false) um VK. */
function linhaKey(vk, down) {
  const flags = flagsKeybd(vk, down); // setas ganham KEYEVENTF_EXTENDEDKEY
  return `[KB]::keybd_event(${vk},[KB]::MapVirtualKey(${vk},0),${flags},[UIntPtr]::Zero)`;
}

/** Linha PowerShell que dá um toque completo: down + sleep + up. */
function linhaTap(vk, ms) {
  return `${linhaKey(vk, true)};[System.Threading.Thread]::Sleep(${Math.round(ms)});${linhaKey(vk, false)}`;
}

// ---------------------------------------------------------------------------
// v2.4: linhas do MODO JANELA (teclas via [PCP]::Env -> PostMessage)
// ---------------------------------------------------------------------------

/**
 * Linha PowerShell que pressiona/solta um VK NA JANELA DO EMULADOR.
 * A classe PCP (compilada no boot do worker) resolve a janela pelo .exe,
 * monta o lParam com scan code + flag estendida e faz o PostMessage.
 * @param {number} vk
 * @param {boolean} down
 * @returns {string}
 */
function linhaKeyJanela(vk, down) {
  return `[PCP]::Env(${vk},${down ? 1 : 0})`;
}

/** Toque completo NA JANELA DO EMULADOR: down + sleep + up. */
function linhaTapJanela(vk, ms) {
  return `${linhaKeyJanela(vk, true)};[System.Threading.Thread]::Sleep(${Math.round(ms)});${linhaKeyJanela(vk, false)}`;
}

/**
 * v2.5: sequência de eventos em UMA linha do worker (combos).
 * O sleep entra DEPOIS DO ÚLTIMO keydown (o da tecla principal) — mods já
 * pressionados, principal pressionada, espera, solta principal, solta mods.
 * Uma linha = um OK do worker = a ordem nunca se inverte.
 * @param {Array<{vk: number, down: boolean}>} eventos - em ordem de execução
 * @param {number} esperaMs - duração da tecla principal
 * @param {(vk: number, down: boolean) => string} emit - gerador de fragmento
 * @returns {string}
 */
function linhaSequencia(eventos, esperaMs, emit) {
  const totalDown = eventos.filter((e) => e.down).length;
  let vistosDown = 0;
  const partes = [];
  for (const ev of eventos) {
    partes.push(emit(ev.vk, ev.down));
    if (ev.down) {
      vistosDown++;
      if (vistosDown === totalDown && esperaMs > 0) {
        partes.push(`[System.Threading.Thread]::Sleep(${Math.round(esperaMs)})`);
      }
    }
  }
  return partes.join(';');
}

/** Sequência no MODO JANELA ([PCP]::Env — PostMessage no emulador). */
function linhaSequenciaJanela(eventos, esperaMs) {
  return linhaSequencia(eventos, esperaMs, linhaKeyJanela);
}

/** Sequência no modo GLOBAL ([KB]::keybd_event com flags certas). */
function linhaSequenciaGlobal(eventos, esperaMs) {
  return linhaSequencia(eventos, esperaMs, linhaKey);
}

/**
 * Script avulso do MODO JANELA (worker indisponível / encerramento):
 * compila a PCP, fixa o alvo e envia cada evento com PostMessage.
 * @param {Array<{vk: number, down: boolean}>} eventos
 * @param {number} [esperaMs]
 * @param {string} exe - caminho do emulador alvo
 * @returns {string}
 */
function scriptWindowsJanela(eventos, esperaMs = 0, exe = alvoExe) {
  const alvoEscapado = String(exe || '').replace(/'/g, "''");
  const partes = [PS_PCP, `[PCP]::DefinirAlvo('${alvoEscapado}');`];
  for (const ev of eventos) {
    partes.push(`${linhaKeyJanela(ev.vk, ev.down)};`);
    if (ev.down && esperaMs > 0) {
      partes.push(`Start-Sleep -Milliseconds ${Math.round(esperaMs)};`);
    }
  }
  return partes.join('\n');
}

/**
 * Conclui a ação MAIS ANTIGA em execução no worker (idempotente).
 * O worker processa as linhas em ordem, então o OK/ERR que chega
 * corresponde sempre à ação mais antiga ainda em voo.
 */
function finalizarAcaoWorker() {
  const a = worker.acoes.shift();
  if (!a) return;
  if (a.timeoutId) clearTimeout(a.timeoutId);
  a.concluir();
}

/** Conclui TODAS as ações em voo (worker morreu / travou). */
function finalizarTodasAcoesWorker() {
  while (worker.acoes.length > 0) {
    finalizarAcaoWorker();
  }
}

/** Envia as ações que esperavam o worker ficar pronto. */
function liberarPendentes() {
  const pend = worker.pendentes.splice(0);
  for (const p of pend) {
    enviarParaWorker(p.linha, p.timeoutMs, p.concluir, p.desc);
  }
}

/** Processa uma linha de resposta do worker (READY/OK/ERR/WARN/JANELA). */
function tratarLinhaWorker(linha) {
  if (linha === 'READY') {
    worker.pronto = true;
    worker.booting = false;
    worker.chegouReady = true;
    worker.falhasBoot = 0;
    if (worker.timerReady) { clearTimeout(worker.timerReady); worker.timerReady = null; }
    logger.info(modoJanela()
      ? '[Teclado] Worker PowerShell ativo (modo janela) — teclas direto no emulador, ~1ms.'
      : '[Teclado] Worker PowerShell ativo — teclas em ~1ms.');
    liberarPendentes();
    return;
  }
  if (linha === 'OK') {
    finalizarAcaoWorker();
    return;
  }
  if (linha.startsWith('WARN')) {
    // aviso do worker (emulador não encontrado etc.) — não conclui a ação;
    // o OK continua vindo em seguida. Log com throttle para não virar spam.
    const agora = Date.now();
    if (agora - ultimoWarnWorker > 10000) {
      ultimoWarnWorker = agora;
      if (linha.includes('EMULADOR_OFF')) {
        logger.aviso(`[Teclado] ⚠️ Emulador não encontrado (${alvoExe}) — as teclas do chat NÃO foram enviadas. Abra o emulador, ou reinicie o bot para redigitar o caminho.`);
      } else {
        logger.aviso(`[Teclado] ${linha.slice(4).trim()}`);
      }
    }
    return;
  }
  if (linha.startsWith('JANELA ')) {
    const agora = Date.now();
    if (agora - ultimoInfoWorker > 2000) {
      ultimoInfoWorker = agora;
      logger.info(`[Teclado] 🎯 Emulador detectado: "${linha.slice(7).trim()}" — teclas do chat indo para lá.`);
    }
    return;
  }
  if (linha.startsWith('ERR')) {
    logger.erro(`[Teclado] PowerShell rejeitou a tecla: ${linha.slice(3).trim()}`);
    finalizarAcaoWorker();
  }
}

/** Sobe o worker do PowerShell (se ainda não existir). */
function iniciarWorker() {
  if (worker.proc || worker.booting || worker.legacy) return;
  worker.booting = true;
  worker.chegouReady = false;
  worker.pronto = false;
  worker.buffer = '';

  let proc;
  try {
    // boot conforme o modo: janela (PCP + PostMessage) ou global (KB)
    const encoded = Buffer.from(montarBootPS(), 'utf16le').toString('base64');
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    worker.booting = false;
    worker.legacy = true;
    logger.erro(`[Teclado] PowerShell indisponível (${err.message}) — usando modo compatível.`);
    const pend = worker.pendentes.splice(0);
    for (const p of pend) p.concluir();
    return;
  }
  worker.proc = proc;

  proc.stdin.on('error', () => { /* EPIPE: o exit do worker cuida da limpeza */ });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    worker.buffer += chunk;
    let idx;
    while ((idx = worker.buffer.indexOf('\n')) >= 0) {
      const linha = worker.buffer.slice(0, idx).trim();
      worker.buffer = worker.buffer.slice(idx + 1);
      if (linha) tratarLinhaWorker(linha);
    }
  });

  // erros do PowerShell agora APARECEM no terminal (antes eram engolidos).
  // Quando o stderr é redirecionado, o PowerShell serializa erros em CLIXML
  // (XML) — extraímos o texto legível de dentro dele.
  let erroJaLogado = false;
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    if (erroJaLogado) return;
    erroJaLogado = true;
    const txt = String(chunk);
    let msg = '';
    const partes = txt.match(/<S S="Error">([\s\S]*?)<\/S>/g) || [];
    if (partes.length > 0) {
      msg = partes
        .map((p) => p.replace(/<[^>]+>/g, '').replace(/_x000A_/g, ' ').trim())
        .join(' ')
        .trim();
    } else {
      msg = txt.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('<'))[0] || '';
    }
    if (msg) logger.erro(`[Teclado] PowerShell (worker): ${msg.slice(0, 300)}`);
  });

  proc.on('exit', () => {
    if (worker.proc !== proc) return; // já substituído por outro worker
    worker.proc = null;
    worker.pronto = false;
    worker.booting = false;
    if (worker.timerReady) { clearTimeout(worker.timerReady); worker.timerReady = null; }
    // destrava a ação em execução e as pendências (a fila nunca trava)
    finalizarTodasAcoesWorker();
    const pend = worker.pendentes.splice(0);
    for (const p of pend) p.concluir();
    if (!worker.chegouReady) {
      worker.falhasBoot += 1;
      if (worker.falhasBoot >= 2) {
        worker.legacy = true;
        logger.aviso('[Teclado] Worker não sobe neste Windows — modo compatível (spawn por tecla, mais lento).');
      }
    }
  });

  proc.on('error', (err) => {
    logger.erro(`[Teclado] Worker PowerShell falhou: ${err.message}`);
    if (worker.proc !== proc) return;
    worker.legacy = true;
    worker.proc = null;
    worker.booting = false;
    finalizarTodasAcoesWorker();
    const pend = worker.pendentes.splice(0);
    for (const p of pend) p.concluir();
  });

  // o READY (compilação do Add-Type) deve chegar em até 25s
  worker.timerReady = setTimeout(() => {
    if (!worker.pronto && worker.proc === proc) {
      logger.erro('[Teclado] Worker PowerShell não ficou pronto em 25s — reiniciando...');
      try { proc.kill(); } catch { /* já morreu */ }
    }
  }, 25000);
}

/**
 * Envia uma linha de comando ao worker (ou enfileira enquanto ele sobe).
 * @param {string} linha - Comando PowerShell de UMA linha
 * @param {number} timeoutMs - Tempo máximo esperando o OK
 * @param {() => void} concluir - Callback de conclusão da fila
 * @param {string} desc - Descrição para logs de erro
 */
function executarNoWorker(linha, timeoutMs, concluir, desc) {
  if (!worker.pronto || !worker.proc) {
    worker.pendentes.push({ linha, timeoutMs, concluir, desc });
    iniciarWorker();
    return;
  }
  enviarParaWorker(linha, timeoutMs, concluir, desc);
}

/** Escreve a linha no stdin do worker e agenda o timeout da ação. */
function enviarParaWorker(linha, timeoutMs, concluir, desc) {
  const proc = worker.proc;
  if (!proc || !worker.pronto) { concluir(); return; }
  const acao = { concluir, timeoutId: null, desc };
  worker.acoes.push(acao);
  acao.timeoutId = setTimeout(() => {
    logger.erro(`[Teclado] Worker não respondeu (${desc}) — reiniciando...`);
    if (worker.proc) { try { worker.proc.kill(); } catch { /* já morreu */ } }
    // o exit do worker conclui tudo, mas garantimos aqui também (o kill
    // pode demorar e a fila não pode esperar)
    finalizarTodasAcoesWorker();
  }, timeoutMs);
  try {
    proc.stdin.write(linha + '\n');
  } catch (err) {
    logger.erro(`[Teclado] Falha ao enviar tecla ao worker: ${err.message}`);
    finalizarAcaoWorker();
  }
}

// ---------------------------------------------------------------------------
// Operações de teclado (multi-plataforma, enfileiradas)
// ---------------------------------------------------------------------------

/**
 * Envia um keydown de uma tecla (fica pressionada até o keyup).
 * @param {string} tecla - Tecla genérica
 */
function keyDown(tecla) {
  const plat = process.platform;
  enfileirar((concluir) => {
    if (plat === 'win32') {
      const vk = vkWindows(tecla);
      if (vk === null) { concluir(); return; }
      if (worker.legacy) {
        const script = modoJanela()
          ? scriptWindowsJanela([{ vk, down: true }], 0, alvoExe)
          : scriptWindows([{ vk, down: true }]);
        rodarPowerShell(script, 4000, concluir);
      } else if (modoJanela()) {
        executarNoWorker(linhaKeyJanela(vk, true), 4000, concluir, `segurar ${tecla}`);
      } else {
        executarNoWorker(linhaKey(vk, true), 4000, concluir, `segurar ${tecla}`);
      }
    } else if (plat === 'linux') {
      const nome = nomeXdotool(tecla);
      if (!nome) { concluir(); return; }
      rodarProcesso('xdotool', ['keydown', nome], 2000, concluir);
    } else if (plat === 'darwin') {
      const kc = keycodeMac(tecla);
      if (kc === null) { concluir(); return; }
      rodarProcesso(
        'osascript',
        ['-e', `tell application "System Events" to key down (key code ${kc})`],
        2000,
        concluir
      );
    } else {
      logger.erro(`[Teclado] Plataforma não suportada: ${plat}`);
      concluir();
    }
  });
}

/**
 * Envia um keyup de uma tecla.
 * @param {string} tecla - Tecla genérica
 */
function keyUp(tecla) {
  const plat = process.platform;
  enfileirar((concluir) => {
    if (plat === 'win32') {
      const vk = vkWindows(tecla);
      if (vk === null) { concluir(); return; }
      if (worker.legacy) {
        const script = modoJanela()
          ? scriptWindowsJanela([{ vk, down: false }], 0, alvoExe)
          : scriptWindows([{ vk, down: false }]);
        rodarPowerShell(script, 4000, concluir);
      } else if (modoJanela()) {
        executarNoWorker(linhaKeyJanela(vk, false), 4000, concluir, `soltar ${tecla}`);
      } else {
        executarNoWorker(linhaKey(vk, false), 4000, concluir, `soltar ${tecla}`);
      }
    } else if (plat === 'linux') {
      const nome = nomeXdotool(tecla);
      if (!nome) { concluir(); return; }
      rodarProcesso('xdotool', ['keyup', nome], 2000, concluir);
    } else if (plat === 'darwin') {
      const kc = keycodeMac(tecla);
      if (kc === null) { concluir(); return; }
      rodarProcesso(
        'osascript',
        ['-e', `tell application "System Events" to key up (key code ${kc})`],
        2000,
        concluir
      );
    } else {
      concluir();
    }
  });
}

/**
 * Envia um toque (keydown + espera + keyup) numa única ação.
 * @param {string} tecla - Tecla genérica
 * @param {number} [durMs] - Duração do toque
 */
function tocarTecla(tecla, durMs) {
  const duracao = durMs ?? duracaoPadraoMs();
  const plat = process.platform;
  // descartável=true: toque down+up autocontido — se a fila encher, este
  // pode ser descartado sem deixar tecla presa
  enfileirar((concluir) => {
    if (plat === 'win32') {
      const vk = vkWindows(tecla);
      if (vk === null) { concluir(); return; }
      if (worker.legacy) {
        const script = modoJanela()
          ? scriptWindowsJanela([{ vk, down: true }, { vk, down: false }], duracao, alvoExe)
          : scriptWindows([{ vk, down: true }, { vk, down: false }], duracao);
        rodarPowerShell(script, duracao + 5000, concluir);
      } else if (modoJanela()) {
        // o sleep do toque roda DENTRO do worker: a tecla fica mesmo
        // pressionada por duracao ms antes do keyup (PostMessage)
        executarNoWorker(linhaTapJanela(vk, duracao), duracao + 4000, concluir, `toque ${tecla}`);
      } else {
        // o sleep do toque roda DENTRO do worker: a tecla fica mesmo
        // pressionada por duracao ms antes do keyup
        executarNoWorker(linhaTap(vk, duracao), duracao + 4000, concluir, `toque ${tecla}`);
      }
    } else if (plat === 'linux') {
      const nome = nomeXdotool(tecla);
      if (!nome) { concluir(); return; }
      const segs = (duracao / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
      rodarProcesso('xdotool', ['keydown', nome, 'sleep', segs || '0.2', 'keyup', nome], duracao + 2000, concluir);
    } else if (plat === 'darwin') {
      const kc = keycodeMac(tecla);
      if (kc === null) { concluir(); return; }
      const segs = (duracao / 1000).toFixed(3);
      rodarProcesso(
        'osascript',
        [
          '-e', 'tell application "System Events"',
          '-e', `key down (key code ${kc})`,
          '-e', `delay ${segs}`,
          '-e', `key up (key code ${kc})`,
          '-e', 'end tell',
        ],
        duracao + 2000,
        concluir
      );
    } else {
      concluir();
    }
  }, true);
}

/**
 * Envia um toque COM MODIFICADORES (v2.5): shift+F5, ctrl+F2...
 * Pressiona os mods, toca a tecla principal e solta tudo — em UMA ação
 * da fila (ordem garantida) e UMA linha do worker.
 * @param {string[]} modificadores - ['shift'] etc.
 * @param {string} tecla - tecla principal (genérica)
 * @param {number} [durMs] - duração da tecla principal
 */
function tocarCombinacao(modificadores, tecla, durMs) {
  const duracao = durMs ?? duracaoPadraoMs();
  const plat = process.platform;
  // descartável=true: mods down -> tecla down -> tecla up -> mods up num
  // SÓ processo — autossuficiente, nada fica pendurado se for descartado
  enfileirar((concluir) => {
    if (plat === 'win32') {
      const vk = vkWindows(tecla);
      const vksMods = modificadores.map(vkWindows).filter((v) => v !== null);
      if (vk === null) { concluir(); return; }
      // ordem: mods down -> principal down -> principal up -> mods up (inverso)
      const eventos = [
        ...vksMods.map((vm) => ({ vk: vm, down: true })),
        { vk, down: true },
        { vk, down: false },
        ...vksMods.slice().reverse().map((vm) => ({ vk: vm, down: false })),
      ];
      const desc = `toque ${modificadores.join('+')}+${tecla}`;
      if (worker.legacy) {
        // modo compatível: script avulso (o sleep entra após cada down;
        // o lead do modificador sozinho é inofensivo)
        const script = modoJanela()
          ? scriptWindowsJanela(eventos, duracao, alvoExe)
          : scriptWindows(eventos, duracao);
        rodarPowerShell(script, duracao + 5000, concluir);
      } else {
        const linha = modoJanela()
          ? linhaSequenciaJanela(eventos, duracao)
          : linhaSequenciaGlobal(eventos, duracao);
        executarNoWorker(linha, duracao + 4000, concluir, desc);
      }
    } else if (plat === 'linux') {
      const nome = nomeXdotool(tecla);
      const nomesMods = modificadores.map(nomeXdotool).filter(Boolean);
      if (!nome) { concluir(); return; }
      const segs = (duracao / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
      const args = [];
      for (const m of nomesMods) args.push('keydown', m);
      args.push('keydown', nome, 'sleep', segs || '0.2', 'keyup', nome);
      for (const m of nomesMods.slice().reverse()) args.push('keyup', m);
      rodarProcesso('xdotool', args, duracao + 2000, concluir);
    } else if (plat === 'darwin') {
      const kc = keycodeMac(tecla);
      const kcsMods = modificadores.map(keycodeMac).filter((k) => k !== null);
      if (kc === null) { concluir(); return; }
      const segs = (duracao / 1000).toFixed(3);
      const args = ['-e', 'tell application "System Events"'];
      for (const k of kcsMods) args.push('-e', `key down (key code ${k})`);
      args.push('-e', `key down (key code ${kc})`, '-e', `delay ${segs}`, '-e', `key up (key code ${kc})`);
      for (const k of kcsMods.slice().reverse()) args.push('-e', `key up (key code ${k})`);
      args.push('-e', 'end tell');
      rodarProcesso('osascript', args, duracao + 2000, concluir);
    } else {
      concluir();
    }
  }, true);
}

// ---------------------------------------------------------------------------
// Estado das teclas seguradas (hold)
// ---------------------------------------------------------------------------

/** @type {Map<string, {timer: NodeJS.Timeout, dono: string|null, expiraEm: number}>} */
const teclasSeguradas = new Map();

/**
 * Segura um botão do controle por X milissegundos.
 * Se a tecla já estiver presa, o timer é estendido (não re-envia keydown).
 * @param {string} botao - Botão canônico (up, down, a, b...)
 * @param {number} duracaoMs - Por quanto tempo segurar
 * @param {string|null} dono - Nome de quem pediu (para logs)
 * @returns {boolean} true se aceito
 */
function segurar(botao, duracaoMs, dono = null) {
  const tecla = mapeamentoAtual[botao];
  if (!tecla) {
    logger.aviso(`[Teclado] Botão desconhecido para segurar: "${botao}"`);
    return false;
  }
  // combos não podem ser segurados (o parser já converte "hold salvar" em
  // toque, mas um mapeamento custom com + cairia aqui)
  if (String(tecla).includes('+')) {
    logger.aviso(`[Teclado] "${botao}" mapeado para combo (${tecla}) não pode ser segurado — use uma tecla simples.`);
    return false;
  }

  const atual = teclasSeguradas.get(tecla);
  if (atual) {
    // tecla já pressionada: só estende o tempo
    clearTimeout(atual.timer);
    const timer = setTimeout(() => soltarTecla(tecla), duracaoMs);
    teclasSeguradas.set(tecla, { timer, dono: dono || atual.dono, expiraEm: Date.now() + duracaoMs });
    logger.comando(`[Teclado] Hold estendido: ${botao} (${tecla}) por ${duracaoMs}ms${dono ? ` — @${dono}` : ''}`);
    return true;
  }

  keyDown(tecla);
  const timer = setTimeout(() => soltarTecla(tecla), duracaoMs);
  teclasSeguradas.set(tecla, { timer, dono, expiraEm: Date.now() + duracaoMs });
  logger.comando(`[Teclado] Hold: ${botao} (${tecla}) por ${duracaoMs}ms${dono ? ` — @${dono}` : ''}`);
  return true;
}

/**
 * Solta UMA tecla específica (se estiver presa).
 * @param {string} tecla - Tecla genérica
 */
function soltarTecla(tecla) {
  const info = teclasSeguradas.get(tecla);
  if (info) {
    clearTimeout(info.timer);
    teclasSeguradas.delete(tecla);
  }
  keyUp(tecla);
  logger.comando(`[Teclado] Tecla liberada: ${tecla}`);
}

/**
 * Solta TODAS as teclas presas (comando "soltar" do chat).
 * @returns {number} Quantas techas estavam presas
 */
function soltarTodas() {
  const quantidade = teclasSeguradas.size;
  for (const tecla of [...teclasSeguradas.keys()]) {
    const info = teclasSeguradas.get(tecla);
    clearTimeout(info.timer);
    teclasSeguradas.delete(tecla);
    keyUp(tecla);
  }
  if (quantidade > 0) {
    logger.comando(`[Teclado] ${quantidade} tecla(s) liberada(s) pelo chat.`);
  }
  return quantidade;
}

/**
 * Versão SÍNCRONA de soltarTodas para usar no encerramento (Ctrl+C),
 * garantindo que nenhuma tecla fique presa quando o bot morre.
 */
function soltarTodasSync() {
  if (teclasSeguradas.size === 0) return;
  const teclas = [...teclasSeguradas.keys()];
  for (const tecla of teclas) {
    const info = teclasSeguradas.get(tecla);
    clearTimeout(info.timer);
    teclasSeguradas.delete(tecla);
  }
  const plat = process.platform;
  try {
    if (plat === 'win32') {
      const eventos = teclas.map((t) => ({ vk: vkWindows(t), down: false })).filter((e) => e.vk !== null);
      if (eventos.length > 0) {
        // no modo janela solta via PostMessage na janela do emulador;
        // no modo global segue o keybd_event de sempre
        const script = modoJanela()
          ? scriptWindowsJanela(eventos, 0, alvoExe)
          : scriptWindows(eventos);
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        execFileSync('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
          { stdio: 'ignore', timeout: 5000 });
      }
    } else if (plat === 'linux') {
      const nomes = teclas.map(nomeXdotool).filter(Boolean);
      if (nomes.length > 0) execFileSync('xdotool', ['keyup', ...nomes], { stdio: 'ignore', timeout: 2000 });
    } else if (plat === 'darwin') {
      for (const tecla of teclas) {
        const kc = keycodeMac(tecla);
        if (kc !== null) {
          execFileSync('osascript',
            ['-e', `tell application "System Events" to key up (key code ${kc})`],
            { stdio: 'ignore', timeout: 2000 });
        }
      }
    }
    logger.info(`[Teclado] ${teclas.length} tecla(s) liberada(s) no encerramento.`);
  } catch (err) {
    logger.aviso(`[Teclado] Não foi possível soltar as teclas no encerramento: ${err.message}`);
  }
}

/**
 * Quantidade de teclas atualmente presas.
 * @returns {number}
 */
function totalSeguradas() {
  return teclasSeguradas.size;
}

/**
 * Lista as teclas seguradas agora (para o overlay do OBS).
 * @returns {Array<{tecla: string, dono: string|null, restanteMs: number}>}
 */
function listarSeguradas() {
  const agora = Date.now();
  return [...teclasSeguradas.entries()].map(([tecla, info]) => ({
    tecla,
    dono: info.dono,
    restanteMs: Math.max(0, info.expiraEm - agora),
  }));
}

/**
 * Verifica se uma tecla (ou COMBO, v2.5) é conhecida nos TRÊS backends
 * (Windows/Linux/macOS) — usada para validar TECLA_* do .env no startup.
 * @param {string} tecla - 'x', 'f5', 'shift+f5'...
 * @returns {boolean}
 */
function teclaSuportada(tecla) {
  return resolverTecla(tecla) !== null;
}

/**
 * v2.9: lista das teclas SIMPLES suportadas (interseção dos 3 backends) —
 * o assistente usa para validar no navegador a tecla que o streamer
 * digitou/capturou, antes mesmo de salvar. Combos (shift+f5) são montados
 * a partir destas + modificadores.
 * @returns {string[]}
 */
function listarTeclasValidas() {
  const nomes = new Set([
    ...Object.keys(VK_WINDOWS),
    ...Object.keys(KEYCODES_MAC),
    ...Object.keys(TECLAS_XDOTOOL),
  ]);
  // só teclas que os TRÊS backends conhecem (mesma regra do resolverTecla)
  const validas = [...nomes].filter((t) =>
    vkWindows(t) !== null && keycodeMac(t) !== null && nomeXdotool(t) !== null
  );
  return validas.sort();
}

// ---------------------------------------------------------------------------
// API pública de alto nível
// ---------------------------------------------------------------------------

/**
 * Executa um toque simples num botão do controle.
 * Aceita mapeamento simples ('x') ou combo ('shift+f5') — v2.5.
 * @param {string} botao - Botão canônico
 * @returns {boolean} true se o botão existe e foi enfileirado
 */
function executarBotao(botao) {
  const espec = mapeamentoAtual[botao];
  if (!espec) {
    logger.aviso(`[Teclado] Botão desconhecido: "${botao}"`);
    return false;
  }
  if (String(espec).includes('+')) {
    const combo = resolverTecla(espec);
    if (!combo) {
      logger.aviso(`[Teclado] Combo inválido para "${botao}": "${espec}" — use ex.: shift+f5`);
      return false;
    }
    logger.comando(`[Teclado] Toque: ${botao} -> combo "${espec}"`);
    tocarCombinacao(combo.modificadores, combo.tecla);
    return true;
  }
  logger.comando(`[Teclado] Toque: ${botao} -> tecla "${espec}"`);
  tocarTecla(espec);
  return true;
}

/**
 * Atualiza o mapeamento de botões -> teclas.
 * v2.9: com { substituir: true } o mapa NOVO substitui por completo o
 * antigo (controles desativados deixam de existir para o teclado);
 * sem a opção mantém o comportamento antigo de mesclar.
 * @param {object} novoMapa
 * @param {{substituir?: boolean}} [opcoes]
 */
function configurarMapeamento(novoMapa, opcoes = {}) {
  mapeamentoAtual = opcoes.substituir
    ? { ...novoMapa }
    : { ...mapeamentoAtual, ...novoMapa };
  logger.info(`[Teclado] Mapeamento atualizado: ${JSON.stringify(mapeamentoAtual)}`);
}

/**
 * Verifica se as dependências de sistema da plataforma atual estão OK.
 * @returns {Promise<boolean>}
 */
async function verificarSistema() {
  const plat = process.platform;
  if (plat === 'win32') {
    // Sobe o worker com antecedência: o Add-Type compila 1x aqui, e a
    // primeira tecla do chat já sai instantânea.
    iniciarWorker();
    const inicio = Date.now();
    return new Promise((resolve) => {
      const checar = () => {
        if (worker.pronto) {
          logger.info(modoJanela()
            ? '[Teclado] Backend Windows OK (PowerShell + PostMessage na janela do emulador) — teclas só no jogo.'
            : '[Teclado] Backend Windows OK (PowerShell + keybd_event) — teclas instantâneas.');
          resolve(true);
        } else if (worker.legacy) {
          try {
            execFileSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 8000 });
            logger.aviso('[Teclado] Backend Windows em modo compatível (spawn por tecla, mais lento).');
            resolve(true);
          } catch {
            logger.erro('[Teclado] PowerShell não encontrado neste Windows. Isso é muito raro.');
            resolve(false);
          }
        } else if (Date.now() - inicio > 30000) {
          logger.erro('[Teclado] PowerShell não respondeu — as teclas podem não funcionar.');
          resolve(false);
        } else {
          setTimeout(checar, 250);
        }
      };
      checar();
    });
  }
  if (plat === 'linux') {
    try {
      execFileSync('xdotool', ['--version'], { stdio: 'ignore', timeout: 2000 });
      logger.info('[Teclado] Backend Linux (xdotool) OK.');
      return true;
    } catch {
      logger.erro('[Teclado] xdotool não encontrado. Instale com: sudo apt install xdotool');
      return false;
    }
  }
  if (plat === 'darwin') {
    logger.info('[Teclado] Backend macOS (osascript) — lembre-se de conceder permissão de acessibilidade ao Terminal/Node.');
    return true;
  }
  logger.erro(`[Teclado] Plataforma não suportada: ${plat}`);
  return false;
}

module.exports = {
  executarBotao,
  segurar,
  soltarTodas,
  soltarTodasSync,
  totalSeguradas,
  listarSeguradas,
  teclaSuportada,
  listarTeclasValidas,
  configurarMapeamento,
  configurarAlvoJanela,
  modoJanela,
  verificarSistema,
  MAPEAMENTO_PADRAO,
  // Expostos APENAS para os testes unitários (src/tests/keyboard.test.js)
  // — não use em produção; a API pública está acima.
  __test: {
    vkWindows,
    keycodeMac,
    nomeXdotool,
    flagsKeybd,
    linhaKey,
    linhaTap,
    scriptWindows,
    VK_ESTENDIDOS,
    // --- v2.4: modo janela (PostMessage no emulador) ---
    linhaKeyJanela,
    linhaTapJanela,
    scriptWindowsJanela,
    montarBootPS,
    normalizarCaminhoAlvo,
    fontePCP: CS_PCP.join('\n'),
    // --- v2.5: combos + teclas de função ---
    resolverTecla,
    linhaSequenciaJanela,
    linhaSequenciaGlobal,
    // --- v2.9.2: política de descarte da fila (regressão de tecla presa) ---
    fila: {
      enfileirar,
      limpar: () => { filaAcoes.length = 0; processandoAcao = false; },
      inspecao: () => filaAcoes.map((a) => (a.descartavel ? 'toque' : 'tecla')),
    },
  },
};
