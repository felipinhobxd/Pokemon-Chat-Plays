/**
 * Controlador de teclado SEM dependências nativas — versão 2.2.
 *
 * Backends por plataforma:
 *  - Windows: PowerShell + keybd_event (user32.dll) via -EncodedCommand
 *  - Linux:   xdotool (keydown / keyup / sleep)
 *  - macOS:   osascript + System Events (key code / key down / key up)
 *
 * Novidades da v2.2:
 *  - HOLD REAL: keydown e keyup são enviados separados, então o chat pode
 *    SEGURAR uma tecla por um tempo ("hold cima 3") e soltar depois ("soltar").
 *  - Duração de toque configurável em TODAS as plataformas (antes o Windows
 *    ignorava KEY_PRESS_DURATION_MS por causa do SendKeys).
 *  - Execução ASSÍNCRONA com fila sequencial (spawn em vez de execFileSync):
 *    o event loop do Node nunca bloqueia enquanto as teclas são enviadas.
 *  - macOS corrigido: setas agora usam "key code" (antes "keystroke Up_Arrow"
 *    não funcionava).
 *
 * Mapeamento padrão (compatível com VisualBoyAdvance-M):
 *   ⬆ up -> seta cima     ⬇ down -> seta baixo
 *   ⬅ left -> seta esq    ➡ right -> seta dir
 *   🅰 A -> X   🅱 B -> Z   🔵 L -> A   🔴 R -> S
 *   ▶ Start -> Enter   ▦ Select -> Backspace
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
};

let mapeamentoAtual = { ...MAPEAMENTO_PADRAO };
const duracaoPadraoMs = () => config.geral.tempoPressionarTeclaMs;

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

/** Key codes do macOS (System Events). */
const KEYCODES_MAC = {
  a: 0, b: 11, c: 12, d: 2, e: 14, f: 3, g: 15, h: 4, i: 34, j: 38,
  k: 40, l: 37, m: 46, n: 45, o: 31, p: 35, q: 12, r: 15, s: 1, t: 17,
  u: 32, v: 9, w: 13, x: 7, y: 16, z: 6,
  '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26,
  '8': 28, '9': 25,
  up: 126, down: 125, left: 123, right: 124,
  enter: 36, return: 36, backspace: 51, space: 49, tab: 48, esc: 53, escape: 53,
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
 */
function enfileirar(acao) {
  if (filaAcoes.length >= FILA_MAX) {
    const descartada = filaAcoes.shift();
    logger.aviso('[Teclado] Fila cheia — ação antiga descartada para não atrasar o jogo.');
    void descartada;
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
// Windows: PowerShell + keybd_event (permite keydown/keyup separados!)
// ---------------------------------------------------------------------------

/** Cabeçalho C# com o P/Invoke do keybd_event (compilado uma vez por script). */
const PS_KEYBD = [
  '$sig = \'using System.Runtime.InteropServices;',
  'public class KB {',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
  '}\';',
  'Add-Type -TypeDefinition $sig;',
].join(' ');

/**
 * Monta o script PowerShell que pressiona/solta teclas do Windows.
 * @param {Array<{vk: number, down: boolean}>} eventos
 * @param {number} [esperaMs] - Pausa entre o primeiro down e o up (tap)
 * @returns {string} Script PowerShell pronto
 */
function scriptWindows(eventos, esperaMs) {
  const partes = [PS_KEYBD];
  for (const ev of eventos) {
    const flags = ev.down ? 0 : 2; // 0 = keydown, 2 = KEYEVENTF_KEYUP
    partes.push(`[KB]::keybd_event(${ev.vk},0,${flags},[UIntPtr]::Zero);`);
  }
  if (esperaMs > 0) {
    // insere o sleep antes do keyup (o tap tem formato down;sleep;up)
    const idxDown = partes.findIndex((p) => p.includes('keybd_event'));
    partes.splice(idxDown + 1, 0, `Start-Sleep -Milliseconds ${esperaMs};`);
  }
  return partes.join('');
}

/**
 * Executa um script PowerShell via -EncodedCommand (Base64 UTF-16LE).
 * Esse formato elimina completamente problemas de escape de aspas.
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
      rodarPowerShell(scriptWindows([{ vk, down: true }]), 4000, concluir);
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
      rodarPowerShell(scriptWindows([{ vk, down: false }]), 4000, concluir);
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
  enfileirar((concluir) => {
    if (plat === 'win32') {
      const vk = vkWindows(tecla);
      if (vk === null) { concluir(); return; }
      rodarPowerShell(scriptWindows([{ vk, down: true }, { vk, down: false }], duracao), duracao + 5000, concluir);
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
  });
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
        const encoded = Buffer.from(scriptWindows(eventos), 'utf16le').toString('base64');
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

// ---------------------------------------------------------------------------
// API pública de alto nível
// ---------------------------------------------------------------------------

/**
 * Executa um toque simples num botão do controle.
 * @param {string} botao - Botão canônico
 * @returns {boolean} true se o botão existe e foi enfileirado
 */
function executarBotao(botao) {
  const tecla = mapeamentoAtual[botao];
  if (!tecla) {
    logger.aviso(`[Teclado] Botão desconhecido: "${botao}"`);
    return false;
  }
  logger.comando(`[Teclado] Toque: ${botao} -> tecla "${tecla}"`);
  tocarTecla(tecla);
  return true;
}

/**
 * Atualiza o mapeamento de botões -> teclas.
 * @param {object} novoMapa
 */
function configurarMapeamento(novoMapa) {
  mapeamentoAtual = { ...mapeamentoAtual, ...novoMapa };
  logger.info(`[Teclado] Mapeamento atualizado: ${JSON.stringify(mapeamentoAtual)}`);
}

/**
 * Verifica se as dependências de sistema da plataforma atual estão OK.
 * @returns {Promise<boolean>}
 */
async function verificarSistema() {
  const plat = process.platform;
  if (plat === 'win32') {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion'], { stdio: 'ignore', timeout: 8000 });
      logger.info('[Teclado] Backend Windows (PowerShell + keybd_event) OK.');
      return true;
    } catch {
      logger.erro('[Teclado] PowerShell não encontrado neste Windows. Isso é muito raro.');
      return false;
    }
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
  configurarMapeamento,
  verificarSistema,
  MAPEAMENTO_PADRAO,
};
