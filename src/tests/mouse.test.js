'use strict';

const test = require('node:test');
const assert = require('node:assert');
const mouse = require('../controllers/mouse');


test('modo do mouse aceita janela/jogo/global/off', () => {
  const { normalizarModo } = mouse.__test;
  assert.strictEqual(normalizarModo('janela'), 'janela');
  assert.strictEqual(normalizarModo('GLOBAL'), 'global');
  assert.strictEqual(normalizarModo('JOGO'), 'jogo');
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


test('worker Windows contém backends janela, jogo e global', () => {
  const fonte = mouse.__test.fonteWorker();
  assert.ok(fonte.includes('PostMessage'), 'modo janela precisa de PostMessage');
  assert.ok(fonte.includes('SetCursorPos'), 'modo global precisa de SetCursorPos');
  assert.ok(fonte.includes('SendInput'), 'cliques e movimento relativo precisam de SendInput');
  assert.ok(fonte.includes('MOUSEEVENTF_MOVE_NOCOALESCE'), 'modo jogo precisa de movimento relativo sem coalescer');
  assert.ok(fonte.includes('SetForegroundWindow'), 'modo jogo precisa focar o alvo antes do input');
  assert.ok(fonte.includes('TargetPid'), 'instância exata precisa ser resolvida por PID');
  assert.ok(fonte.includes("'MJ'"), 'protocolo precisa expor movimento do modo jogo');
  assert.ok(!fonte.includes('mouse_event('), 'backend legado mouse_event não deve voltar');
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
    mouse.configurar({
      modo: antes.modo,
      passoPx: antes.passoPx,
      alvoExe: antes.alvoExe,
      alvoPid: antes.alvoPid,
      alvoTitulo: antes.alvoTitulo,
      alvoProcesso: antes.alvoProcesso,
    });
  }
});

test('modo jogo envia movimento, clique e hold pelo protocolo relativo', () => {
  const antes = mouse.status();
  const linhas = [];
  try {
    mouse.configurar({
      modo: 'jogo',
      alvoExe: 'C:\\Java\\bin\\javaw.exe',
      alvoPid: 4242,
      alvoTitulo: 'Minecraft* 26.2',
      alvoProcesso: 'javaw.exe',
      passoPx: 40,
    });
    mouse.__test.simular({ plataforma: 'win32', linhas });
    assert.strictEqual(mouse.mover(1, -1), true);
    assert.strictEqual(mouse.clicar('right'), true);
    assert.strictEqual(mouse.segurar('left', 50), true);
    assert.deepStrictEqual(linhas.slice(0, 3), ['MJ 40 -40', 'CJ R', 'DJ L']);
    const atual = mouse.status();
    assert.strictEqual(atual.alvoPid, 4242);
    assert.strictEqual(atual.alvoTitulo, 'Minecraft* 26.2');
  } finally {
    mouse.soltarTodos();
    mouse.__test.restaurar();
    mouse.configurar({
      modo: antes.modo,
      alvoExe: antes.alvoExe,
      alvoPid: antes.alvoPid,
      alvoTitulo: antes.alvoTitulo,
      alvoProcesso: antes.alvoProcesso,
      passoPx: antes.passoPx,
    });
  }
});
