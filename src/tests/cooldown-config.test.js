'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analisarCooldownsPorComando, parseDuracaoCooldown } = require('../utils/cooldown-config');

test('cooldowns por comando aceitam ms, segundos, ações e grupos', () => {
  const r = analisarCooldownsPorComando('dialogo=10s, mouse-click=2s; a=500ms, hold=3s, pad:a=750');
  assert.deepEqual({ ...r.mapa }, {
    dialogo: 10000,
    'mouse-click': 2000,
    a: 500,
    hold: 3000,
    'pad:a': 750,
  });
  assert.deepEqual(r.erros, []);
});

test('configuração inválida é rejeitada com erro útil', () => {
  const r = analisarCooldownsPorComando('dialogo=abc, mouse click=2s, a=1s, a=2s');
  assert.ok(r.erros.length >= 3);
  assert.match(r.erros.join(' | '), /tempo inválido/i);
  assert.match(r.erros.join(' | '), /comando .* inválido/i);
  assert.match(r.erros.join(' | '), /repetido/i);
});

test('duração específica limita em 10 minutos e aceita zero', () => {
  assert.equal(parseDuracaoCooldown('0'), 0);
  assert.equal(parseDuracaoCooldown('1.5s'), 1500);
  assert.equal(parseDuracaoCooldown('600000ms'), 600000);
  assert.equal(parseDuracaoCooldown('601s'), null);
});
