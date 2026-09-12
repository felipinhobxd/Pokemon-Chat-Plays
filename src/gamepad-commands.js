'use strict';

/**
 * Parser dos comandos de gamepad virtual do chat.
 *
 * O prefixo e obrigatorio para nao colidir com os controles de teclado:
 *   pad a / pad x / pad lb / pad start
 *   pad dpad cima
 *   pad ls cima / pad rs 50 -25
 *   pad lt / pad rt 60
 *   pad soltar
 *
 * HOLD (v3.1 — mesma faixa 1ms–10s do teclado/mouse):
 *   hold pad a 250ms          hold pad x 2s
 *   hold pad rb 500ms         hold pad a 3        (número puro = segundos)
 *   hold pad rt 75 500ms      hold pad lt 100 2s  (intensidade + tempo)
 *   hold pad ls direita 250ms hold pad rs cima 500ms
 *   hold pad ls 100 0 750ms   hold pad rs -50 80 1.5s
 *   segurar pad a 1ms
 *
 * Prefixos equivalentes: pad, gamepad, controle, xbox.
 * Duracoes com sufixo usam o parser compartilhado (ms/s, decimais,
 * máximo 10s). Em trigger/analógico o número puro do fim é
 * intensidade/coordenada — a duração nesses casos exige sufixo explícito.
 */

const PREFIXOS = ['pad', 'gamepad', 'controle', 'xbox'];
const DURACAO_MAX_MS = 10000;

/** Verbos de hold (mesma lista do teclado). */
const VERBOS_HOLD = ['hold', 'segurar', 'segura', 'segure', 'segurando'];

