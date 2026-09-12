'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CooldownManager } = require('../utils/cooldown');

function comRelogio(fn) {
  const original = Date.now;
  let agora = 100000;
  Date.now = () => agora;
  try { return fn({ avancar(ms) { agora += ms; } }); }
  finally { Date.now = original; }
}

test('cooldown específico bloqueia repetir a ação mas não outras após o cooldown base', () => {
  comRelogio(({ avancar }) => {
    const c = new CooldownManager({
      cooldownMs: 1000,
      cooldownGlobalMs: 0,
      cooldownsPorComando: { dialogo: 10000 },
    });
    assert.equal(c.podeExecutar('ana', 'dialogo').permitido, true);
    c.registrarExecucao('ana', 'dialogo');
    avancar(1001);
    assert.equal(c.podeExecutar('ana', 'up').permitido, true);
    assert.equal(c.podeExecutar('ana', 'dialogo').permitido, false);
    avancar(9000);
    assert.equal(c.podeExecutar('ana', 'dialogo').permitido, true);
  });
});

test('grupos e regra exata convivem: mouse bloqueia família e click pode durar mais', () => {
  comRelogio(({ avancar }) => {
    const c = new CooldownManager({
      cooldownMs: 0,
      cooldownGlobalMs: 0,
      cooldownsPorComando: { mouse: 2000, 'mouse-click': 5000 },
    });
    c.registrarExecucao('bob', 'mouse-click');
    avancar(1999);
    assert.equal(c.podeExecutar('bob', 'mouse-mover').permitido, false);
    avancar(1);
    assert.equal(c.podeExecutar('bob', 'mouse-mover').permitido, true);
    assert.equal(c.podeExecutar('bob', 'mouse-click').permitido, false);
  });
});

test('hold:up usa fallback hold quando não existe regra exata', () => {
  comRelogio(({ avancar }) => {
    const c = new CooldownManager({ cooldownMs: 0, cooldownGlobalMs: 0, cooldownsPorComando: { hold: 3000 } });
    c.registrarExecucao('c', 'hold:up');
    avancar(2999);
    assert.equal(c.podeExecutar('c', 'hold:up').permitido, false);
    avancar(1);
    assert.equal(c.podeExecutar('c', 'hold:up').permitido, true);
  });
});
