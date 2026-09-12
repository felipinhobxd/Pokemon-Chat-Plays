/**
 * Testes do parser de comandos (src/commands.js).
 * Roda com: npm test  (usa o node:test nativo — zero dependências)
 */

const test = require('node:test');
const assert = require('node:assert');
const { parseComando, removerAcentos } = require('../commands');
const controles = require('../controles');

// ---------------------------------------------------------------------------
// Botões simples
// ---------------------------------------------------------------------------

test('botões simples em inglês', () => {
  const esperados = { a: 'a', b: 'b', l: 'l', r: 'r', start: 'start', select: 'select', up: 'up', down: 'down', left: 'left', right: 'right' };
  for (const [cmd, esperado] of Object.entries(esperados)) {
    const parsed = parseComando(cmd);
    assert.strictEqual(parsed.tipo, 'botao', `"${cmd}" deveria ser botão`);
    assert.strictEqual(parsed.botao, esperado, `"${cmd}" -> ${esperado}`);
  }
});

test('botões simples em português', () => {
  const casos = [
    ['cima', 'up'],
    ['baixo', 'down'],
    ['esquerda', 'left'],
    ['direita', 'right'],
    ['seleciona', 'select'],
    ['selecionar', 'select'],
    ['sobe', 'up'],
    ['desce', 'down'],
    ['esq', 'left'],
    ['dir', 'right'],
  ];
  for (const [entrada, esperado] of casos) {
    const parsed = parseComando(entrada);
    assert.strictEqual(parsed.tipo, 'botao', `"${entrada}" deveria ser botão`);
    assert.strictEqual(parsed.botao, esperado, `"${entrada}" -> ${esperado}`);
  }
});

test('sequência com + executa aliases na ordem e aceita espaços/PT-EN', () => {
  assert.deepStrictEqual(parseComando('a+direita+baixo'), {
    tipo: 'sequencia',
    botoes: ['a', 'right', 'down'],
  });
  assert.deepStrictEqual(parseComando('  A + right + baixo  '), {
    tipo: 'sequencia',
    botoes: ['a', 'right', 'down'],
  });
  assert.deepStrictEqual(parseComando('cima+baixo+cima'), {
    tipo: 'sequencia',
    botoes: ['up', 'down', 'up'],
  });
});

test('sequência é atômica no parser: vazio, alias inválido ou >10 itens são rejeitados', () => {
  assert.strictEqual(parseComando('a++direita'), null);
  assert.strictEqual(parseComando('a+pizza+baixo'), null);
  assert.strictEqual(parseComando(Array(11).fill('a').join('+')), null);
});

test('alias exato contendo "+" tem prioridade sobre o parser de sequência', () => {
  // A validação oficial REJEITA "+" em palavras de chat (validarLista), mas o
  // parser mantém a defesa: o texto INTEIRO é tentado ANTES da sequência.
  // Aqui o alias entra pela via de teste (__definirLista) para provar a ordem.
  controles.__definirLista([
    { id: 'supercombo', label: 'Super Combo', icone: '⭐', key: 'ctrl', aliases: ['super+combo'], holdable: false, builtin: false, enabled: true },
    { id: 'cima', label: 'Cima', icone: '⬆', key: 'up', aliases: ['cima'], holdable: true, builtin: false, enabled: true },
  ]);
  try {
    // o texto INTEIRO casa com o alias configurado: é UM botão, não sequência
    assert.deepStrictEqual(parseComando('super+combo'), { tipo: 'botao', botao: 'supercombo' });
    // texto normal com "+" que não é alias: continua não-comando (item inválido)
    assert.strictEqual(parseComando('pizza+combo'), null);
  } finally {
    controles.restaurarPadrao();
  }
});

test('mensagens normais não são comandos', () => {
  const naoComandos = [
    'oi pessoal tudo bem?',
    'kkkkkk',
    'vamo lá galera',
    'qual o melhor starter?',
    'charizard é top',
    '',
    null,
    undefined,
    '  ',
  ];
  for (const entrada of naoComandos) {
    assert.strictEqual(parseComando(entrada), null, `"${entrada}" não deveria ser comando`);
  }
});

test('maiúsculas e espaços extras funcionam', () => {
  assert.strictEqual(parseComando('  CIMA  ').botao, 'up');
  assert.strictEqual(parseComando('Up').botao, 'up');
  assert.strictEqual(parseComando('  A ').botao, 'a');
});

