'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gamepad = require('../controllers/gamepad');

test('gamepad: modo aceita auto/on/off e aliases booleanos', () => {
  assert.strictEqual(gamepad.__test.normalizarModo('true'), 'on');
  assert.strictEqual(gamepad.__test.normalizarModo('sim'), 'on');
  assert.strictEqual(gamepad.__test.normalizarModo('false'), 'off');
  assert.strictEqual(gamepad.__test.normalizarModo('qualquer'), 'auto');
});

test('gamepad: tempos configuraveis sao limitados', () => {
  gamepad.configurar({ modo: 'off', tapMs: 1, analogMs: 99999 });
  const s = gamepad.status();
  assert.strictEqual(s.tapMs, 40);
  assert.strictEqual(s.analogMs, 10000);
});

test('gamepad: worker usa ViGEm e controle Xbox 360', () => {
  const src = gamepad.__test.fonteWorker();
  assert.match(src, /vigem_target_x360_alloc/);
  assert.match(src, /vigem_target_x360_update/);
  assert.match(src, /ViGEmClient\.dll/);
  assert.match(src, /DPAD_UP/);
  assert.match(src, /sThumbLX/);
  assert.match(src, /bLeftTrigger/);
});

test('gamepad: backend desligado falha aberto sem executar nada', () => {
  gamepad.configurar({ modo: 'off' });
  assert.strictEqual(gamepad.executar({ tipo: 'gamepad-botao', botao: 'A' }), false);
});
