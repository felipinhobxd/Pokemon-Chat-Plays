/**
 * Presets de mapeamento botão -> tecla para emuladores conhecidos.
 *
 * Use no .env:
 *   EMULADOR_PRESET=vbam|mgba|desmume|retroarch
 *
 * E, se quiser ajustar UMA tecla sem sair do preset:
 *   TECLA_A=q
 *   TECLA_START=enter
 *
 * As teclas são nomes GENÉRICOS (up, down, left, right, enter, backspace,
 * space, tab, esc, shift, a-z, 0-9, f1-f12 e COMBOS como shift+f5) —
 * cada backend (Windows/Linux/macOS) traduz para o seu formato.
 *
 * ⚠️ Os presets seguem o layout PADRÃO de cada emulador. Se você mudou as
 * teclas dentro do emulador, ajuste com TECLA_*.
 *
 * v2.5 — SAVES: VBA-M/mGBA/DeSmuME usam F1-F10 para CARREGAR o slot e
 * Shift+F1-F10 para SALVAR; o preset usa o slot 5 (F5 carrega, Shift+F5
 * salva). RetroArch usa teclas simples (F2/F4 no padrão do retroarch.cfg).
 */

/**
 * Mapeamentos padrão de cada emulador.
 * @type {Record<string, Record<string, string>>}
 */
const PRESETS = {
  // VisualBoyAdvance-M (padrão do projeto)
  vbam: {
    up: 'up', down: 'down', left: 'left', right: 'right',
    a: 'x', b: 'z', l: 'a', r: 's', start: 'enter', select: 'backspace',
    salvar: 'shift+f5', carregar: 'f5',
  },
  // mGBA — layout padrão idêntico ao VBA-M
  mgba: {
    up: 'up', down: 'down', left: 'left', right: 'right',
    a: 'x', b: 'z', l: 'a', r: 's', start: 'enter', select: 'backspace',
    salvar: 'shift+f5', carregar: 'f5',
  },
  // DeSmuME — L=Q, R=W, Select=Shift (padrão do emulador)
  desmume: {
    up: 'up', down: 'down', left: 'left', right: 'right',
    a: 'x', b: 'z', l: 'q', r: 'w', start: 'enter', select: 'shift',
    salvar: 'shift+f5', carregar: 'f5',
  },
  // RetroArch — padrão do retroarch.cfg (Q/W para L/R, Shift para Select)
  retroarch: {
    up: 'up', down: 'down', left: 'left', right: 'right',
    a: 'x', b: 'z', l: 'q', r: 'w', start: 'enter', select: 'shift',
    salvar: 'f2', carregar: 'f4',
  },
};

/** Botões que podem ser remapeados via TECLA_*. */
const BOTOES_REMAPEAVEIS = ['up', 'down', 'left', 'right', 'a', 'b', 'l', 'r', 'start', 'select', 'salvar', 'carregar'];

/**
 * Normaliza o nome do preset ("VBA-M" -> "vbam", "mGBA" -> "mgba").
 * @param {string} nome
 * @returns {string}
 */
function normalizarPreset(nome) {
  return String(nome || '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Monta o mapeamento final: preset escolhido + overrides TECLA_*.
 *
 * @param {string} nomePreset - Nome do preset (ex.: 'vbam', 'DeSmuME')
 * @param {object} [overrides] - Botão -> tecla (valores vazios/nulos são ignorados)
 * @returns {{mapa: object, preset: string, presetDesconhecido: boolean, sobrescritas: number}}
 */
function montarMapeamento(nomePreset, overrides) {
  const chave = normalizarPreset(nomePreset);
  const existe = Object.prototype.hasOwnProperty.call(PRESETS, chave);
  const presetUsado = existe ? chave : 'vbam';

  const mapa = { ...PRESETS[presetUsado] };
  let sobrescritas = 0;

  for (const botao of BOTOES_REMAPEAVEIS) {
    const tecla = overrides ? overrides[botao] : undefined;
    if (typeof tecla === 'string' && tecla.trim()) {
      mapa[botao] = tecla.trim().toLowerCase();
      sobrescritas++;
    }
  }

  return {
    mapa,
    preset: presetUsado,
    presetDesconhecido: Boolean(nomePreset) && !existe,
    sobrescritas,
  };
}

module.exports = {
  PRESETS,
  BOTOES_REMAPEAVEIS,
  montarMapeamento,
  normalizarPreset,
};
