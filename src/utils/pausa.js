/**
 * Botão de pânico do streamer (v2.3): tecla F9 pausa/libera o chat.
 *
 * Como funciona:
 *  - Windows: um processo PowerShell rodando em segundo plano vigia a
 *    tecla F9 via GetAsyncKeyState (0x78) e escreve "F9" no stdout quando
 *    o streamer APERTA a tecla (borda de subida, não repete segurando).
 *    O Node lê a linha e alterna a pausa.
 *  - Linux/macOS: sem API global de teclas sem dependências nativas —
 *    nessas plataformas o streamer pausa com ENTER no terminal (o index.js
 *    instala o listener de stdin) ou via pausa.alternar() programaticamente.
 *
 * Quando o chat está pausado, os comandos de jogo (botões/hold/soltar) são
 * ignorados no pipeline (src/handlers.js) — sem travar o processo e sem
 * responder no chat (para não virar spam).
 *
 * Ao pausar, o index.js solta todas as teclas presas (um hold de "cima"
 * pausado deixaria o personagem andando sozinho).
 */

const { spawn } = require('child_process');
const logger = require('./logger');

/** VK_F9 do Windows. */
const VK_F9 = 0x78;

/** Estado da pausa. */
let pausado = false;
let origemUltima = null;

/** Ouvintes de mudança: (pausado: boolean, origem: string) => void. */
const ouvintes = [];

/** Watcher PowerShell (Windows). */
let watcher = {
  proc: null,
  tentativas: 0,
  desistido: false,
  timer: null,
};

/** Script do watcher: imprime "F9" cada vez que a tecla é PRESSIONADA. */
const PS_WATCHER = [
  "$sig = 'using System;",
  'using System.Runtime.InteropServices;',
  'public class WK {',
  '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);',
  "}\';",
  'Add-Type -TypeDefinition $sig;',
  "[Console]::Out.WriteLine('WATCH:ON');",
  '$ativo = $false;',
  'while($true){',
  `  $pressionada = (([WK]::GetAsyncKeyState(${VK_F9})) -band 0x8000) -ne 0`,
  "  if($pressionada -and -not $ativo){ [Console]::Out.WriteLine('F9') }",
  '  $ativo = $pressionada',
  '  Start-Sleep -Milliseconds 120',
  '}',
].join('\n');

/**
 * Registra um ouvinte de mudanças de pausa.
 * @param {(pausado: boolean, origem: string|null) => void} callback
 * @returns {() => void} Função para cancelar a observação
 */
function observar(callback) {
  if (typeof callback === 'function') ouvintes.push(callback);
  return () => {
    const idx = ouvintes.indexOf(callback);
    if (idx >= 0) ouvintes.splice(idx, 1);
  };
}

/** Notifica todos os ouvintes (erros individuais não propagam). */
function notificar() {
  for (const cb of [...ouvintes]) {
    try {
      cb(pausado, origemUltima);
    } catch (err) {
      logger.erro(`[Pausa] Ouvinte falhou: ${err.message}`);
    }
  }
}

/**
 * Alterna entre pausado e liberado.
 * @param {string} [origem] - 'tecla F9' | 'terminal' | 'api'
 * @returns {boolean} novo estado (true = pausado)
 */
function alternar(origem = 'api') {
  pausado = !pausado;
  origemUltima = origem;
  notificar();
  return pausado;
}

/**
 * Define o estado diretamente (testes / integrações).
 * @param {boolean} novoEstado
 * @param {string} [origem]
 * @returns {boolean} estado aplicado
 */
function definir(novoEstado, origem = 'api') {
  const mudou = pausado !== Boolean(novoEstado);
  pausado = Boolean(novoEstado);
  if (mudou) {
    origemUltima = origem;
    notificar();
  }
  return pausado;
}

/** @returns {boolean} true se o chat está pausado agora. */
function estaPausado() {
  return pausado;
}

/** Reseta o estado (para testes). */
function resetar() {
  pausado = false;
  origemUltima = null;
}

// ---------------------------------------------------------------------------
// Watcher de tecla F9 (somente Windows)
// ---------------------------------------------------------------------------

/** Sobe o watcher do PowerShell (se ainda não estiver rodando). */
function iniciarWatcherF9() {
  if (process.platform !== 'win32') {
    logger.info('[Pausa] Streamer: pressione ENTER no terminal para pausar/liberar o chat.');
    return;
  }
  if (watcher.proc || watcher.desistido) return;

  let proc;
  try {
    const encoded = Buffer.from(PS_WATCHER, 'utf16le').toString('base64');
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    logger.aviso(`[Pausa] Não foi possível vigiar o F9 (${err.message}) — use ENTER no terminal.`);
    return;
  }

  watcher.proc = proc;
  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (linha === 'F9') {
        alternar('tecla F9');
      }
    }
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', () => { /* erros do watcher não vão poluir o terminal */ });

  proc.on('exit', () => {
    if (watcher.proc !== proc) return; // substituído/parado de propósito
    watcher.proc = null;
    watcher.tentativas += 1;
    // watcher deve viver para sempre; se morrer rápido 3x, desiste
    if (watcher.tentativas >= 3) {
      watcher.desistido = true;
      logger.aviso('[Pausa] Vigia do F9 não se mantém neste Windows — use ENTER no terminal.');
      return;
    }
    watcher.timer = setTimeout(() => iniciarWatcherF9(), 2000);
    watcher.timer.unref?.();
  });

  proc.on('error', () => {
    if (watcher.proc !== proc) return;
    watcher.proc = null;
    watcher.desistido = true;
    logger.aviso('[Pausa] Vigia do F9 indisponível — use ENTER no terminal para pausar.');
  });

  logger.info('[Pausa] 🛑 Streamer: aperte F9 em qualquer lugar para pausar/liberar o chat.');
}

/** Para o watcher (encerramento do app). */
function pararWatcher() {
  if (watcher.timer) clearTimeout(watcher.timer);
  watcher.desistido = true; // impede respawn durante o shutdown
  if (watcher.proc) {
    try { watcher.proc.kill(); } catch { /* já morreu */ }
    watcher.proc = null;
  }
}

module.exports = {
  alternar,
  definir,
  estaPausado,
  resetar,
  observar,
  iniciarWatcherF9,
  pararWatcher,
};
