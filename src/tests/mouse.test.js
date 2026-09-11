'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mouse = require('../controllers/mouse');


test('modo do mouse só aceita janela/global/off', () => {
  const { normalizarModo } = mouse.__test;
  assert.strictEqual(normalizarModo('janela'), 'janela');
  assert.strictEqual(normalizarModo('GLOBAL'), 'global');
  assert.strictEqual(normalizarModo('off'), 'off');
  assert.strictEqual(normalizarModo('invalido', 'global'), 'global');
});


test('passo do mouse é limitado para evitar saltos absurdos', () => {
  const { lerPasso } = mouse.__test;
  assert.strictEqual(lerPasso('40'), 40);
  assert.strictEqual(lerPasso('1'), 5);
  assert.strictEqual(lerPasso('9999'), 500);
  assert.strictEqual(lerPasso('abc'), 40);
});


test('worker Windows contém backend em janela e global', () => {
  const fonte = mouse.__test.fonteWorker();
  assert.ok(fonte.includes('PostMessage'), 'modo janela precisa de PostMessage');
  assert.ok(fonte.includes('SetCursorPos'), 'modo global precisa de SetCursorPos');
  assert.ok(fonte.includes('mouse_event'), 'modo global precisa de clique real');
  assert.ok(fonte.includes('GetClientRect'), 'mouse deve limitar ações à área do jogo');
});


test('configurar altera modo/passo sem executar nenhuma ação', () => {
  const antes = mouse.status();
  try {
    mouse.configurar({ modo: 'off', passoPx: 77 });
    const depois = mouse.status();
    assert.strictEqual(depois.modo, 'off');
    assert.strictEqual(depois.passoPx, 77);
  } finally {
    mouse.configurar({ modo: antes.modo, passoPx: antes.passoPx, alvoExe: antes.alvoExe });
  }
});
