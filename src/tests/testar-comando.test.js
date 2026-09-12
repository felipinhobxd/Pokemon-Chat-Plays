'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const controles = require('../controles');
const { testarComando } = require('../testar-comando');

test.beforeEach(() => controles.restaurarPadrao());

test('tester reconhece teclado clássico sem executar nada', () => {
  const r = testarComando('direita');
  assert.equal(r.ok, true);
  assert.equal(r.reconhecido, true);
  assert.equal(r.categoria, 'teclado');
  assert.equal(r.executaria, true);
  assert.equal(r.parsed.botao, 'right');
});

test('tester usa aliases ainda não salvos do wizard e restaura o registro depois', () => {
  const antes = controles.todos().map((c) => c.id);
  const lista = controles.todos();
  lista.push({
    id: 'pular_teste', label: 'Pular Teste', icone: '🎮', key: 'space',
    aliases: ['voaragora'], holdable: true, builtin: false, enabled: true,
  });
  const r = testarComando('voaragora', lista);
  assert.equal(r.ok, true);
  assert.equal(r.parsed.botao, 'pular teste');
  assert.equal(r.detalhes.includes('Tecla: space'), true);
  assert.deepEqual(controles.todos().map((c) => c.id), antes);
});

test('tester cobre mouse, gamepad, diálogo e comando administrativo', () => {
  assert.equal(testarComando('mouse esquerda').categoria, 'mouse');
  assert.equal(testarComando('pad a').categoria, 'gamepad');
  assert.equal(testarComando('dialogo').categoria, 'macro');
  const info = testarComando('!comandos');
  assert.equal(info.categoria, 'chat');
  assert.equal(info.executaria, false);
});

test('tester explica comando desconhecido e entrada vazia', () => {
  const desconhecido = testarComando('isso definitivamente nao e comando');
  assert.equal(desconhecido.ok, true);
  assert.equal(desconhecido.reconhecido, false);
  const vazio = testarComando('   ');
  assert.equal(vazio.ok, false);
  assert.match(vazio.erros[0], /Digite um comando/);
});

test('lista de controles inválida é recusada sem alterar registro atual', () => {
  const antes = controles.todos();
  const r = testarComando('jump', [
    { id: 'a1', label: 'A1', key: 'space', aliases: ['jump'], enabled: true, holdable: true },
    { id: 'a2', label: 'A2', key: 'enter', aliases: ['jump'], enabled: true, holdable: true },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((e) => /jump/i.test(e)));
  assert.deepEqual(controles.todos(), antes);
});

test('tester descreve sequência com ordem explícita sem executar nada', () => {
  const r = testarComando('a+direita+baixo');
  assert.equal(r.reconhecido, true);
  assert.equal(r.categoria, 'teclado');
  assert.equal(r.executaria, true);
  assert.match(r.resumo, /a → right → down/);
  assert.ok(r.detalhes.some((d) => /→ tecla /.test(d)), 'detalhes devem mostrar a tecla de cada item');
});

test('tester explica que sequência não roda em democracia (1 voto por pessoa)', () => {
  const r = testarComando('a+direita+baixo', null, { democracia: true });
  assert.equal(r.reconhecido, true);
  assert.equal(r.executaria, false);
  assert.match(r.resumo, /Democracia/);
});

test('tester descreve hold de olhar/camera com duração normalizada e bloqueios', () => {
  const ok = testarComando('hold olhar cima 2s', null, { modoMouse: 'global' });
  assert.equal(ok.reconhecido, true);
  assert.equal(ok.categoria, 'mouse');
  assert.equal(ok.executaria, true);
  assert.match(ok.resumo, /cima por 2000ms/);

  const off = testarComando('hold olhar cima 2s', null, { modoMouse: 'off' });
  assert.equal(off.executaria, false);
  assert.match(off.resumo, /desativado/i);

  const demo = testarComando('hold olhar cima 2s', null, { modoMouse: 'global', democracia: true });
  assert.equal(demo.executaria, false);
  assert.match(demo.resumo, /Democracia/);
});
