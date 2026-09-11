const test = require('node:test');
const assert = require('node:assert');

const controles = require('../controles');
const { parseComando, resolverControle, aliasesEfetivos } = require('../commands');
const msg = require('../messages');

function usarAliasesSomenteIngles() {
  const mapa = {
    up: ['up'],
    down: ['down'],
    left: ['left'],
    right: ['right'],
    start: ['start'],
    select: ['select'],
    salvar: ['save'],
    carregar: ['load'],
  };
  const entrada = controles.todos().map((c) => (
    mapa[c.id] ? { ...c, aliases: mapa[c.id] } : c
  ));
  const res = controles.validarLista(entrada);
  assert.strictEqual(res.ok, true, res.erros.join(' | '));
  controles.__definirLista(res.lista);
}

test.afterEach(() => controles.restaurarPadrao());

test('compatibilidade bilíngue: direções funcionam em PT-BR e EN mesmo se o arquivo salvo tiver só inglês', () => {
  usarAliasesSomenteIngles();

  const pares = [
    ['cima', 'up', 'up'],
    ['baixo', 'down', 'down'],
    ['esquerda', 'left', 'left'],
    ['direita', 'right', 'right'],
  ];
  for (const [pt, en, id] of pares) {
    assert.deepStrictEqual(parseComando(pt), { tipo: 'botao', botao: id });
    assert.deepStrictEqual(parseComando(en), { tipo: 'botao', botao: id });
  }

  assert.deepStrictEqual(parseComando('DIREITA'), { tipo: 'botao', botao: 'right' });
});

test('compatibilidade bilíngue vale também para hold/segurar', () => {
  usarAliasesSomenteIngles();

  assert.deepStrictEqual(parseComando('segurar direita 2'), {
    tipo: 'hold', botao: 'right', duracaoMs: 2000,
  });
  assert.deepStrictEqual(parseComando('hold right 2'), {
    tipo: 'hold', botao: 'right', duracaoMs: 2000,
  });
});

test('start/select/save/load têm equivalentes PT-BR/EN de compatibilidade', () => {
  usarAliasesSomenteIngles();

  assert.deepStrictEqual(parseComando('iniciar'), { tipo: 'botao', botao: 'start' });
  assert.deepStrictEqual(parseComando('start'), { tipo: 'botao', botao: 'start' });
  assert.deepStrictEqual(parseComando('selecionar'), { tipo: 'botao', botao: 'select' });
  assert.deepStrictEqual(parseComando('select'), { tipo: 'botao', botao: 'select' });
  assert.deepStrictEqual(parseComando('salvar'), { tipo: 'botao', botao: 'salvar' });
  assert.deepStrictEqual(parseComando('save'), { tipo: 'botao', botao: 'salvar' });
  assert.deepStrictEqual(parseComando('carregar'), { tipo: 'botao', botao: 'carregar' });
  assert.deepStrictEqual(parseComando('load'), { tipo: 'botao', botao: 'carregar' });
});

test('aliases configurados explicitamente continuam tendo prioridade sobre o fallback bilíngue', () => {
  const entrada = controles.todos().map((c) => (
    c.id === 'up' ? { ...c, aliases: ['up'] } : c
  ));
  entrada.push({ label: 'Especial', key: 'q', aliases: ['cima'] });
  const res = controles.validarLista(entrada);
  assert.strictEqual(res.ok, true, res.erros.join(' | '));
  controles.__definirLista(res.lista);

  assert.strictEqual(resolverControle('cima'), 'especial');
  assert.deepStrictEqual(parseComando('cima'), { tipo: 'botao', botao: 'especial' });
  assert.deepStrictEqual(parseComando('up'), { tipo: 'botao', botao: 'up' });
});

test('fallback não reativa controle embutido desativado', () => {
  const entrada = controles.todos().map((c) => (
    c.id === 'up' ? { ...c, enabled: false, aliases: ['up'] } : c
  ));
  const res = controles.validarLista(entrada);
  assert.strictEqual(res.ok, true, res.erros.join(' | '));
  controles.__definirLista(res.lista);

  assert.strictEqual(parseComando('cima'), null);
  assert.strictEqual(parseComando('up'), null);
});

test('!comandos mostra os aliases PT-BR/EN que realmente funcionam', () => {
  usarAliasesSomenteIngles();

  const texto = msg.msgComandos().join('\n').toLowerCase();
  for (const palavra of ['cima', 'up', 'baixo', 'down', 'esquerda', 'left', 'direita', 'right']) {
    assert.ok(texto.includes(palavra), `!comandos deveria mostrar ${palavra}`);
  }
  assert.ok(texto.includes('controles do jogo não usam !'));
  assert.ok(texto.includes('!commands'));

  const up = controles.ativos().find((c) => c.id === 'up');
  assert.deepStrictEqual(aliasesEfetivos(up), ['up', 'cima']);
});

test('comandos administrativos principais aceitam português e inglês', () => {
  assert.deepStrictEqual(parseComando('!comandos'), { tipo: 'info', comando: 'comandos', bruto: 'comandos' });
  assert.deepStrictEqual(parseComando('!commands'), { tipo: 'info', comando: 'comandos', bruto: 'commands' });
  assert.deepStrictEqual(parseComando('!ajuda'), { tipo: 'info', comando: 'ajuda', bruto: 'ajuda' });
  assert.deepStrictEqual(parseComando('!help'), { tipo: 'info', comando: 'ajuda', bruto: 'help' });
  assert.deepStrictEqual(parseComando('!democracy'), { tipo: 'info', comando: 'modo', bruto: 'democracia' });
  assert.deepStrictEqual(parseComando('!anarchy'), { tipo: 'info', comando: 'modo', bruto: 'anarquia' });
});
