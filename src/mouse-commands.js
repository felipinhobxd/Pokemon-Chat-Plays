'use strict';

/**
 * Parser dos comandos de mouse do chat.
 *
 * Todos os comandos de gameplay continuam SEM prefixo !:
 *   mouse cima / mouse up
 *   mouse baixo / mouse down
 *   mouse esquerda / mouse left
 *   mouse direita / mouse right
 *   mouse 50 50        -> 50% X, 50% Y dentro da área do jogo
 *   clique / click
 *   clique direito / right click
 *
 * HOLD real de botão (v3.1 — down ... up, SEM cliques repetidos):
 *   hold clique [tempo]            hold click 1s
 *   hold clique esquerdo 250ms     segurar botao esquerdo 250ms
 *   hold clique direito 2.5s       segurar clique direito 75ms
 *   hold mouse left 500ms          hold mouse right 3s
 *   segurar mouse esquerdo 500ms   segurar mouse direito 3s
 *
 * Tempo usa o parser compartilhado (1ms–10s, segundos decimais,
 * número puro compatível com o teclado: "3" = 3s).
 */

const { parseDuracaoMs } = require('./utils/duracao');

function normalizar(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const DIRECOES = Object.freeze({
  cima: { dx: 0, dy: -1, nome: 'cima' },
  up: { dx: 0, dy: -1, nome: 'cima' },
  baixo: { dx: 0, dy: 1, nome: 'baixo' },
  down: { dx: 0, dy: 1, nome: 'baixo' },
  esquerda: { dx: -1, dy: 0, nome: 'esquerda' },
  left: { dx: -1, dy: 0, nome: 'esquerda' },
  direita: { dx: 1, dy: 0, nome: 'direita' },
  right: { dx: 1, dy: 0, nome: 'direita' },
});

const CLIQUE_ESQUERDO = new Set([
  'clique', 'click', 'clicar', 'clique esquerdo', 'click esquerdo',
  'left click', 'mouse clique', 'mouse click',
]);

const CLIQUE_DIREITO = new Set([
  'clique direito', 'click direito', 'right click', 'rightclick',
  'mouse clique direito', 'mouse click direito',
]);

/** Verbos de hold (mesma lista do registro/teclado). */
const VERBOS_HOLD = ['hold', 'segurar', 'segura', 'segure', 'segurando'];

/** Frase -> botão segurável. No máx. 3 palavras ("mouse clique direito"). */
const ALVOS_HOLD = new Map([
  ['clique', 'left'],
  ['click', 'left'],
  ['clicar', 'left'],
  ['clique esquerdo', 'left'],
  ['click esquerdo', 'left'],
  ['left click', 'left'],
  ['mouse clique', 'left'],
  ['mouse click', 'left'],
  ['botao esquerdo', 'left'],
  ['mouse esquerdo', 'left'],
  ['mouse left', 'left'],
  ['botao', 'left'],
  ['clique direito', 'right'],
  ['click direito', 'right'],
  ['right click', 'right'],
  ['rightclick', 'right'],
  ['mouse clique direito', 'right'],
  ['mouse click direito', 'right'],
  ['botao direito', 'right'],
  ['mouse direito', 'right'],
  ['mouse right', 'right'],
]);

/**
 * Interpreta "hold <alvo-do-mouse> [tempo]".
 * @param {string} t - texto já normalizado
 * @returns {object|null}
 */
function parseHoldMouse(t) {
  const verbo = VERBOS_HOLD.find((v) => t === v || t.startsWith(`${v} `));
  if (!verbo) return null;

  const resto = t.slice(verbo.length).trim();
  if (!resto) return null;

  const tokens = resto.split(' ');
  // casa o MAIOR prefixo que é um alvo conhecido (3..1 palavras)
  for (let n = Math.min(3, tokens.length); n >= 1; n--) {
    const frase = tokens.slice(0, n).join(' ');
    const botao = ALVOS_HOLD.get(frase);
    if (!botao) continue;

    const sobra = tokens.slice(n).join(' ').trim();
    if (sobra && parseDuracaoMs(sobra) === null) return null; // lixo depois do alvo
    const duracaoMs = sobra ? parseDuracaoMs(sobra) : null;

    const rotulo = botao === 'right' ? 'clique direito' : 'clique';
    return {
      tipo: 'mouse-hold',
      botao,
      duracaoMs,
      descricao: `hold ${rotulo}`,
    };
  }
  return null;
}

/**
 * @param {string} texto
 * @returns {object|null}
 */
function parseMouseCommand(texto) {
  const t = normalizar(texto);
  if (!t || t.length > 100) return null;

  // v3.1: hold real de botão (antes dos taps, para não cair no hold do teclado)
  const hold = parseHoldMouse(t);
  if (hold) return hold;

  if (CLIQUE_DIREITO.has(t)) {
    return { tipo: 'mouse-click', botao: 'right', descricao: 'clique direito' };
  }
  if (CLIQUE_ESQUERDO.has(t)) {
    return { tipo: 'mouse-click', botao: 'left', descricao: 'clique' };
  }

  if (!t.startsWith('mouse ')) return null;
  const resto = t.slice(6).trim();

  if (DIRECOES[resto]) {
    const d = DIRECOES[resto];
    return {
      tipo: 'mouse-mover',
      dx: d.dx,
      dy: d.dy,
      descricao: `mouse ${d.nome}`,
    };
  }

  if (resto === 'centro' || resto === 'center' || resto === 'centralizar') {
    return { tipo: 'mouse-pos', xPct: 50, yPct: 50, descricao: 'mouse 50 50' };
  }

  // Coordenadas em porcentagem da área do jogo: "mouse 25 80".
  // Percentual torna o comando consistente em qualquer resolução e permite
  // limitar o cursor ao jogo sem depender de coordenadas de tela do streamer.
  const m = resto.match(/^(\d{1,3})\s*[ ,]\s*(\d{1,3})%?$/);
  if (m) {
    const xPct = Number(m[1]);
    const yPct = Number(m[2]);
    if (xPct >= 0 && xPct <= 100 && yPct >= 0 && yPct <= 100) {
      return {
        tipo: 'mouse-pos',
        xPct,
        yPct,
        descricao: `mouse ${xPct} ${yPct}`,
      };
    }
  }

  return null;
}

module.exports = {
  parseMouseCommand,
  parseHoldMouse,
  normalizar,
  DIRECOES,
  ALVOS_HOLD,
};
