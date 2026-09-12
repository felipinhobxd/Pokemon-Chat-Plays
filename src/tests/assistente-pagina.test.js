const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PAGINA } = require('../assistente-pagina');

// Executa o script entregue ao navegador, sem iniciar o bot ou fazer HTTP.
function abrirPagina() {
  const elementos = new Map();
  const ouvintes = new Map();
  function elemento(id) {
    if (!elementos.has(id)) {
      const classes = new Set();
      const eventos = [];
      elementos.set(id, {
        value: '', style: {}, eventos,
        classList: {
          add: (nome) => classes.add(nome),
          remove: (nome) => classes.delete(nome),
          contains: (nome) => classes.has(nome),
        },
        dispatchEvent: (evento) => eventos.push(evento.type),
        scrollIntoView() {},
      });
    }
    return elementos.get(id);
  }
  const pagina = vm.createContext({
    Event,
    document: { getElementById: elemento, addEventListener() {} },
    window: {
      addEventListener(tipo, fn, captura = false) {
        if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Map());
        ouvintes.get(tipo).set(fn, captura);
      },
      removeEventListener(tipo, fn, captura = false) {
        if (ouvintes.get(tipo)?.get(fn) === captura) ouvintes.get(tipo).delete(fn);
      },
    },
  });
  vm.runInContext(PAGINA.match(/<script>([\s\S]*?)<\/script>/)[1], pagina);
  pagina.TECLAS_VALIDAS = ['space', 'enter'];
  pagina.RESERVADOS = ['hold'];
  return {
    pagina, elemento,
    emitir(tipo, key, modificadores = {}) {
      const evento = { key, ...modificadores, preventDefault() {}, stopPropagation() {} };
      for (const fn of [...(ouvintes.get(tipo)?.keys() || [])]) fn(evento);
    },
    conferirLimpeza() {
      assert.equal(pagina.capturaAtiva, null);
      for (const tipo of ['keydown', 'keyup', 'blur']) {
        assert.equal(ouvintes.get(tipo)?.size || 0, 0, tipo + ' ainda registrado');
      }
      assert.equal(elemento('captura').classList.contains('ativa'), false);
    },
  };
}

test('aliases em conflito continuam intactos e bloqueiam validações e Save repetidos', () => {
  const { pagina } = abrirPagina();
  const controles = [
    { label: 'A', key: 'space', aliases: ['jump'], enabled: true },
    { label: 'B', key: 'enter', aliases: ['jump'], enabled: true },
  ];
  pagina.CONTROLES = controles;
  pagina.api = () => assert.fail('Save não pode enviar controles conflitantes');
  for (let i = 0; i < 2; i++) {
    assert.equal(pagina.validarControlesCliente(), false);
    assert.deepEqual(controles.map((c) => c.aliases), [['jump'], ['jump']]);
    pagina.salvar();
  }
  controles[1].aliases = ['duck'];
  assert.equal(pagina.validarControlesCliente(), true);
});

test('normalização, palavras inválidas e reservadas não alteram os aliases digitados', () => {
  const { pagina } = abrirPagina();
  const aliases = [' JÚMP ', 'invalid!', 'hold'];
  pagina.CONTROLES = [{ label: 'Pular', key: 'space', aliases, enabled: true }];
  for (let i = 0; i < 2; i++) {
    assert.equal(pagina.validarControlesCliente(), false);
    assert.equal(pagina.CONTROLES[0].aliases, aliases);
    assert.deepEqual(aliases, [' JÚMP ', 'invalid!', 'hold']);
  }
});

for (const [modificador, tecla, flags, esperado] of [
  ['Shift', 'F5', { shiftKey: true }, 'shift+f5'],
  ['Control', 'a', { ctrlKey: true }, 'ctrl+a'],
  ['Alt', '1', { altKey: true }, 'alt+1'],
]) {
  test('captura espera a tecla principal para ' + esperado, () => {
    const h = abrirPagina();
    const input = h.elemento('tecla');
    h.pagina.iniciarCaptura(h.elemento('captura'), input);
    h.emitir('keydown', modificador, flags);
    assert.equal(input.value, '');
    assert.ok(h.pagina.capturaAtiva);
    h.emitir('keydown', tecla, flags);
    assert.equal(input.value, esperado);
    h.conferirLimpeza();
    h.emitir('keyup', modificador);
    assert.equal(input.value, esperado);
    assert.deepEqual(input.eventos, ['input']);
  });
}

test('Shift sozinho só finaliza a captura no keyup', () => {
  const h = abrirPagina();
  const input = h.elemento('tecla');
  h.pagina.iniciarCaptura(h.elemento('captura'), input);
  h.emitir('keydown', 'Shift', { shiftKey: true });
  assert.equal(input.value, '');
  h.emitir('keyup', 'Shift');
  assert.equal(input.value, 'shift');
  assert.deepEqual(input.eventos, ['input']);
  h.conferirLimpeza();
});

test('tecla simples continua finalizando a captura no keydown', () => {
  const h = abrirPagina();
  const input = h.elemento('tecla');
  h.pagina.iniciarCaptura(h.elemento('captura'), input);
  h.emitir('keydown', ' ');
  assert.equal(input.value, 'space');
  assert.deepEqual(input.eventos, ['input']);
  h.conferirLimpeza();
});

for (const motivo of ['cancelar', 'blur']) {
  test(motivo + ' limpa listeners e o modificador pendente', () => {
    const h = abrirPagina();
    const input = h.elemento('tecla');
    h.pagina.iniciarCaptura(h.elemento('captura'), input);
    h.emitir('keydown', 'Shift', { shiftKey: true });
    if (motivo === 'cancelar') h.pagina.pararCaptura();
    else h.emitir('blur');
    h.conferirLimpeza();
    h.emitir('keyup', 'Shift');
    assert.equal(input.value, '');
    assert.deepEqual(input.eventos, []);
    h.pagina.iniciarCaptura(h.elemento('captura'), input);
    h.emitir('keyup', 'Shift');
    assert.equal(input.value, '');
    assert.ok(h.pagina.capturaAtiva);
    h.pagina.pararCaptura();
    h.conferirLimpeza();
  });
}


test('modo Testar Comandos aparece no wizard e deixa claro que é simulação', () => {
  assert.match(PAGINA, /🧪 Testar Comandos/);
  assert.match(PAGINA, /\/api\/testar-comando/);
  assert.match(PAGINA, /Não envia nenhuma tecla, clique ou gamepad/);
  assert.match(PAGINA, /hold direita 2/);
  assert.match(PAGINA, /pad a/);
});
