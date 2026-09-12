'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseGamepadCommand, parseDuracao } = require('../gamepad-commands');

test('gamepad: botoes Xbox basicos e aliases', () => {
  assert.deepStrictEqual(parseGamepadCommand('pad a').botao, 'A');
  assert.deepStrictEqual(parseGamepadCommand('xbox x').botao, 'X');
  assert.deepStrictEqual(parseGamepadCommand('controle l1').botao, 'LB');
  assert.deepStrictEqual(parseGamepadCommand('gamepad r1').botao, 'RB');
  assert.deepStrictEqual(parseGamepadCommand('pad select').botao, 'BACK');
});

test('gamepad: dpad curto e explicito aceitam PT/EN', () => {
  assert.deepStrictEqual(parseGamepadCommand('pad cima').botao, 'DPAD_UP');
  assert.deepStrictEqual(parseGamepadCommand('pad dpad down').botao, 'DPAD_DOWN');
  assert.deepStrictEqual(parseGamepadCommand('xbox dpad esquerda').botao, 'DPAD_LEFT');
});

test('gamepad: analogico esquerdo/direito por direcao', () => {
  assert.deepStrictEqual(
    parseGamepadCommand('pad ls cima'),
    { tipo: 'gamepad-stick', stick: 'L', x: 0, y: 100, duracaoMs: null, descricao: 'pad ls cima' }
  );
  const r = parseGamepadCommand('controle analógico direito baixo direita');
  assert.strictEqual(r.tipo, 'gamepad-stick');
  assert.strictEqual(r.stick, 'R');
  assert.strictEqual(r.x, 100);
  assert.strictEqual(r.y, -100);
});

test('gamepad: analogico aceita coordenadas -100..100 e limita excesso', () => {
  const r = parseGamepadCommand('pad rs 140 -250');
  assert.strictEqual(r.x, 100);
  assert.strictEqual(r.y, -100);
});

test('gamepad: gatilhos aceitam intensidade percentual', () => {
  assert.deepStrictEqual(parseGamepadCommand('pad lt').valor, 100);
  assert.deepStrictEqual(parseGamepadCommand('pad r2 37').valor, 37);
  assert.deepStrictEqual(parseGamepadCommand('pad gatilho esquerdo 150').valor, 100);
});

test('gamepad: duracao opcional usa ms/s e limita em 10s', () => {
  assert.strictEqual(parseGamepadCommand('pad a 500ms').duracaoMs, 500);
  assert.strictEqual(parseGamepadCommand('pad ls direita 2s').duracaoMs, 2000);
  assert.strictEqual(parseGamepadCommand('pad rt 60 99s').duracaoMs, 10000);
  assert.strictEqual(parseDuracao('10'), null);
});

test('gamepad: reset/soltar neutraliza tudo', () => {
  assert.strictEqual(parseGamepadCommand('pad soltar').tipo, 'gamepad-reset');
  assert.strictEqual(parseGamepadCommand('xbox reset').tipo, 'gamepad-reset');
});

test('gamepad: texto normal e comandos invalidos nao viram acao', () => {
  assert.strictEqual(parseGamepadCommand('a'), null);
  assert.strictEqual(parseGamepadCommand('pad'), null);
  assert.strictEqual(parseGamepadCommand('pad turbo'), null);
  assert.strictEqual(parseGamepadCommand('pad ls talvez'), null);
});
