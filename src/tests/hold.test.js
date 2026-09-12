'use strict';

/**
 * Testes de regressão do sistema unificado de HOLD (v3.1).
 *
 * Cobertura pedida:
 *  - parser de duração compartilhado: 1ms, 37ms, 999ms, 1s, 1.5s, 10s,
 *    segundos decimais, abaixo/acima dos limites, número puro compatível;
 *  - teclado: keydown/keyup, 1ms, 10s, soltar, pânico, timers obsoletos;
 *  - mouse: hold esquerdo/direito, aliases PT/EN, janela/global,
 *    soltar/pânico, timer obsoleto não solta hold novo;
 *  - gamepad: hold de botão/gatilho/analógico, neutralização, timers;
 *  - democracia: hold de mouse/pad NUNCA executa direto;
 *  - cooldowns: chaves estáveis hold:mouse:left / hold:pad:a;
 *  - command tester: descrição com duração normalizada, sem input real.
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseDuracaoMs, parseDuracaoExplicitaMs, duracaoEfetiva, limitarMs } = require('../utils/duracao');
const { parseComando } = require('../commands');
const { parseMouseCommand } = require('../mouse-commands');
const { parseGamepadCommand } = require('../gamepad-commands');
const handlers = require('../handlers');
const { testarComando } = require('../testar-comando');
const votacao = require('../utils/votacao');
const pausa = require('../utils/pausa');
const mouse = require('../controllers/mouse');
const gamepad = require('../controllers/gamepad');
const teclado = require('../controllers/keyboard');
const { chaveCooldownGamepad } = require('../gamepad-integration');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Parser de duração compartilhado
// ---------------------------------------------------------------------------

test('duracao: valores explícitos e decimais', () => {
  assert.strictEqual(parseDuracaoMs('1ms'), 1);
  assert.strictEqual(parseDuracaoMs('37ms'), 37);
  assert.strictEqual(parseDuracaoMs('999ms'), 999);
  assert.strictEqual(parseDuracaoMs('1s'), 1000);
  assert.strictEqual(parseDuracaoMs('1.5s'), 1500);
  assert.strictEqual(parseDuracaoMs('10s'), 10000);
  assert.strictEqual(parseDuracaoMs('0.001s'), 1);
  assert.strictEqual(parseDuracaoMs('0.01s'), 10);
  assert.strictEqual(parseDuracaoMs('0.1s'), 100);
  assert.strictEqual(parseDuracaoMs('1.25s'), 1250);
  assert.strictEqual(parseDuracaoMs('2.5s'), 2500);
});

test('duracao: abaixo do mínimo e acima do máximo são limitados', () => {
  assert.strictEqual(parseDuracaoMs('0ms'), 1);
  assert.strictEqual(parseDuracaoMs('0s'), 1);
  assert.strictEqual(parseDuracaoMs('0.5ms'), 1);
  assert.strictEqual(parseDuracaoMs('11s'), 10000);
  assert.strictEqual(parseDuracaoMs('99999ms'), 10000);
  assert.strictEqual(parseDuracaoMs('999999'), 10000); // número puro grande
});

test('duracao: número puro mantém compatibilidade do teclado', () => {
  assert.strictEqual(parseDuracaoMs('3'), 3000); // <=30 = segundos
  assert.strictEqual(parseDuracaoMs('30'), 30000 === 30000 ? 10000 : 30000); // 30s capado em 10s
  assert.strictEqual(parseDuracaoMs('31'), 31); // >30 = ms
  assert.strictEqual(parseDuracaoMs('500'), 500);
});

test('duracao: variante explícita rejeita número puro (ambíguo no gamepad)', () => {
  assert.strictEqual(parseDuracaoExplicitaMs('75'), null);
  assert.strictEqual(parseDuracaoExplicitaMs('0'), null);
  assert.strictEqual(parseDuracaoExplicitaMs('500ms'), 500);
  assert.strictEqual(parseDuracaoExplicitaMs('1.5s'), 1500);
  assert.strictEqual(parseDuracaoExplicitaMs('abc'), null);
  assert.strictEqual(parseDuracaoMs('abc'), null);
  assert.strictEqual(parseDuracaoMs(''), null);
  assert.strictEqual(parseDuracaoMs(null), null);
});

test('duracao: duracaoEfetiva aplica padrão e teto do config', () => {
  const geral = { holdPadraoMs: 1000, holdMaxMs: 10000 };
  assert.strictEqual(duracaoEfetiva(null, geral), 1000);
  assert.strictEqual(duracaoEfetiva(250, geral), 250);
  assert.strictEqual(duracaoEfetiva(1, geral), 1);
  assert.strictEqual(duracaoEfetiva(99999, geral), 10000);
  const apertado = { holdPadraoMs: 1000, holdMaxMs: 2000 };
  assert.strictEqual(duracaoEfetiva(5000, apertado), 2000); // teto do config respeita
  assert.strictEqual(duracaoEfetiva(null, {}), 1000); // sem config: padrão seguro
});

// ---------------------------------------------------------------------------
// 2. Teclado: faixa 1ms–10s no parser do chat
// ---------------------------------------------------------------------------

test('teclado: hold aceita 1ms–10s com decimais', () => {
  assert.strictEqual(parseComando('hold cima 1ms').duracaoMs, 1);
  assert.strictEqual(parseComando('hold cima 237ms').duracaoMs, 237);
  assert.strictEqual(parseComando('hold cima 2.5s').duracaoMs, 2500);
  assert.strictEqual(parseComando('hold cima 0.001s').duracaoMs, 1);
  assert.strictEqual(parseComando('hold cima 10s').duracaoMs, 10000);
  assert.strictEqual(parseComando('hold cima 3').duracaoMs, 3000); // compat
  assert.strictEqual(parseComando('hold cima 500').duracaoMs, 500); // compat
  assert.strictEqual(parseComando('hold cima').duracaoMs, 1000); // padrão
});

// ---------------------------------------------------------------------------
// 3. Mouse: parsing do hold
// ---------------------------------------------------------------------------

test('mouse: hold de botão esquerdo em todas as formas', () => {
  const casos = [
    ['hold clique 1s', 'left', 1000],
    ['hold click 1s', 'left', 1000],
    ['hold clique', 'left', null],
    ['hold clique esquerdo 250ms', 'left', 250],
    ['hold left click 3s', 'left', 3000],
    ['segurar botao esquerdo 250ms', 'left', 250],
    ['segurar botão esquerdo 250ms', 'left', 250], // com acento (NFD)
    ['segurar clique esquerdo 3s', 'left', 3000],
    ['hold mouse left 500ms', 'left', 500],
    ['segurar mouse esquerdo 500ms', 'left', 500],
    ['hold clique 1.25s', 'left', 1250],
    ['hold clique 75ms', 'left', 75],
  ];
  for (const [texto, botao, dur] of casos) {
    const r = parseMouseCommand(texto);
    assert.ok(r, `deveria parsear: "${texto}"`);
    assert.strictEqual(r.tipo, 'mouse-hold', `"${texto}"`);
    assert.strictEqual(r.botao, botao, `"${texto}"`);
    assert.strictEqual(r.duracaoMs, dur, `"${texto}"`);
  }
});

test('mouse: hold de botão direito em todas as formas', () => {
  const casos = [
    ['hold clique direito 2s', 'right', 2000],
    ['hold click direito 2s', 'right', 2000],
    ['hold right click 3s', 'right', 3000],
    ['segurar clique direito 75ms', 'right', 75],
    ['segurar botao direito 75ms', 'right', 75],
    ['hold mouse right 3s', 'right', 3000],
    ['segurar mouse direito 3s', 'right', 3000],
    ['hold clique direito 2.5s', 'right', 2500],
    ['hold clique direito', 'right', null],
    ['hold mouse clique direito 1s', 'right', 1000],
  ];
  for (const [texto, botao, dur] of casos) {
    const r = parseMouseCommand(texto);
    assert.ok(r, `deveria parsear: "${texto}"`);
    assert.strictEqual(r.tipo, 'mouse-hold', `"${texto}"`);
    assert.strictEqual(r.botao, botao, `"${texto}"`);
    assert.strictEqual(r.duracaoMs, dur, `"${texto}"`);
  }
});

test('mouse: lixo depois do alvo não é hold (cai no hold-invalido do teclado)', () => {
  assert.strictEqual(parseMouseCommand('hold clique abc'), null);
  assert.strictEqual(parseMouseCommand('segurar mouse esquerdo 5x'), null);
  // hold de teclado normal NÃO é interceptado pelo mouse
  assert.strictEqual(parseMouseCommand('hold cima 3'), null);
  const tecladoHold = parseComando('hold cima 3');
  assert.strictEqual(tecladoHold.tipo, 'hold');
  // taps continuam funcionando
  assert.strictEqual(parseMouseCommand('clique').tipo, 'mouse-click');
  assert.strictEqual(parseMouseCommand('clique direito').tipo, 'mouse-click');
});

test('mouse: hold de olhar/camera/look aceita 1ms–10s e preserva mouse left/right como botão', () => {
  const casos = [
    ['hold olhar cima 10s', 'cima', 0, -1, 10000],
    ['segurar camera direita 2.5s', 'direita', 1, 0, 2500],
    ['hold look down 500ms', 'baixo', 0, 1, 500],
    ['hold mouse esquerda 37ms', 'esquerda', -1, 0, 37],
    ['segurar olhar baixo 1ms', 'baixo', 0, 1, 1],
  ];
  for (const [texto, direcao, dx, dy, duracaoMs] of casos) {
    const r = parseMouseCommand(texto);
    assert.ok(r, texto);
    assert.strictEqual(r.tipo, 'mouse-move-hold', texto);
    assert.strictEqual(r.direcao, direcao, texto);
    assert.strictEqual(r.dx, dx, texto);
    assert.strictEqual(r.dy, dy, texto);
    assert.strictEqual(r.duracaoMs, duracaoMs, texto);
  }
  // Compatibilidade histórica: em inglês "mouse left/right" = botão.
  assert.strictEqual(parseMouseCommand('hold mouse left 500ms').tipo, 'mouse-hold');
  assert.strictEqual(parseMouseCommand('hold mouse right 500ms').tipo, 'mouse-hold');
});

test('mouse: worker tem DOWN/UP separados nos dois modos (fonte C#)', () => {
  const fonte = mouse.__test.fonteWorker();
  assert.ok(fonte.includes('DownWindow'), 'DownWindow');
  assert.ok(fonte.includes('UpWindow'), 'UpWindow');
  assert.ok(fonte.includes('DownGlobal'), 'DownGlobal');
  assert.ok(fonte.includes('UpGlobal'), 'UpGlobal');
  assert.ok(fonte.includes("'DW'"), 'protocolo DW');
  assert.ok(fonte.includes("'UW'"), 'protocolo UW');
  assert.ok(fonte.includes("'DG'"), 'protocolo DG');
  assert.ok(fonte.includes("'UG'"), 'protocolo UG');
});

// ---------------------------------------------------------------------------
// 4. Mouse: runtime do hold (worker simulado, sem Windows)
// ---------------------------------------------------------------------------

test('mouse: hold de olhar repete movimento e soltar cancela imediatamente', async () => {
  mouse.configurar({ modo: 'global', alvoExe: null, passoPx: 40 });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    assert.strictEqual(mouse.segurarMovimento(0, -1, 180, 'camera'), true);
    assert.strictEqual(linhas[0], 'MG 0 -40');
    assert.strictEqual(mouse.totalSegurando(), 1);
    await sleep(120);
    assert.ok(linhas.filter((l) => l === 'MG 0 -40').length >= 2, 'deve repetir o movimento');
    const liberados = mouse.soltarTodos();
    assert.strictEqual(liberados, 1);
    assert.strictEqual(mouse.totalSegurando(), 0);
    const tamanho = linhas.length;
    await sleep(120);
    assert.strictEqual(linhas.length, tamanho, 'nenhum tick antigo pode continuar após soltar');
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: corrida de timers — soltar troca olhar cima por baixo e o timer VELHO nunca interfere', async () => {
  mouse.configurar({ modo: 'global', alvoExe: null, passoPx: 40 });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    // hold olhar cima 600ms (o "10s" do caso real, encurtado p/ teste)
    assert.strictEqual(mouse.segurarMovimento(0, -1, 600, 'a'), true);
    await sleep(100);
    assert.ok(linhas.filter((l) => l === 'MG 0 -40').length >= 1, 'cima deve ter andado antes do soltar');
    // soltar (F9/soltar chamariam soltarTodos) e novo hold baixo 250ms
    assert.strictEqual(mouse.soltarTodos(), 1);
    const marco = linhas.length;
    assert.strictEqual(mouse.segurarMovimento(0, 1, 250, 'b'), true);
    // espera o novo terminar (250ms) E o prazo do timer antigo (600ms) vencer
    await sleep(560);
    const depois = linhas.slice(marco);
    assert.ok(depois.length >= 2, 'baixo deve ter se movido (imediato + tick)');
    assert.ok(depois.every((l) => l === 'MG 0 40'), 'nenhum tick de CIMA pode vazar após o soltar');
    assert.strictEqual(mouse.totalSegurando(), 0, 'nada fica segurado no fim');
    const tamanho = linhas.length;
    await sleep(150);
    assert.strictEqual(linhas.length, tamanho, 'zero ticks depois que os dois holds acabaram');
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: re-hold da MESMA direção substitui os timers antigos (não soma, não estende)', async () => {
  mouse.configurar({ modo: 'global', alvoExe: null, passoPx: 40 });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    assert.strictEqual(mouse.segurarMovimento(0, -1, 400, 'a'), true);
    await sleep(80);
    // novo hold da mesma direção, mais curto: substitui, não empilha
    assert.strictEqual(mouse.segurarMovimento(0, -1, 150, 'b'), true);
    assert.strictEqual(mouse.totalSegurando(), 1, 'mesma direção = 1 hold ativo (substituiu)');
    await sleep(420); // novo (150ms) e o velho (400ms) já venceram ambos
    assert.strictEqual(mouse.totalSegurando(), 0, 'o hold substituído não pode manter nada vivo');
    const tamanho = linhas.length;
    await sleep(150);
    assert.strictEqual(linhas.length, tamanho, 'nenhum tick do timer antigo após a substituição terminar');
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: hold real down→up com worker simulado (janela e global)', async () => {
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe', passoPx: 40 });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    const ok = mouse.segurar('left', 60, 'jogador');
    assert.strictEqual(ok, true);
    assert.strictEqual(mouse.totalSegurando(), 1);
    assert.deepStrictEqual(linhas, ['DW L']); // down na hora, sem up
    await sleep(90);
    assert.deepStrictEqual(linhas, ['DW L', 'UW L']); // up só depois da duração
    assert.strictEqual(mouse.totalSegurando(), 0);

    // modo global: DG/UG
    mouse.configurar({ modo: 'global', alvoExe: 'C:\\Game\\game.exe' });
    mouse.__test.simular({ plataforma: 'win32', linhas });
    assert.strictEqual(mouse.segurar('right', 40), true);
    assert.strictEqual(linhas[linhas.length - 1], 'DG R');
    await sleep(80);
    assert.strictEqual(linhas[linhas.length - 1], 'UG R');
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: soltar libera hold imediato (10s pedido, solto após ~60ms)', async () => {
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    assert.strictEqual(mouse.segurar('left', 10000, 'minerando'), true);
    await sleep(60);
    const liberados = mouse.soltarTodos();
    assert.strictEqual(liberados, 1);
    assert.strictEqual(linhas[linhas.length - 1], 'UW L');
    assert.strictEqual(mouse.totalSegurando(), 0);
    // depois do soltar, NÃO chega mais up do timer antigo
    const tamanho = linhas.length;
    await sleep(80);
    assert.strictEqual(linhas.length, tamanho);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: timer obsoleto NUNCA interfere em hold novo (10s → soltar → 2s)', async () => {
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    mouse.segurar('left', 10000); // hold antigo
    await sleep(30);
    mouse.soltarTodos(); // soltar chega cedo
    const inicioNovo = Date.now();
    mouse.segurar('left', 60); // hold novo curtíssimo
    // o novo hold manda exatamente 1 down + 1 up — o timer de 10s morreu
    await sleep(120);
    const downs = linhas.filter((l) => l === 'DW L').length;
    const ups = linhas.filter((l) => l === 'UW L').length;
    assert.strictEqual(downs, 2); // um por hold (re-segurar depois de soltar)
    assert.strictEqual(ups, 2);
    assert.strictEqual(mouse.totalSegurando(), 0);
    // nada chega depois (o timer de 10s teria mandado up em ~10s; testamos
    // que em 120ms tudo já acabou)
    const tamanho = linhas.length;
    await sleep(60);
    assert.strictEqual(linhas.length, tamanho);
    assert.ok(Date.now() - inicioNovo < 1000);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: re-segurar botão já pressionado NÃO re-envia down (sem clique duplo)', async () => {
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    mouse.segurar('left', 10000);
    await sleep(20);
    mouse.segurar('left', 50); // estende/substitui sem novo down
    assert.strictEqual(linhas.filter((l) => l === 'DW L').length, 1);
    await sleep(100);
    assert.strictEqual(linhas.filter((l) => l === 'UW L').length, 1); // up do novo timer
    assert.strictEqual(mouse.totalSegurando(), 0);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: configurar() com hold ativo solta antes de trocar alvo', async () => {
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Velho\\old.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    mouse.segurar('left', 10000);
    // troca de alvo/modo no meio do hold: botão não pode ficar preso
    mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Novo\\new.exe' });
    assert.ok(linhas.includes('UW L'), 'UP enviado antes do worker cair');
    assert.strictEqual(mouse.totalSegurando(), 0);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('mouse: hold simultâneo esquerdo+direito independentes', async () => {
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    assert.strictEqual(mouse.segurar('left', 80), true);
    assert.strictEqual(mouse.segurar('right', 120), true);
    assert.strictEqual(mouse.totalSegurando(), 2);
    await sleep(110); // esquerdo (80ms) expirou; direito (120ms) ainda seguro
    assert.strictEqual(mouse.totalSegurando(), 1);
    mouse.soltarTodos();
    assert.strictEqual(mouse.totalSegurando(), 0);
    assert.ok(linhas.includes('UW L') && linhas.includes('UW R'));
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

// ---------------------------------------------------------------------------
// 5. Gamepad: parsing do hold
// ---------------------------------------------------------------------------

test('gamepad: hold de botão', () => {
  const r = parseGamepadCommand('hold pad a 250ms');
  assert.strictEqual(r.tipo, 'gamepad-botao');
  assert.strictEqual(r.botao, 'A');
  assert.strictEqual(r.duracaoMs, 250);
  assert.strictEqual(r.hold, true);

  assert.strictEqual(parseGamepadCommand('hold pad a 1ms').duracaoMs, 1);
  assert.strictEqual(parseGamepadCommand('hold pad x 2s').duracaoMs, 2000);
  assert.strictEqual(parseGamepadCommand('hold pad rb 500ms').botao, 'RB');
  assert.strictEqual(parseGamepadCommand('segurar pad a 1ms').duracaoMs, 1);
  // número puro no botão = segundos (compat teclado)
  assert.strictEqual(parseGamepadCommand('hold pad a 3').duracaoMs, 3000);
  // sem duração: null (default aplicado na integração)
  assert.strictEqual(parseGamepadCommand('hold pad a').duracaoMs, null);
  assert.strictEqual(parseGamepadCommand('hold pad a').hold, true);
});

test('gamepad: hold de gatilho (intensidade + duração explícita)', () => {
  const r = parseGamepadCommand('hold pad rt 75 500ms');
  assert.strictEqual(r.tipo, 'gamepad-trigger');
  assert.strictEqual(r.trigger, 'R');
  assert.strictEqual(r.valor, 75);
  assert.strictEqual(r.duracaoMs, 500);
  assert.strictEqual(r.hold, true);

  assert.strictEqual(parseGamepadCommand('hold pad lt 100 2s').duracaoMs, 2000);
  // sem sufixo: o número é a INTENSIDADE, não duração
  const intensidade = parseGamepadCommand('hold pad lt 60');
  assert.strictEqual(intensidade.valor, 60);
  assert.strictEqual(intensidade.duracaoMs, null);
});

test('gamepad: hold de analógico (direção ou coordenadas + duração)', () => {
  const dir = parseGamepadCommand('hold pad ls direita 250ms');
  assert.strictEqual(dir.tipo, 'gamepad-stick');
  assert.strictEqual(dir.stick, 'L');
  assert.strictEqual(dir.x, 100);
  assert.strictEqual(dir.y, 0);
  assert.strictEqual(dir.duracaoMs, 250);
  assert.strictEqual(dir.hold, true);

  assert.strictEqual(parseGamepadCommand('hold pad ls esquerda 2s').duracaoMs, 2000);
  assert.strictEqual(parseGamepadCommand('hold pad rs cima 500ms').stick, 'R');

  const coords = parseGamepadCommand('hold pad ls 100 0 750ms');
  assert.strictEqual(coords.x, 100);
  assert.strictEqual(coords.y, 0);
  assert.strictEqual(coords.duracaoMs, 750);

  const coords2 = parseGamepadCommand('hold pad rs -50 80 1.5s');
  assert.strictEqual(coords2.x, -50);
  assert.strictEqual(coords2.y, 80);
  assert.strictEqual(coords2.duracaoMs, 1500);

  // sem duração explícita: coordenadas puras continuam válidas
  const semDur = parseGamepadCommand('hold pad ls 100 0');
  assert.strictEqual(semDur.x, 100);
  assert.strictEqual(semDur.y, 0);
  assert.strictEqual(semDur.duracaoMs, null);
});

test('gamepad: comandos normais continuam iguais (sem hold)', () => {
  const tap = parseGamepadCommand('pad a');
  assert.strictEqual(tap.hold, undefined);
  assert.strictEqual(tap.duracaoMs, null);
  const tapDur = parseGamepadCommand('pad a 500ms');
  assert.strictEqual(tapDur.duracaoMs, 500);
  assert.strictEqual(tapDur.hold, undefined);
  // reset não vira hold
  assert.strictEqual(parseGamepadCommand('hold pad soltar'), null);
  assert.strictEqual(parseGamepadCommand('pad soltar').tipo, 'gamepad-reset');
  // verbo de hold sem namespace pad não é gamepad
  assert.strictEqual(parseGamepadCommand('hold cima 3'), null);
});

// ---------------------------------------------------------------------------
// 6. Gamepad: runtime (worker simulado)
// ---------------------------------------------------------------------------

test('gamepad: hold de botão manda B 1 ... B 0 com a duração', async () => {
  gamepad.__test.restaurarSimulacao();
  // configurarDeEnv fixa o modo SEM que garantirEnv() re-leia o env depois
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on', GAMEPAD_TAP_MS: '220', GAMEPAD_ANALOG_MS: '320' });
  const linhas = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas });
  try {
    assert.strictEqual(gamepad.pressionar('A', 1), true);
    assert.deepStrictEqual(linhas, ['B A 1']);
    await sleep(40);
    assert.deepStrictEqual(linhas, ['B A 1', 'B A 0']);
    assert.strictEqual(gamepad.status().estado, 'pronto');
  } finally {
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

test('gamepad: hold de gatilho manda T R 75 ... T R 0', async () => {
  gamepad.__test.restaurarSimulacao();
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on' });
  const linhas = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas });
  try {
    gamepad.acionarTrigger('R', 75, 60);
    assert.deepStrictEqual(linhas, ['T R 75']);
    await sleep(100);
    assert.deepStrictEqual(linhas, ['T R 75', 'T R 0']);
  } finally {
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

test('gamepad: hold de analógico manda S L ... S L 0 0 (centro exato)', async () => {
  gamepad.__test.restaurarSimulacao();
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on' });
  const linhas = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas });
  try {
    gamepad.moverStick('L', 100, 0, 50);
    assert.deepStrictEqual(linhas, ['S L 100 0']);
    await sleep(90);
    assert.deepStrictEqual(linhas, ['S L 100 0', 'S L 0 0']);
  } finally {
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

test('gamepad: resetar neutraliza TUDO e cancela timers pendentes', async () => {
  gamepad.__test.restaurarSimulacao();
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on' });
  const linhas = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas });
  try {
    gamepad.pressionar('A', 10000);
    gamepad.moverStick('L', -100, 80, 10000);
    gamepad.acionarTrigger('R', 100, 10000);
    await sleep(20);
    gamepad.resetar(); // pânico/soltar
    assert.strictEqual(linhas[linhas.length - 1], 'RESET');
    const tamanho = linhas.length;
    await sleep(80);
    assert.strictEqual(linhas.length, tamanho); // nenhum release atrasado vaza
  } finally {
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

test('gamepad: re-agendar hold do mesmo botão substitui o timer antigo', async () => {
  gamepad.__test.restaurarSimulacao();
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on' });
  const linhas = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas });
  try {
    gamepad.pressionar('A', 10000); // hold antigo
    await sleep(20);
    gamepad.pressionar('A', 40); // hold novo substitui
    await sleep(90);
    // o timer antigo NÃO mandou B A 0 no meio; o novo mandou 1
    assert.strictEqual(linhas.filter((l) => l === 'B A 0').length, 1);
    const tamanho = linhas.length;
    await sleep(60);
    assert.strictEqual(linhas.length, tamanho);
  } finally {
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

test('gamepad: classificação de erros do worker (diagnóstico diferenciado)', () => {
  const { classificarErroWorker } = gamepad.__test;
  assert.strictEqual(classificarErroWorker('vigem_connect falhou (ViGEm 0x8007007E)').estado, 'sem-vigembus');
  assert.strictEqual(classificarErroWorker('Format of the executable is not valid').estado, 'arquitetura-errada');
  assert.strictEqual(classificarErroWorker('Unable to load DLL \'ViGEmClient.dll\'').estado, 'falha-carregamento');
  assert.strictEqual(classificarErroWorker('Não é possível carregar a DLL').estado, 'falha-carregamento');
  assert.strictEqual(classificarErroWorker('alguma coisa estranha').estado, 'falha-desconhecida');
  // status expõe estado/detalhe
  const s = gamepad.status();
  assert.ok(typeof s.estado === 'string');
  assert.ok(typeof s.detalhe === 'string');
});

// ---------------------------------------------------------------------------
// 7. Democracia: hold de mouse/pad nunca executa direto
// ---------------------------------------------------------------------------

test('democracia: hold de mouse é bloqueado (não fura o modo)', async () => {
  const gamepadIntegration = require('../gamepad-integration');
  gamepadIntegration.instalar();
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  votacao.resetar();
  votacao.definirModo('democracia', 'teste');
  try {
    handlers.processarMensagem({ plataforma: 'twitch', usuario: 'u1', usuarioId: '1', broadcaster: false, texto: 'hold clique direito 5s' });
    assert.deepStrictEqual(linhas, []); // nenhum down saiu
    assert.strictEqual(mouse.totalSegurando(), 0);
  } finally {
    votacao.resetar();
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('democracia: hold de gamepad é bloqueado (não fura o modo)', () => {
  const gamepadIntegration = require('../gamepad-integration');
  gamepadIntegration.instalar();
  gamepad.__test.restaurarSimulacao();
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on' });
  const linhas = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas });
  votacao.resetar();
  votacao.definirModo('democracia', 'teste');
  try {
    handlers.processarMensagem({ plataforma: 'twitch', usuario: 'u2', usuarioId: '2', broadcaster: false, texto: 'hold pad a 250ms' });
    assert.deepStrictEqual(linhas, []);
  } finally {
    votacao.resetar();
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

test('pipeline: hold de mouse chega ao controlador com duração efetiva (anarquia)', async () => {
  const gamepadIntegration = require('../gamepad-integration');
  gamepadIntegration.instalar();
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  try {
    handlers.processarMensagem({ plataforma: 'twitch', usuario: 'miner', usuarioId: '42', broadcaster: true, texto: 'hold clique 80ms' });
    assert.deepStrictEqual(linhas, ['DW L']);
    await sleep(140);
    assert.deepStrictEqual(linhas, ['DW L', 'UW L']);
    // default: sem duração -> holdPadraoMs (1000)
    handlers.processarMensagem({ plataforma: 'twitch', usuario: 'miner', usuarioId: '42', broadcaster: true, texto: 'hold clique' });
    assert.strictEqual(mouse.totalSegurando(), 1);
    mouse.soltarTodos();
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
  }
});

test('cooldown: chaves estáveis para hold de mouse e gamepad', () => {
  assert.strictEqual(chaveCooldownGamepad({ tipo: 'gamepad-botao', botao: 'A', hold: true }), 'hold:pad:a');
  assert.strictEqual(chaveCooldownGamepad({ tipo: 'gamepad-trigger', trigger: 'R', hold: true }), 'hold:pad:rt');
  assert.strictEqual(chaveCooldownGamepad({ tipo: 'gamepad-stick', stick: 'L', hold: true }), 'hold:pad:l');
  // taps inalterados (compat)
  assert.strictEqual(chaveCooldownGamepad({ tipo: 'gamepad-botao', botao: 'A' }), 'pad:a');
  // grupo do cooldown-config continua aplicável (hold:* -> grupo hold)
  const { normalizarChaveCooldown } = require('../utils/cooldown-config');
  assert.strictEqual(normalizarChaveCooldown('hold:mouse:left'), 'hold:mouse:left');
});

// ---------------------------------------------------------------------------
// 8. Pânico / soltar globais
// ---------------------------------------------------------------------------

test('soltar do chat libera mouse E teclado (gamepad neutralizado pelo wrapper)', async () => {
  const gamepadIntegration = require('../gamepad-integration');
  gamepadIntegration.instalar();
  mouse.configurar({ modo: 'janela', alvoExe: 'C:\\Game\\game.exe' });
  const linhas = [];
  mouse.__test.simular({ plataforma: 'win32', linhas });
  gamepad.__test.restaurarSimulacao();
  gamepad.configurarDeEnv({ GAMEPAD_ENABLED: 'on' });
  const linhasPad = [];
  gamepad.__test.simular({ plataforma: 'win32', pronto: true, linhas: linhasPad });
  try {
    mouse.segurar('left', 10000);
    gamepad.pressionar('A', 10000);
    handlers.processarMensagem({ plataforma: 'twitch', usuario: 'socorro', usuarioId: '9', broadcaster: false, texto: 'soltar' });
    assert.ok(linhas.includes('UW L'), 'mouse liberado');
    assert.ok(linhasPad.includes('RESET'), 'gamepad neutralizado');
    assert.strictEqual(mouse.totalSegurando(), 0);
    const tamanhoPad = linhasPad.length;
    await sleep(60);
    assert.strictEqual(linhasPad.length, tamanhoPad);
  } finally {
    mouse.__test.restaurar();
    mouse.configurar({ modo: 'janela', alvoExe: null });
    gamepad.__test.restaurarSimulacao();
    gamepad.configurar({ modo: 'auto' });
  }
});

// ---------------------------------------------------------------------------
// 9. Command tester: descrições com duração normalizada, sem input real
// ---------------------------------------------------------------------------

test('tester: hold de mouse mostra duração normalizada e nunca executa input', () => {
  const r = testarComando('hold clique direito 1.25s', undefined, { modoMouse: 'janela', alvoExe: 'C:\\Game\\g.exe' });
  assert.strictEqual(r.reconhecido, true);
  assert.strictEqual(r.categoria, 'mouse');
  assert.strictEqual(r.executaria, true);
  assert.ok(r.detalhes.some((d) => d.includes('1250ms')), `detalhes: ${r.detalhes.join(' | ')}`);
  assert.ok(r.resumo.includes('direito'));
  assert.ok(r.resumo.includes('1250ms'));
});

test('tester: hold de mouse com gates (off / sem alvo / democracia)', () => {
  assert.strictEqual(testarComando('hold clique 1s', undefined, { modoMouse: 'off', alvoExe: 'C:\\g.exe' }).executaria, false);
  assert.strictEqual(testarComando('hold clique 1s', undefined, { modoMouse: 'janela', alvoExe: '' }).executaria, false);
  assert.strictEqual(testarComando('hold clique 1s', undefined, { modoMouse: 'janela', alvoExe: 'C:\\g.exe', democracia: true }).executaria, false);
});

test('tester: hold de gamepad mostra duração, gatilho e centro do analógico', () => {
  const r = testarComando('hold pad a 100ms', undefined, { gamepadEnabled: 'auto' });
  assert.strictEqual(r.reconhecido, true);
  assert.strictEqual(r.categoria, 'gamepad');
  assert.strictEqual(r.executaria, true);
  assert.ok(r.detalhes.some((d) => d.includes('100ms')));

  const rt = testarComando('hold pad rt 75 1s', undefined, { gamepadEnabled: 'auto' });
  assert.strictEqual(rt.executaria, true);
  assert.ok(rt.detalhes.some((d) => d.includes('75%')));

  const ls = testarComando('hold pad ls direita 750ms', undefined, { gamepadEnabled: 'auto' });
  assert.strictEqual(ls.executaria, true);
  assert.ok(ls.detalhes.some((d) => d.includes('centro')));

  // gates
  assert.strictEqual(testarComando('hold pad a 100ms', undefined, { gamepadEnabled: 'off' }).executaria, false);
  assert.strictEqual(testarComando('hold pad a 100ms', undefined, { gamepadEnabled: 'auto', democracia: true }).executaria, false);
});

test('tester: hold de teclado mostra a duração normalizada (1ms)', () => {
  const r = testarComando('hold cima 1ms', undefined, {});
  assert.strictEqual(r.reconhecido, true);
  assert.strictEqual(r.categoria, 'teclado');
  assert.strictEqual(r.executaria, true);
  assert.ok(r.resumo.includes('1 ms') || r.resumo.includes('1ms'));
});
