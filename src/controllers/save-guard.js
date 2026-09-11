/**
 * Proteção do savestate no Windows (v2.9.3).
 *
 * Problema real:
 * no modo JANELA o ChatPlays envia as teclas com PostMessage para não mexer
 * no OBS. Combos como Shift+F5 podem ser lidos por alguns emuladores como F5
 * puro, porque PostMessage não altera de forma confiável o estado GLOBAL do
 * modificador. Em VBA-M/mGBA/DeSmuME, F5 = CARREGAR e Shift+F5 = SALVAR.
 * Resultado: um pedido de "salvar" podia, raramente, carregar o estado.
 *
 * Esta camada é fail-safe: em modo janela, combos de salvar são enviados com
 * o modificador também mantido no estado real do Windows enquanto a tecla
 * principal é entregue SINCRONAMENTE à janela do jogo. A tecla principal
 * nunca é enviada globalmente. Se algo falhar, o save é ignorado e logado —
 * nunca fazemos fallback para F5 puro, porque carregar por engano é pior do
 * que perder um pedido de save.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { config } = require('../config');
const controles = require('../controles');

const MODIFICADORES = new Set(['shift', 'ctrl', 'alt']);
const VK_FIXOS = Object.freeze({
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
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
});

let saveEmAndamento = false;
let savePendente = false;
let avisouMapaPerigoso = false;

function vkWindows(tecla) {
  const t = String(tecla || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(VK_FIXOS, t)) return VK_FIXOS[t];
  if (/^[a-z0-9]$/.test(t)) return t.toUpperCase().charCodeAt(0);
  return null;
}

function normalizarEspec(espec) {
  return String(espec || '')
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('+');
}

/**
 * Impede a configuração mais perigosa: salvar e carregar na MESMA tecla F.
 * Se isso veio de uma configuração antiga/captura incorreta, converte o save
 * para Shift+Fn, preservando o mesmo slot.
 */
function corrigirEspecPerigosa(salvar, carregar) {
  const s = normalizarEspec(salvar);
  const c = normalizarEspec(carregar);
  if (s && s === c && /^f(?:[1-9]|10)$/.test(s)) return `shift+${s}`;
  return s;
}

function resolverCombo(espec) {
  const partes = normalizarEspec(espec).split('+').filter(Boolean);
  if (partes.length < 2) return null;
  const tecla = partes[partes.length - 1];
  const mods = partes.slice(0, -1);
  if (mods.some((m) => !MODIFICADORES.has(m))) return null;
  const vkTecla = vkWindows(tecla);
  const vksMods = mods.map(vkWindows);
  if (vkTecla === null || vksMods.some((v) => v === null)) return null;
  return { mods, tecla, vksMods, vkTecla };
}

function limparAspas(caminho) {
  let t = String(caminho || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Descobre o mesmo alvo que o fluxo normal usa: .env ou dados/emulador.json. */
function descobrirAlvo() {
  if (String(config.teclado?.modo || '').toLowerCase() === 'global') return null;
  const doEnv = limparAspas(config.teclado?.emuladorExe);
  if (doEnv) return doEnv;
  try {
    const arquivo = path.resolve(process.cwd(), 'dados', 'emulador.json');
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return limparAspas(dados?.exe) || null;
  } catch {
    return null;
  }
}

function escaparPs(texto) {
  return String(texto || '').replace(/'/g, "''");
}

/**
 * PowerShell/C# usado só no save protegido.
 * - modificadores: keybd_event GLOBAL + SendMessage na janela;
 * - tecla principal: APENAS SendMessage na janela (nunca F5 global);
 * - SendMessage é síncrono: o emulador processa Shift antes de F5;
 * - finally sempre solta os modificadores.
 */
function montarScriptSeguro(alvo, combo, duracaoMs = 120) {
  const duracao = Math.max(80, Math.min(400, Number(duracaoMs) || 120));
  const mods = combo.vksMods.join(',');
  const alvoPs = escaparPs(alvo);
  return `
$src = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class ChatPlaysSafeSave {
  const uint WM_KEYDOWN = 0x0100;
  const uint WM_KEYUP = 0x0101;

  [DllImport("user32.dll")]
  static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  static extern uint MapVirtualKey(uint uCode, uint uMapType);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  static IntPtr Encontrar(string exe) {
    string full = exe;
    try { full = Path.GetFullPath(exe); } catch { }
    string nome;
    try { nome = Path.GetFileNameWithoutExtension(full); } catch { return IntPtr.Zero; }
    IntPtr fallback = IntPtr.Zero;
    Process[] processos;
    try { processos = Process.GetProcessesByName(nome); } catch { return IntPtr.Zero; }
    foreach (Process p in processos) {
      try {
        IntPtr h = p.MainWindowHandle;
        if (h == IntPtr.Zero) continue;
        if (fallback == IntPtr.Zero) fallback = h;
        try {
          string real = Path.GetFullPath(p.MainModule.FileName);
          if (String.Equals(real, full, StringComparison.OrdinalIgnoreCase)) return h;
        } catch { }
      } catch { }
      finally { try { p.Dispose(); } catch { } }
    }
    return fallback;
  }

  static IntPtr LParam(int vk, bool down) {
    uint scan = MapVirtualKey((uint)vk, 0);
    uint lp = 1u | (scan << 16);
    if (!down) lp |= 0xC0000000u;
    return unchecked((IntPtr)(int)lp);
  }

  static void Global(int vk, bool down) {
    uint scan = MapVirtualKey((uint)vk, 0);
    uint flags = down ? 0u : 2u;
    keybd_event((byte)vk, (byte)scan, flags, UIntPtr.Zero);
  }

  public static int Executar(string exe, int[] mods, int tecla, int holdMs) {
    IntPtr h = Encontrar(exe);
    if (h == IntPtr.Zero) return 2;
    int pressionados = 0;
    try {
      for (int i = 0; i < mods.Length; i++) {
        Global(mods[i], true);
        SendMessage(h, WM_KEYDOWN, (IntPtr)mods[i], LParam(mods[i], true));
        pressionados++;
      }
      Thread.Sleep(30);
      SendMessage(h, WM_KEYDOWN, (IntPtr)tecla, LParam(tecla, true));
      Thread.Sleep(holdMs);
      SendMessage(h, WM_KEYUP, (IntPtr)tecla, LParam(tecla, false));
      Thread.Sleep(35);
      return 0;
    }
    finally {
      for (int i = pressionados - 1; i >= 0; i--) {
        try { SendMessage(h, WM_KEYUP, (IntPtr)mods[i], LParam(mods[i], false)); } catch { }
        try { Global(mods[i], false); } catch { }
      }
    }
  }
}
'@
Add-Type -TypeDefinition $src
$mods = [int[]]@(${mods})
$r = [ChatPlaysSafeSave]::Executar('${alvoPs}', $mods, ${combo.vkTecla}, ${duracao})
exit $r
`.trim();
}

function executarPowerShell(script, aoTerminar) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let filho;
  try {
    filho = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true }
    );
  } catch (err) {
    aoTerminar(-1, err);
    return;
  }
  let terminou = false;
  const finalizar = (codigo, err) => {
    if (terminou) return;
    terminou = true;
    clearTimeout(timer);
    aoTerminar(typeof codigo === 'number' ? codigo : -1, err);
  };
  const timer = setTimeout(() => {
    try { filho.kill(); } catch { }
    finalizar(-1, new Error('timeout do save protegido'));
  }, 8000);
  filho.on('exit', (codigo) => finalizar(codigo));
  filho.on('error', (err) => finalizar(-1, err));
}

