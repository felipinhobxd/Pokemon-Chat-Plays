'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseMouseCommand } = require('../mouse-commands');


test('mouse aceita direções PT-BR e EN', () => {
  const casos = [
    ['mouse cima', 0, -1],
    ['mouse up', 0, -1],
    ['mouse baixo', 0, 1],
    ['mouse down', 0, 1],
    ['mouse esquerda', -1, 0],
    ['mouse left', -1, 0],
    ['mouse direita', 1, 0],
    ['mouse right', 1, 0],
  ];
  for (const [entrada, dx, dy] of casos) {
    const p = parseMouseCommand(entrada);
    assert.ok(p, entrada);
    assert.strictEqual(p.tipo, 'mouse-mover');
    assert.strictEqual(p.dx, dx);
    assert.strictEqual(p.dy, dy);
  }
});


test('clique esquerdo e direito têm aliases PT/EN', () => {
  for (const entrada of ['clique', 'click', 'clicar', 'clique esquerdo', 'left click', 'mouse clique']) {
    assert.deepStrictEqual(parseMouseCommand(entrada).botao, 'left', entrada);
  }
  for (const entrada of ['clique direito', 'right click', 'rightclick', 'mouse clique direito']) {
    assert.deepStrictEqual(parseMouseCommand(entrada).botao, 'right', entrada);
  }
});


test('mouse 50 50 usa porcentagem da área do jogo', () => {
  assert.deepStrictEqual(
    parseMouseCommand('mouse 50 50'),
    { tipo: 'mouse-pos', xPct: 50, yPct: 50, descricao: 'mouse 50 50' }
  );
  assert.strictEqual(parseMouseCommand('mouse 0 100').xPct, 0);
  assert.strictEqual(parseMouseCommand('mouse 0 100').yPct, 100);
  assert.strictEqual(parseMouseCommand('mouse 101 50'), null);
  assert.strictEqual(parseMouseCommand('mouse 50 999'), null);
});


test('mouse centro centraliza e normaliza acentos/maiúsculas', () => {
  const p = parseMouseCommand('  MOUSE CENTRO  ');
  assert.strictEqual(p.tipo, 'mouse-pos');
  assert.strictEqual(p.xPct, 50);
  assert.strictEqual(p.yPct, 50);
});


test('texto normal não vira comando de mouse', () => {
  for (const entrada of ['mouse legal', 'meu mouse quebrou', 'clicou?', '', null, 'mouse 10']) {
    assert.strictEqual(parseMouseCommand(entrada), null, String(entrada));
  }
});
