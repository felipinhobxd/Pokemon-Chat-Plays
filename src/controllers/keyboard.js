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
 * Script de boot do worker residente: compila o P/Invoke UMA vez, avisa
 * "READY" e passa a executar cada linha recebida via stdin (uma tecla por
 * linha), respondendo "OK" ou "ERR <motivo>" no stdout.
 */
const PS_BOOT = [
  PS_KEYBD,
  "[Console]::Out.WriteLine('READY');",
  'while($true){',
  '  $l = [Console]::In.ReadLine();',
  "  if($null -eq $l -or $l -eq 'QUIT'){ break }",
  "  try { Invoke-Expression $l; [Console]::Out.WriteLine('OK') }",
  "  catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }",
  '}',
].join('\n');

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
    const flags = ev.down ? 0 : 2; // 0 = keydown, 2 = KEYEVENTF_KEYUP
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
  acao: null,       // { concluir, timeoutId, desc } da ação em execução
  pendentes: [],    // ações aguardando o worker subir
  timerReady: null,
  falhasBoot: 0,
  legacy: false,    // true = worker não sobe; usar spawn por tecla
};

/** Linha PowerShell que pressiona (down=true) ou solta (down=false) um VK. */
function linhaKey(vk, down) {
  const flags = down ? 0 : 2;
  return `[KB]::keybd_event(${vk},[KB]::MapVirtualKey(${vk},0),${flags},[UIntPtr]::Zero)`;
}

/** Linha PowerShell que dá um toque completo: down + sleep + up. */
function linhaTap(vk, ms) {
  return `${linhaKey(vk, true)};[System.Threading.Thread]::Sleep(${Math.round(ms)});${linhaKey(vk, false)}`;
}

/** Conclui a ação em execução no worker (idempotente). */
function finalizarAcaoWorker() {
  const a = worker.acao;
  if (!a) return;
  worker.acao = null;
  if (a.timeoutId) clearTimeout(a.timeoutId);
  a.concluir();
}

/** Envia as ações que esperavam o worker ficar pronto. */
function liberarPendentes() {
  const pend = worker.pendentes.splice(0);
  for (const p of pend) {
    enviarParaWorker(p.linha, p.timeoutMs, p.concluir, p.desc);
  }
}

/** Processa uma linha de resposta do worker (READY/OK/ERR). */
function tratarLinhaWorker(linha) {
  if (linha === 'READY') {
    worker.pronto = true;
    worker.booting = false;
    worker.chegouReady = true;
    worker.falhasBoot = 0;
    if (worker.timerReady) { clearTimeout(worker.timerReady); worker.timerReady = null; }
    logger.info('[Teclado] Worker PowerShell ativo — teclas em ~1ms.');
    liberarPendentes();
    return;
  }
  if (linha === 'OK') {
    finalizarAcaoWorker();
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
    const encoded = Buffer.from(PS_BOOT, 'utf16le').toString('base64');
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
    finalizarAcaoWorker();
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
    finalizarAcaoWorker();
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
  worker.acao = { concluir, timeoutId: null, desc };
  worker.acao.timeoutId = setTimeout(() => {
    logger.erro(`[Teclado] Worker não respondeu (${desc}) — reiniciando...`);
    if (worker.proc) { try { worker.proc.kill(); } catch { /* já morreu */ } }
    finalizarAcaoWorker();
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
        rodarPowerShell(scriptWindows([{ vk, down: true }]), 4000, concluir);
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
        rodarPowerShell(scriptWindows([{ vk, down: false }]), 4000, concluir);
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
  enfileirar((concluir) => {
    if (plat === 'win32') {
      const vk = vkWindows(tecla);
      if (vk === null) { concluir(); return; }
      if (worker.legacy) {
        rodarPowerShell(scriptWindows([{ vk, down: true }, { vk, down: false }], duracao), duracao + 5000, concluir);
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
    // Sobe o worker com antecedência: o Add-Type compila 1x aqui, e a
    // primeira tecla do chat já sai instantânea.
    iniciarWorker();
    const inicio = Date.now();
    return new Promise((resolve) => {
      const checar = () => {
        if (worker.pronto) {
          logger.info('[Teclado] Backend Windows OK (PowerShell + keybd_event) — teclas instantâneas.');
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
  configurarMapeamento,
  verificarSistema,
  MAPEAMENTO_PADRAO,
};