test('acentos são removidos', () => {
  assert.strictEqual(removerAcentos('olá çima àà'), 'ola cima aa');
  // "olá" com acento é tratado como saudação
  assert.strictEqual(parseComando('olá').tipo, 'ola');
});

// ---------------------------------------------------------------------------
// Comandos de hold (segurar)
// ---------------------------------------------------------------------------

test('hold com verbo separado (EN e PT)', () => {
  const casos = [
    ['hold up', 'up'],
    ['hold cima', 'up'],
    ['hold down', 'down'],
    ['hold baixo', 'down'],
    ['segurar esquerda', 'left'],
    ['segura direita', 'right'],
    ['segure a', 'a'],
    ['hold start', 'start'],
    ['hold select', 'select'],
    ['hold b', 'b'],
  ];
  for (const [entrada, esperado] of casos) {
    const parsed = parseComando(entrada);
    assert.ok(parsed, `"${entrada}" deveria parsear`);
    assert.strictEqual(parsed.tipo, 'hold', `"${entrada}" deveria ser hold`);
    assert.strictEqual(parsed.botao, esperado, `"${entrada}" -> ${esperado}`);
  }
});

test('hold com verbo colado (holdcima, holdup)', () => {
  assert.strictEqual(parseComando('holdup').botao, 'up');
  assert.strictEqual(parseComando('holdcima').botao, 'up');
  assert.strictEqual(parseComando('holdbaixo').botao, 'down');
  assert.strictEqual(parseComando('holda').botao, 'a');
  assert.strictEqual(parseComando('seguraresquerda').botao, 'left');
});

test('hold com duração padrão', () => {
  const parsed = parseComando('hold cima');
  assert.strictEqual(parsed.duracaoMs, 1000); // HOLD_DEFAULT_MS padrão
});

test('hold com número pequeno = segundos', () => {
  assert.strictEqual(parseComando('hold cima 3').duracaoMs, 3000);
  assert.strictEqual(parseComando('hold up 30').duracaoMs, 10000); // capado em 10s
});

test('hold com número grande = milissegundos', () => {
  assert.strictEqual(parseComando('hold cima 500').duracaoMs, 500);
});

test('hold com sufixos s e ms', () => {
  assert.strictEqual(parseComando('hold cima 2s').duracaoMs, 2000);
  assert.strictEqual(parseComando('hold cima 2seg').duracaoMs, 2000);
  assert.strictEqual(parseComando('hold cima 2segundos').duracaoMs, 2000);
  assert.strictEqual(parseComando('hold cima 500ms').duracaoMs, 500);
});

test('hold é limitado ao máximo (10s)', () => {
  // v3.1: piso artificial de 100ms removido — 60 (ms) fica 60 mesmo
  assert.strictEqual(parseComando('hold cima 60').duracaoMs, 60);
  assert.strictEqual(parseComando('hold cima 20s').duracaoMs, 10000); // 20s -> capado em 10s
  assert.strictEqual(parseComando('hold cima 999999').duracaoMs, 10000);
  assert.strictEqual(parseComando('hold cima 1ms').duracaoMs, 1); // piso real: 1ms
});

test('hold com botão inválido', () => {
  const parsed = parseComando('hold pizza');
  assert.ok(parsed);
  assert.strictEqual(parsed.tipo, 'hold-invalido');
  const soVerbo = parseComando('hold');
  assert.strictEqual(soVerbo.tipo, 'hold-invalido');
});

// ---------------------------------------------------------------------------
// Soltar
// ---------------------------------------------------------------------------

test('comando soltar e sinônimos', () => {
  for (const entrada of ['soltar', 'solta', 'solte', 'release', 'largar', 'SOLTAR', '  soltar  ']) {
    const parsed = parseComando(entrada);
    assert.strictEqual(parsed.tipo, 'soltar', `"${entrada}" deveria ser soltar`);
  }
});

// ---------------------------------------------------------------------------
// Comandos de informação (com prefixo)
// ---------------------------------------------------------------------------