const { parseDuracaoExplicitaMs, parseDuracaoMs } = require('./utils/duracao');

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function limitar(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseDuracao(token) {
  // v3.1: parser COMPARTILHADO — unidades explícitas apenas (número puro no
  // fim aqui é intensidade/coordenada, não duração), piso de 1ms (era 40ms)
  return parseDuracaoExplicitaMs(token);
}

function separarDuracao(resto) {
  const partes = String(resto || '').trim().split(' ').filter(Boolean);
  if (partes.length === 0) return { corpo: '', duracaoMs: null };
  const ultima = parseDuracao(partes[partes.length - 1]);
  if (ultima === null) return { corpo: partes.join(' '), duracaoMs: null };
  partes.pop();
  return { corpo: partes.join(' '), duracaoMs: ultima };
}

const BOTOES = new Map([
  ['a', 'A'], ['b', 'B'], ['x', 'X'], ['y', 'Y'],
  ['lb', 'LB'], ['l1', 'LB'], ['ombro esquerdo', 'LB'],
  ['rb', 'RB'], ['r1', 'RB'], ['ombro direito', 'RB'],
  ['start', 'START'], ['iniciar', 'START'], ['menu', 'START'],
  ['back', 'BACK'], ['select', 'BACK'], ['voltar', 'BACK'], ['view', 'BACK'],
  ['l3', 'L3'], ['ls3', 'L3'],
  ['r3', 'R3'], ['rs3', 'R3'],
]);

const DIRECOES = new Map([
  ['cima', [0, 100]], ['up', [0, 100]],
  ['baixo', [0, -100]], ['down', [0, -100]],
  ['esquerda', [-100, 0]], ['left', [-100, 0]],
  ['direita', [100, 0]], ['right', [100, 0]],
  ['cima esquerda', [-100, 100]], ['up left', [-100, 100]],
  ['cima direita', [100, 100]], ['up right', [100, 100]],
  ['baixo esquerda', [-100, -100]], ['down left', [-100, -100]],
  ['baixo direita', [100, -100]], ['down right', [100, -100]],
  ['centro', [0, 0]], ['center', [0, 0]], ['neutral', [0, 0]], ['neutro', [0, 0]],
]);

const DPAD = new Map([
  ['cima', 'DPAD_UP'], ['up', 'DPAD_UP'],
  ['baixo', 'DPAD_DOWN'], ['down', 'DPAD_DOWN'],
  ['esquerda', 'DPAD_LEFT'], ['left', 'DPAD_LEFT'],
  ['direita', 'DPAD_RIGHT'], ['right', 'DPAD_RIGHT'],
]);

function parseStick(corpo, duracaoMs) {
  let lado = null;
  let resto = '';
  for (const [prefixo, valor] of [
    ['ls ', 'L'], ['left stick ', 'L'], ['analogico esquerdo ', 'L'],
    ['rs ', 'R'], ['right stick ', 'R'], ['analogico direito ', 'R'],
  ]) {
    if (corpo.startsWith(prefixo)) {
      lado = valor;
      resto = corpo.slice(prefixo.length).trim();
      break;
    }
  }
  if (!lado) return null;

  const dir = DIRECOES.get(resto);
  if (dir) {
    return {
      tipo: 'gamepad-stick',
      stick: lado,
      x: dir[0],
      y: dir[1],
      duracaoMs,
      descricao: `pad ${lado === 'L' ? 'ls' : 'rs'} ${resto}`,
    };
  }

  const m = resto.match(/^(-?\d{1,3})\s+(-?\d{1,3})$/);
  if (!m) return null;
  const x = limitar(Number(m[1]), -100, 100);
  const y = limitar(Number(m[2]), -100, 100);
  return {
    tipo: 'gamepad-stick',
    stick: lado,
    x,
    y,
    duracaoMs,
    descricao: `pad ${lado === 'L' ? 'ls' : 'rs'} ${x} ${y}`,
  };
}

function parseTrigger(corpo, duracaoMs) {
  const m = corpo.match(/^(lt|l2|gatilho esquerdo|rt|r2|gatilho direito)(?:\s+(\d{1,3}))?$/);
  if (!m) return null;
  const esquerdo = ['lt', 'l2', 'gatilho esquerdo'].includes(m[1]);
  const valor = limitar(m[2] === undefined ? 100 : Number(m[2]), 0, 100);
  return {
    tipo: 'gamepad-trigger',
    trigger: esquerdo ? 'L' : 'R',
    valor,
    duracaoMs,
    descricao: `pad ${esquerdo ? 'lt' : 'rt'} ${valor}`,
  };
}

/**
 * Interpreta "hold pad ..." / "segurar pad ...": remove o verbo e reusa o
 * parser normal do namespace (botão/trigger/analógico), marcando hold:true.
 * O número puro no fim só é duração no caso do BOTÃO ("hold pad a 3" = 3s,
 * compatível com o teclado) — em trigger/analógico é intensidade/coordenada.
 * @param {string} t - texto normalizado
 * @returns {object|null}
 */
function parseGamepadHold(t) {
  const verbo = VERBOS_HOLD.find((v) => t.startsWith(`${v} `));
  if (!verbo) return null;

  const resto = t.slice(verbo.length).trim();
  if (!resto) return null;

  let parsed = parseGamepadCommand(resto);

  if (!parsed) {
    // fallback: último token número puro como duração (só faz sentido p/ botão)
    const m = resto.match(/^(.*\S)\s+(\d{1,7})$/);
    if (m) {
      const duracaoMs = parseDuracaoMs(m[2]); // compat: <=30 = segundos
      if (duracaoMs !== null) {
        const semNumero = parseGamepadCommand(m[1]);
        if (semNumero && semNumero.tipo === 'gamepad-botao') {
          parsed = { ...semNumero, duracaoMs: semNumero.duracaoMs ?? duracaoMs };
        }
      }
    }
  }

  if (!parsed || parsed.tipo === 'gamepad-reset') return null;
  return { ...parsed, hold: true, descricao: `hold ${parsed.descricao}` };
}

function parseGamepadCommand(texto) {
  const t = normalizar(texto);
  if (!t) return null;

  // v3.1: hold de gamepad — verbo de hold + namespace pad
  const hold = parseGamepadHold(t);
  if (hold) return hold;

  const prefixo = PREFIXOS.find((p) => t === p || t.startsWith(`${p} `));
  if (!prefixo) return null;
  const bruto = t.slice(prefixo.length).trim();
  if (!bruto) return null;

  if (['soltar', 'release', 'reset', 'resetar', 'neutro', 'neutral'].includes(bruto)) {
    return { tipo: 'gamepad-reset', descricao: 'pad soltar' };
  }

  const { corpo, duracaoMs } = separarDuracao(bruto);
  if (!corpo) return null;

  const dpadMatch = corpo.match(/^dpad\s+(.+)$/);
  if (dpadMatch) {
    const botao = DPAD.get(dpadMatch[1]);
    if (!botao) return null;
    return {
      tipo: 'gamepad-botao',
      botao,
      duracaoMs,
      descricao: `pad dpad ${dpadMatch[1]}`,
    };
  }

  const dpadCurto = DPAD.get(corpo);
  if (dpadCurto) {
    return {
      tipo: 'gamepad-botao',
      botao: dpadCurto,
      duracaoMs,
      descricao: `pad ${corpo}`,
    };
  }

  const botao = BOTOES.get(corpo);
  if (botao) {
    return { tipo: 'gamepad-botao', botao, duracaoMs, descricao: `pad ${corpo}` };
  }

  return parseStick(corpo, duracaoMs) || parseTrigger(corpo, duracaoMs);
}

module.exports = {
  parseGamepadCommand,
  parseGamepadHold,
  normalizar,
  parseDuracao,
  limitar,
  DURACAO_MAX_MS,
  VERBOS_HOLD,
};
