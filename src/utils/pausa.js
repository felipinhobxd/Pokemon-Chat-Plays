/**
 * Botão de pânico do streamer (v2.3): tecla F9 pausa/libera o chat.
 *
 * Como funciona:
 *  - Windows: um processo PowerShell rodando em segundo plano vigia as
 *    teclas registradas via GetAsyncKeyState e escreve o NOME da tecla no
 *    stdout quando o streamer APERTA (borda de subida, não repete
 *    segurando). O Node lê a linha e dispara o callback da tecla.
 *  - Linux/macOS: sem API global de teclas sem dependências nativas —
 *    nessas plataformas o streamer pausa com ENTER no terminal (o index.js
 *    instala o listener de stdin) ou via pausa.alternar() programaticamente.
 *
 * v2.5:
 *  - TECLA_PAUSA configurável no .env (padrão f9 — evita conflito com os
 *    F1-F10 de savestate do VBA-M escolhendo outra tecla);
 *  - o MESMO watcher vigia outras teclas registradas (o index registra a
 *    TECLA_MODO=f8 para alternar anarquia/democracia) — 1 processo só.
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

/**
 * VK codes do Windows resolvidos localmente (o pausa.js não depende do
 * keyboard.js para continuar testável isolado).
 */
const VKS_LOCAIS = {
  esc: 0x1b, escape: 0x1b, tab: 0x09, enter: 0x0d, return: 0x0d,
  backspace: 0x08, space: 0x20, shift: 0x10, ctrl: 0x11, alt: 0x12,
  pause: 0x13, insert: 0x2d, delete: 0x2e, home: 0x24, end: 0x23,
  pageup: 0x21, pagedown: 0x22,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
};

/**
 * Resolve o VK code do Windows de um nome de tecla (f9, p, a...).
 * @param {string} nome
 * @returns {number|null}
 */
function vkPausa(nome) {
  const t = String(nome || '').toLowerCase().trim();
  if (VKS_LOCAIS[t] !== undefined) return VKS_LOCAIS[t];
  if (/^[a-z0-9]$/.test(t)) return t.toUpperCase().charCodeAt(0);
  return null;
}

/** Estado da pausa. */
let pausado = false;
let origemUltima = null;

/** Tecla global que pausa/libera o chat (v2.5 — configurável). */
let teclaPausa = 'f9';

/** Teclas extras vigiadas pelo mesmo watcher: nome -> callback (v2.5). */
const teclasExtras = new Map();

/** Ouvintes de mudança: (pausado: boolean, origem: string) => void. */
const ouvintes = [];

/** Watcher PowerShell (Windows). */
let watcher = {
  proc: null,
  tentativas: 0,
  desistido: false,
  timer: null,
  nascidoEm: 0,
};

/**
 * Script do watcher: imprime o NOME da tecla cada vez que ela é PRESSIONADA
 * (uma linha por tecla, só na borda de subida). Vigia TODAS as teclas
 * registradas em UM único processo PowerShell.
 * @returns {string}
 */
function montarWatcherPS() {
  // a tecla de pausa e as extras imprimem o PRÓPRIO NOME (F9, F8...) —
  // o Node roteia comparando o nome em minúsculas
  const vigiadas = [teclaPausa, ...teclasExtras.keys()];
  const pares = vigiadas
    .filter((nome) => vkPausa(nome) !== null)
    .map((nome) => `'${nome.toUpperCase()}' = ${vkPausa(nome)}`);
  if (pares.length === 0) pares.push(`'F9' = ${VKS_LOCAIS.f9}`);
  return [
    "$sig = 'using System;",
    'using System.Runtime.InteropServices;',
    'public class WK {',
    '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);',
    "}\';",
    'Add-Type -TypeDefinition $sig;',
    "[Console]::Out.WriteLine('WATCH:ON');",
    `$keys = @{ ${pares.join('; ')} };`,
    '$ativo = @{};',
    'foreach($k in $keys.Keys){ $ativo[$k] = $false }',
    'while($true){',
    '  foreach($k in $keys.Keys){',
    '    $p = (([WK]::GetAsyncKeyState([int]$keys[$k])) -band 0x8000) -ne 0',
    '    if($p -and -not $ativo[$k]){ [Console]::Out.WriteLine($k) }',
    '    $ativo[$k] = $p',
    '  }',
    '  Start-Sleep -Milliseconds 120',
    '}',
  ].join('\n');
}

/**
 * Define a tecla global de pausa (v2.5 — TECLA_PAUSA do .env).
 * Deve ser chamada ANTES de iniciarWatcherF9().
 * @param {string} nome - ex.: 'f9', 'f6'
 * @returns {boolean} true se a tecla é válida (senão mantém a atual)
 */
