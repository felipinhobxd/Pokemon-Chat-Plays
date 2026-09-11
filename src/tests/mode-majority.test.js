/**
 * Regressões da votação de modo do chat.
 *
 * !democracia / !anarquia não podem mais trocar o modo por decisão de
 * uma única pessoa: cada usuário tem um voto e é necessária maioria real
 * entre os votos recentes, com pelo menos 2 votantes.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const votacao = require('../utils/votacao');

function preparar() {
  votacao.resetar();
  votacao.configurar({ intervaloMs: 10000, trocaMinMs: 0 });
}

afterEach(() => votacao.resetar());

test('um único !democracia nunca ativa democracia', () => {
  preparar();
  const r = votacao.votarModo('democracia', 'twitch:alice');
  assert.strictEqual(r.mudou, false);
  assert.strictEqual(r.votos, 1);
  assert.strictEqual(r.necessario, 2);
  assert.strictEqual(votacao.modoAtual(), 'anarquia');
});

test('duas pessoas concordando formam a maioria mínima e ativam democracia', () => {
  preparar();
  votacao.votarModo('democracia', 'twitch:alice');
  const r = votacao.votarModo('democracia', 'twitch:bob');
  assert.strictEqual(r.mudou, true);
  assert.strictEqual(r.votos, 2);
  assert.strictEqual(r.totalVotantes, 2);
  assert.strictEqual(votacao.modoAtual(), 'democracia');
});

test('empate não troca modo; terceiro voto decide por maioria', () => {
  preparar();
  votacao.votarModo('democracia', 'twitch:alice');
  const empate = votacao.votarModo('anarquia', 'twitch:bob');
  assert.strictEqual(empate.mudou, false);
  assert.strictEqual(votacao.modoAtual(), 'anarquia');

  const maioria = votacao.votarModo('democracia', 'youtube:carol');
  assert.strictEqual(maioria.mudou, true);
  assert.strictEqual(maioria.votos, 2);
  assert.strictEqual(maioria.necessario, 2);
  assert.strictEqual(maioria.totalVotantes, 3);
  assert.strictEqual(votacao.modoAtual(), 'democracia');
});

test('cada usuário tem só um voto e pode trocar de lado', () => {
  preparar();
  votacao.votarModo('democracia', 'twitch:alice');
  const trocado = votacao.votarModo('anarquia', 'twitch:alice');
  assert.strictEqual(trocado.totalVotantes, 1);
  assert.strictEqual(trocado.votos, 1);
  assert.strictEqual(votacao.statusModo().democracia, 0);
  assert.strictEqual(votacao.statusModo().anarquia, 1);
  assert.strictEqual(votacao.modoAtual(), 'anarquia');
});

test('sair da democracia para anarquia também exige maioria', () => {
  preparar();
  votacao.definirModo('democracia', 'tecla streamer');

  const r1 = votacao.votarModo('anarquia', 'twitch:alice');
  assert.strictEqual(r1.mudou, false);
  assert.strictEqual(votacao.modoAtual(), 'democracia');

  const r2 = votacao.votarModo('anarquia', 'youtube:bob');
  assert.strictEqual(r2.mudou, true);
  assert.strictEqual(votacao.modoAtual(), 'anarquia');
});

test('troca direta do streamer limpa votos de modo antigos', () => {
  preparar();
  votacao.votarModo('democracia', 'twitch:alice');
  assert.strictEqual(votacao.statusModo().totalVotantes, 1);
  votacao.definirModo('democracia', 'tecla streamer');
  assert.strictEqual(votacao.statusModo().totalVotantes, 0);
});
