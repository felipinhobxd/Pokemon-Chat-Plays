/**
 * Testes do comparador de versões do verificador de atualização
 * (src/utils/atualizacao.js). A consulta de rede NÃO é testada aqui
 * (CI sem garantia de internet) — só a lógica pura de comparação.
 */

const test = require('node:test');
const assert = require('node:assert');
const { compararVersoes, normalizarVersao } = require('../utils/atualizacao');

test('normaliza tags com e sem prefixo "v"', () => {
  assert.strictEqual(normalizarVersao('v2.3.0'), '2.3.0');
  assert.strictEqual(normalizarVersao('2.3.0'), '2.3.0');
  assert.strictEqual(normalizarVersao(' V2.3.0 '), '2.3.0');
  assert.strictEqual(normalizarVersao(''), '');
  assert.strictEqual(normalizarVersao(null), '');
  assert.strictEqual(normalizarVersao(undefined), '');
});

test('compara versões corretamente (maior/menor/igual)', () => {
  assert.ok(compararVersoes('2.3.0', '2.2.9') > 0, '2.3.0 > 2.2.9');
  assert.ok(compararVersoes('2.3.0', '2.3.0') === 0, '2.3.0 = 2.3.0');
  assert.ok(compararVersoes('2.2.9', '2.3.0') < 0, '2.2.9 < 2.3.0');
  assert.ok(compararVersoes('v2.3.0', 'v2.2.9') > 0, 'prefixo v é ignorado');
  assert.ok(compararVersoes('2.10.0', '2.9.0') > 0, '10 > 9 (numérico, não texto!)');
  assert.ok(compararVersoes('3.0.0', '2.99.99') > 0, 'major domina');
});

test('versões incompletas ganham zeros (2.3 = 2.3.0)', () => {
  assert.ok(compararVersoes('2.3', '2.3.0') === 0);
  assert.ok(compararVersoes('2.3', '2.3.1') < 0);
});

test('lixo não quebra o comparador', () => {
  assert.ok(compararVersoes('abc', '2.3.0') < 0, '"abc" vira 0.0.0');
  assert.ok(compararVersoes('', '') === 0);
  assert.ok(compararVersoes('2.3.0.1', '2.3.0') > 0, '4º campo conta');
});