function executarGuardado(teclado, original) {
  const mapa = controles.mapaTeclado();
  const originalSalvar = normalizarEspec(mapa.salvar);
  const originalCarregar = normalizarEspec(mapa.carregar);
  const especSalvar = corrigirEspecPerigosa(originalSalvar, originalCarregar);

  if (!especSalvar) return original('salvar');

  if (especSalvar !== originalSalvar && !avisouMapaPerigoso) {
    avisouMapaPerigoso = true;
    logger.aviso(
      `[SaveGuard] ⚠️ SALVAR estava na mesma tecla de CARREGAR (${originalSalvar}). ` +
      `Para impedir load acidental, usando ${especSalvar} para salvar.`
    );
  }

  // Fora do Windows, no modo global ou com tecla simples, o backend normal
  // já tem a semântica correta. O bug específico é combo + modo janela.
  if (process.platform !== 'win32' || !teclado.modoJanela() || !especSalvar.includes('+')) {
    if (especSalvar !== originalSalvar) {
      // mapa perigoso em modo global: não podemos chamar o original porque ele
      // ainda aponta para F5 puro. Falha segura é melhor que carregar.
      logger.erro(`[SaveGuard] SALVAR recusado: configuração perigosa (${originalSalvar}). Defina SALVAR como ${especSalvar}.`);
      return false;
    }
    return original('salvar');
  }

  const alvo = descobrirAlvo();
  const combo = resolverCombo(especSalvar);
  if (!alvo || !combo) {
    logger.erro('[SaveGuard] SALVAR não executado: não consegui confirmar alvo/combo com segurança. Nada foi carregado.');
    return false;
  }

  if (saveEmAndamento) {
    savePendente = true;
    logger.info('[SaveGuard] Save já em andamento — deixei mais 1 save pendente.');
    return true;
  }

  const disparar = () => {
    saveEmAndamento = true;
    const script = montarScriptSeguro(alvo, combo, 120);
    executarPowerShell(script, (codigo, err) => {
      saveEmAndamento = false;
      if (codigo === 0) {
        logger.comando(`[SaveGuard] 💾 SALVAR enviado com segurança (${especSalvar}) — F5 puro nunca foi enviado globalmente.`);
      } else if (codigo === 2) {
        logger.erro(`[SaveGuard] SALVAR não executado: janela do jogo não encontrada (${alvo}). Nada foi carregado.`);
      } else {
        logger.erro(`[SaveGuard] SALVAR falhou${err ? ` (${err.message})` : ` (código ${codigo})`} — sem fallback para load.`);
      }
      if (savePendente) {
        savePendente = false;
        setTimeout(disparar, 50);
      }
    });
  };

  disparar();
  return true;
}

function instalar(teclado) {
  if (!teclado || typeof teclado.executarBotao !== 'function') {
    throw new TypeError('SaveGuard precisa do controlador de teclado.');
  }
  if (teclado.__saveGuardInstalado) return teclado;

  const original = teclado.executarBotao.bind(teclado);
  teclado.executarBotao = function executarBotaoProtegido(botao) {
    if (String(botao || '') !== 'salvar') return original(botao);
    return executarGuardado(teclado, original);
  };
  Object.defineProperty(teclado, '__saveGuardInstalado', {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return teclado;
}

module.exports = {
  instalar,
  __test: {
    vkWindows,
    normalizarEspec,
    corrigirEspecPerigosa,
    resolverCombo,
    montarScriptSeguro,
  },
};