test('comandos de informação com prefixo', () => {
  assert.deepStrictEqual(parseComando('!comandos'), { tipo: 'info', comando: 'comandos', bruto: 'comandos' });
  assert.deepStrictEqual(parseComando('!ajuda'), { tipo: 'info', comando: 'ajuda', bruto: 'ajuda' });
  assert.deepStrictEqual(parseComando('!help'), { tipo: 'info', comando: 'ajuda', bruto: 'help' });
  assert.deepStrictEqual(parseComando('!hold'), { tipo: 'info', comando: 'hold', bruto: 'hold' });
  assert.deepStrictEqual(parseComando('!segurar'), { tipo: 'info', comando: 'hold', bruto: 'segurar' });
  assert.deepStrictEqual(parseComando('!stats'), { tipo: 'info', comando: 'stats', bruto: 'stats' });
  assert.deepStrictEqual(parseComando('!top'), { tipo: 'info', comando: 'top', bruto: 'top' });
  assert.deepStrictEqual(parseComando('!ranking'), { tipo: 'info', comando: 'top', bruto: 'ranking' });
  // v2.5
  assert.deepStrictEqual(parseComando('!uptime'), { tipo: 'info', comando: 'uptime', bruto: 'uptime' });
  assert.deepStrictEqual(parseComando('!recorde'), { tipo: 'info', comando: 'recorde', bruto: 'recorde' });
  assert.deepStrictEqual(parseComando('!democracia'), { tipo: 'info', comando: 'modo', bruto: 'democracia' });
  assert.deepStrictEqual(parseComando('!anarquia'), { tipo: 'info', comando: 'modo', bruto: 'anarquia' });
  assert.deepStrictEqual(parseComando('!votacao'), { tipo: 'info', comando: 'modo', bruto: 'votacao' });
  // com texto extra depois
  assert.deepStrictEqual(parseComando('!comandos por favor'), { tipo: 'info', comando: 'comandos', bruto: 'comandos' });
});

// ---------------------------------------------------------------------------
// Savestates (v2.5)
// ---------------------------------------------------------------------------

test('comandos de savestate: salvar, salva, save, carregar, load', () => {
  assert.deepStrictEqual(parseComando('salvar'), { tipo: 'botao', botao: 'salvar' });
  assert.deepStrictEqual(parseComando('salva'), { tipo: 'botao', botao: 'salvar' });
  assert.deepStrictEqual(parseComando('save'), { tipo: 'botao', botao: 'salvar' });
  assert.deepStrictEqual(parseComando('carregar'), { tipo: 'botao', botao: 'carregar' });
  assert.deepStrictEqual(parseComando('carrega'), { tipo: 'botao', botao: 'carregar' });
  assert.deepStrictEqual(parseComando('load'), { tipo: 'botao', botao: 'carregar' });
});

test('"hold salvar" vira toque instantâneo (save não é segurável)', () => {
  assert.deepStrictEqual(parseComando('hold salvar'), { tipo: 'botao', botao: 'salvar' });
  assert.deepStrictEqual(parseComando('segurar carregar 2'), { tipo: 'botao', botao: 'carregar' });
});

test('prefixo desconhecido não é comando', () => {
  assert.strictEqual(parseComando('!xyzabc'), null);
  assert.strictEqual(parseComando('!'), null);
});

// ---------------------------------------------------------------------------
// Saudações
// ---------------------------------------------------------------------------

test('saudações reconhecidas', () => {
  for (const entrada of ['ola', 'olá', 'oi', 'hello', 'hi', 'salve', 'OI']) {
    const parsed = parseComando(entrada);
    assert.strictEqual(parsed.tipo, 'ola', `"${entrada}" deveria ser saudação`);
  }
});

// ---------------------------------------------------------------------------
// Consistência do registro
// ---------------------------------------------------------------------------

test('todo alias do registro resolve no parser (consistência)', () => {
  // v2.9: o registro de controles é a fonte única — cada alias de cada
  // controle ATIVO tem que virar comando de botão quando o chat digita
  for (const c of controles.ativos()) {
    assert.ok(c.aliases.length >= 1, `controle "${c.id}" sem alias`);
    for (const alias of c.aliases) {
      const parsed = parseComando(alias);
      assert.ok(parsed, `alias "${alias}" não resolve`);
      assert.strictEqual(parsed.tipo, 'botao', `alias "${alias}" deveria ser botão`);
      assert.strictEqual(parsed.botao, c.id, `alias "${alias}" -> ${parsed.botao} (esperado ${c.id})`);
    }
  }
});

test('mensagens longas são ignoradas (anti-abuso)', () => {
  const longa = 'a'.repeat(150);
  assert.strictEqual(parseComando(longa), null);
});
