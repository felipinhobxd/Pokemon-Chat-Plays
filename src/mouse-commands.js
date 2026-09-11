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
 */

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

/**
 * @param {string} texto
 * @returns {object|null}
 */
function parseMouseCommand(texto) {
  const t = normalizar(texto);
  if (!t || t.length > 100) return null;

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
  normalizar,
  DIRECOES,
};