function configurarTecla(nome) {
  const t = String(nome || '').toLowerCase().trim();
  if (vkPausa(t) === null) {
    logger.aviso(`[Pausa] TECLA_PAUSA="${nome}" inválida — mantendo ${teclaPausa.toUpperCase()}. Use f1-f12, a-z, 0-9...`);
    return false;
  }
  teclaPausa = t;
  return true;
}

/**
 * Registra uma tecla EXTRA para o mesmo watcher vigiar (v2.5).
 * Ex.: index.js registra a TECLA_MODO (F8) para alternar anarquia/democracia.
 * Deve ser chamada ANTES de iniciarWatcherF9() (senão avisa para reiniciar).
 * @param {string} nome - ex.: 'f8'
 * @param {Function} callback - chamado quando a tecla é pressionada
 * @returns {boolean} true se registrada
 */
function registrarTecla(nome, callback) {
  const t = String(nome || '').toLowerCase().trim();
  if (typeof callback !== 'function' || vkPausa(t) === null) {
    logger.aviso(`[Pausa] Tecla extra "${nome}" inválida — não registrada.`);
    return false;
  }
  if (t === teclaPausa) {
    logger.aviso(`[Pausa] Tecla extra "${t}" é a tecla de pausa — use outra.`);
    return false;
  }
  teclasExtras.set(t, callback);
  if (watcher.proc) {
    logger.aviso(`[Pausa] Tecla "${t}" registrada — reinicie o bot para vigiá-la.`);
  }
  return true;
}

/** @returns {string} tecla de pausa atual (normalizada). */
function teclaAtual() {
  return teclaPausa;
}

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
  teclasExtras.clear();
  teclaPausa = 'f9';
}

// ---------------------------------------------------------------------------
// Watcher de tecla F9 (somente Windows)
// ---------------------------------------------------------------------------

/**
 * Sobe o watcher do PowerShell (se ainda não estiver rodando).
 * Vigia a tecla de pausa (TECLA_PAUSA, padrão F9) + as extras registradas
 * (TECLA_MODO, padrão F8) em UM único processo.
 */
function iniciarWatcherF9() {
  if (process.platform !== 'win32') {
    logger.info(`[Pausa] Streamer: pressione ENTER no terminal para pausar/liberar o chat (a tecla ${teclaPausa.toUpperCase()} só funciona no Windows).`);
    return;
  }
  if (watcher.proc || watcher.desistido) return;

  let proc;
  try {
    const encoded = Buffer.from(montarWatcherPS(), 'utf16le').toString('base64');
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    logger.aviso(`[Pausa] Não foi possível vigiar as teclas (${err.message}) — use ENTER no terminal.`);
    return;
  }

  watcher.proc = proc;
  watcher.nascidoEm = Date.now();
  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!linha || linha === 'WATCH:ON') continue;
      const nome = linha.toLowerCase();
      if (nome === teclaPausa) {
        alternar(`tecla ${linha}`);
      } else if (teclasExtras.has(nome)) {
        const cb = teclasExtras.get(nome);
        try {
          cb(`tecla ${linha}`);
        } catch (err) {
          logger.erro(`[Pausa] Callback da tecla ${linha} falhou: ${err.message}`);
        }
      }
    }
  });

  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', () => { /* erros do watcher não vão poluir o terminal */ });

  proc.on('exit', () => {
    if (watcher.proc !== proc) return; // substituído/parado de propósito
    watcher.proc = null;
    // viveu bastante? a morte foi ACIDENTAL (não um Windows quebrado):
    // zera o contador para não desistir de vez numa live longa
    if (Date.now() - watcher.nascidoEm > 60000) watcher.tentativas = 0;
    watcher.tentativas += 1;
    // watcher deve viver para sempre; se morrer rápido 3x, desiste
    if (watcher.tentativas >= 3) {
      watcher.desistido = true;
      logger.aviso('[Pausa] Vigia das teclas não se mantém neste Windows — use ENTER no terminal.');
      return;
    }
    watcher.timer = setTimeout(() => iniciarWatcherF9(), 2000);
    watcher.timer.unref?.();
  });

  proc.on('error', () => {
    if (watcher.proc !== proc) return;
    watcher.proc = null;
    watcher.desistido = true;
    logger.aviso('[Pausa] Vigia das teclas indisponível — use ENTER no terminal para pausar.');
  });

  const extras = teclasExtras.size > 0 ? ` (extras: ${[...teclasExtras.keys()].map((t) => t.toUpperCase()).join(', ')})` : '';
  logger.info(`[Pausa] 🛑 Streamer: aperte ${teclaPausa.toUpperCase()} em qualquer lugar para pausar/liberar o chat${extras}.`);
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
  // --- v2.5 ---
  configurarTecla,
  registrarTecla,
  teclaAtual,
  __test: {
    montarWatcherPS,
    vkPausa,
  },
};
