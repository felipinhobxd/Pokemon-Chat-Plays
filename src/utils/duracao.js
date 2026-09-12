'use strict';

/**
 * Parser de duração COMPARTILHADO de todos os HOLDs do ChatPlays
 * (teclado, mouse e gamepad).
 *
 * Faixa suportada: 1 ms até 10000 ms (10 s), sempre em milissegundos
 * INTEIROS. Não existe piso artificial de 100 ms ou 1 s — "hold w 1ms"
 * deve chegar ao backend como 1 (a granularidade física real do Windows
 * é outra história; aqui garantimos apenas a resolução do parser).
 *
 * Formas aceitas:
 *   "1ms" "37ms" "999ms"      → explícito em ms
 *   "1s" "1.5s" "10s"         → segundos (decimais: 0.001s = 1ms)
 *   "1seg" "2segs" "3segundo(s)" → variantes PT que o teclado aceitava
 *   "3"                        → número puro (compatibilidade do teclado):
 *                                <= 30 → SEGUNDOS ("hold cima 3" = 3 s)
 *                                >  30 → milissegundos ("hold cima 500" = 500 ms)
 *
 * Acima do máximo o valor é limitado para 10000; abaixo do mínimo (0) para 1.
 * Um token que não casa com nada devolve null (quem chama decide o default).
 */

const MIN_MS = 1;
const MAX_MS = 10000;

/** Suportes de unidade explícitos (minúsculos). */
const SUFIXO_MS = 'ms';
const SUFIXOS_S = ['s', 'seg', 'segs', 'segundo', 'segundos'];

/** Limita um valor em ms para a faixa global [1, 10000]. */
function limitarMs(ms) {
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_MS, Math.max(MIN_MS, n));
}

/**
 * Parse de UM token de duração.
 * @param {string} token - "1ms", "1.5s", "3", "0.001s"...
 * @param {{compatBare?: boolean}} [opcoes] - compatBare (padrão true) aceita
 *   número puro com a semântica antiga do teclado (<=30 segundos).
 * @returns {number|null} ms inteiros já limitados, ou null se inválido.
 */
function parseDuracaoMs(token, opcoes = {}) {
  const compatBare = opcoes.compatBare !== false;
  const t = String(token || '').toLowerCase().trim();
  if (!t) return null;

  let m = t.match(/^(\d+(?:\.\d+)?)(ms)$/);
  if (m) return limitarMs(Number(m[1]));

  m = t.match(/^(\d+(?:\.\d+)?)(seg|segs|segundo|segundos|s)$/);
  if (m) return limitarMs(Number(m[1]) * 1000);

  // número puro (sem unidade)
  if (/^\d{1,7}$/.test(t)) {
    if (!compatBare) return null;
    const n = Number(t);
    // compatibilidade teclado: número pequeno = segundos
    return limitarMs(n <= 30 ? n * 1000 : n);
  }

  return null;
}

/**
 * Parse restrito a unidades EXPLÍCITAS ("250ms", "1.5s") — usado onde um
 * número puro no fim é ambíguo com outros argumentos (ex.: "pad ls 100 0",
 * em que os números são COORDENADAS do analógico, não duração).
 * @param {string} token
 * @returns {number|null}
 */
function parseDuracaoExplicitaMs(token) {
  return parseDuracaoMs(token, { compatBare: false });
}

/**
 * Duração efetiva de um hold: usa a duração pedida ou o padrão do config,
 * respeitando o teto configurado (HOLD_MAX_MS) e o piso global de 1 ms.
 * @param {number|null} duracaoMs - duração pedida (pode ser null)
 * @param {{holdPadraoMs: number, holdMaxMs: number}} geral - config.geral
 * @returns {number}
 */
function duracaoEfetiva(duracaoMs, geral = {}) {
  const pedido = Number(duracaoMs);
  const padrao = Number.isFinite(Number(geral.holdPadraoMs)) ? Number(geral.holdPadraoMs) : 1000;
  const teto = Number.isFinite(Number(geral.holdMaxMs)) ? Number(geral.holdMaxMs) : MAX_MS;
  const base = Number.isFinite(pedido) && pedido !== 0 ? Math.round(pedido) : padrao;
  return Math.max(MIN_MS, Math.min(base, Math.min(teto, MAX_MS)));
}

module.exports = {
  MIN_MS,
  MAX_MS,
  limitarMs,
  parseDuracaoMs,
  parseDuracaoExplicitaMs,
  duracaoEfetiva,
};
