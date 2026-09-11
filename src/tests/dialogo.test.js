const test = require('node:test');
const assert = require('node:assert');
const dialogo = require('../utils/dialogo');

function criarRelogioFake() {
  let agoraMs = 0;
  let proximoId = 1;
  const tarefas = new Map();

  function agendar(fn, atraso) {
    const id = proximoId++;
    tarefas.set(id, { id, quando: agoraMs + atraso, fn });
    return id;
  }

  function cancelar(id) {
    tarefas.delete(id);
  }

  function avancar(ms) {
    const alvo = agoraMs + ms;
    while (true) {
      const proximas = [...tarefas.values()]
        .filter((t) => t.quando <= alvo)
        .sort((a, b) => a.quando - b.quando || a.id - b.id);
      if (proximas.length === 0) break;
      const tarefa = proximas[0];
      tarefas.delete(tarefa.id);
      agoraMs = tarefa.quando;
      tarefa.fn();
    }
    agoraMs = alvo;
  }

  return {
    agendar,
    cancelar,
    agora: () => agoraMs,
    avancar,
    pendentes: () => tarefas.size,
  };
}

test('dialogo reconhece PT-BR com/sem acento e inglês', () => {
  for (const entrada of ['dialogo', 'diálogo', ' DIALOGO ', 'dialogue']) {
    assert.strictEqual(dialogo.ehComando(entrada), true, entrada);
  }
  assert.strictEqual(dialogo.ehComando('a'), false);
  assert.strictEqual(dialogo.ehComando('dialogo agora'), false);
});

test('dialogo aperta A repetidamente e para exatamente em 5s', () => {
  const relogio = criarRelogioFake();
  const macro = dialogo.criarExecutor(relogio);
  let toques = 0;

  const iniciou = macro.iniciar({
    executar: () => { toques += 1; return true; },
  });

  assert.strictEqual(iniciou, true);
  assert.strictEqual(toques, 1, 'primeiro A deve ser imediato');
  assert.strictEqual(macro.estaAtivo(), true);

  relogio.avancar(4999);
  assert.ok(toques > 20, 'deve realmente spammar A durante a janela');
  assert.strictEqual(macro.estaAtivo(), true);

  relogio.avancar(1);
  assert.strictEqual(macro.estaAtivo(), false);
  assert.strictEqual(relogio.pendentes(), 0);
});

test('dialogo não empilha duas macros ao mesmo tempo', () => {
  const relogio = criarRelogioFake();
  const macro = dialogo.criarExecutor(relogio);
  let toques = 0;

  assert.strictEqual(macro.iniciar({ executar: () => { toques += 1; return true; } }), true);
  assert.strictEqual(macro.iniciar({ executar: () => { toques += 100; return true; } }), false);
  relogio.avancar(300);
  assert.ok(toques < 100, 'segunda macro não pode ser empilhada');
});

test('dialogo para quando o chat é pausado', () => {
  const relogio = criarRelogioFake();
  const macro = dialogo.criarExecutor(relogio);
  let pausado = false;
  let toques = 0;

  macro.iniciar({
    executar: () => { toques += 1; return true; },
    estaPausado: () => pausado,
  });
  relogio.avancar(300);
  const antesDaPausa = toques;
  pausado = true;
  relogio.avancar(150);

  assert.strictEqual(toques, antesDaPausa);
  assert.strictEqual(macro.estaAtivo(), false);
  assert.strictEqual(relogio.pendentes(), 0);
});

test('dialogo aborta se o botão A não puder ser executado', () => {
  const relogio = criarRelogioFake();
  const macro = dialogo.criarExecutor(relogio);
  let tentativas = 0;

  const iniciou = macro.iniciar({
    executar: () => { tentativas += 1; return false; },
  });

  assert.strictEqual(iniciou, false);
  assert.strictEqual(tentativas, 1);
  assert.strictEqual(macro.estaAtivo(), false);
  assert.strictEqual(relogio.pendentes(), 0);
});
