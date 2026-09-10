/**
 * Testes do controlador de teclado (src/controllers/keyboard.js).
 * Roda com: npm test  (usa o node:test nativo — zero dependências)
 *
 * ⚠️ REGRESSÃO da v2.2.2: as SETAS pressionavam o TECLADO NUMÉRICO no
 * Windows em vez das setas de verdade. Causa: o keybd_event era chamado sem
 * a flag KEYEVENTF_EXTENDEDKEY (0x01) — no Windows, VK_UP e o "8" do numpad
 * (Num Lock desligado) são a MESMA tecla virtual; quem decide qual das duas
 * foi pressionada é justamente essa flag. Estes testes garantem que as setas
 * (e as demais teclas estendidas) sempre carregam a flag, no keydown E no
 * keyup, em TODOS os caminhos que geram script PowerShell.
 */

const test = require('node:test');
const assert = require('node:assert');
const { MAPEAMENTO_PADRAO, __test } = require('../controllers/keyboard');

const { vkWindows, keycodeMac, nomeXdotool, flagsKeybd, linhaKey, linhaTap, scriptWindows, VK_ESTENDIDOS, resolverTecla } = __test;
const tecladoModulo = require('../controllers/keyboard');

// ---------------------------------------------------------------------------
// VK codes das teclas usadas pelo mapeamento padrão
// ---------------------------------------------------------------------------

test('mapeamento padrão: todas as teclas (ou combos) resolvem nos 3 backends', () => {
  for (const [botao, tecla] of Object.entries(MAPEAMENTO_PADRAO)) {
    const combo = resolverTecla(tecla);
    assert.notStrictEqual(combo, null, `tecla "${tecla}" (botão ${botao}) deveria resolver`);
    // a tecla principal do combo precisa ter VK code válido
    const vk = vkWindows(combo.tecla);
    assert.ok(Number.isInteger(vk) && vk > 0, `VK de "${combo.tecla}" inválido: ${vk}`);
    // os modificadores também
    for (const m of combo.modificadores) {
      const vm = vkWindows(m);
      assert.ok(Number.isInteger(vm) && vm > 0, `VK do modificador "${m}" inválido: ${vm}`);
    }
  }
});

test('mapeamento padrão v2.5: salvar/carregar são combos de savestate', () => {
  assert.deepStrictEqual(resolverTecla(MAPEAMENTO_PADRAO.salvar), { modificadores: ['shift'], tecla: 'f5' });
  assert.deepStrictEqual(resolverTecla(MAPEAMENTO_PADRAO.carregar), { modificadores: [], tecla: 'f5' });
});

test('setas convertem para os VK codes corretos do Windows', () => {
  assert.strictEqual(vkWindows('up'), 0x26, 'up -> VK_UP (0x26)');
  assert.strictEqual(vkWindows('down'), 0x28, 'down -> VK_DOWN (0x28)');
  assert.strictEqual(vkWindows('left'), 0x25, 'left -> VK_LEFT (0x25)');
  assert.strictEqual(vkWindows('right'), 0x27, 'right -> VK_RIGHT (0x27)');
});

// ---------------------------------------------------------------------------
// REGRESSÃO v2.2.2: setas apertavam o teclado numérico
// ---------------------------------------------------------------------------

test('setas ganham KEYEVENTF_EXTENDEDKEY no keydown E no keyup', () => {
  // down = 0x01 (EXTENDEDKEY)          up = 0x03 (EXTENDEDKEY | KEYUP)
  assert.strictEqual(flagsKeybd(0x26, true), 0x01, 'VK_UP down -> flags 1');
  assert.strictEqual(flagsKeybd(0x26, false), 0x03, 'VK_UP up -> flags 3');
  assert.strictEqual(flagsKeybd(0x28, true), 0x01, 'VK_DOWN down -> flags 1');
  assert.strictEqual(flagsKeybd(0x28, false), 0x03, 'VK_DOWN up -> flags 3');
  assert.strictEqual(flagsKeybd(0x25, true), 0x01, 'VK_LEFT down -> flags 1');
  assert.strictEqual(flagsKeybd(0x25, false), 0x03, 'VK_LEFT up -> flags 3');
  assert.strictEqual(flagsKeybd(0x27, true), 0x01, 'VK_RIGHT down -> flags 1');
  assert.strictEqual(flagsKeybd(0x27, false), 0x03, 'VK_RIGHT up -> flags 3');
});

test('teclas comuns NÃO ganham a flag estendida (flags 0/2, como sempre)', () => {
  assert.strictEqual(flagsKeybd(0x58, true), 0x00, 'X (A do emulador) down -> flags 0');
  assert.strictEqual(flagsKeybd(0x58, false), 0x02, 'X up -> flags 2');
  assert.strictEqual(flagsKeybd(0x5a, true), 0x00, 'Z (B) down -> flags 0');
  assert.strictEqual(flagsKeybd(0x0d, true), 0x00, 'Enter (Start) down -> flags 0');
  assert.strictEqual(flagsKeybd(0x08, false), 0x02, 'Backspace (Select) up -> flags 2');
  assert.strictEqual(flagsKeybd(0x20, false), 0x02, 'Space up -> flags 2');
});

test('lista de VK estendidos cobre setas + navegação e exclui letras/dígitos', () => {
  const setas = [0x25, 0x26, 0x27, 0x28];
  for (const vk of setas) {
    assert.ok(VK_ESTENDIDOS.has(vk), `VK 0x${vk.toString(16)} (seta) deveria ser estendido`);
  }
  for (const vk of [0x21, 0x22, 0x23, 0x24, 0x2d, 0x2e]) {
    assert.ok(VK_ESTENDIDOS.has(vk), `VK 0x${vk.toString(16)} (navegação) deveria ser estendido`);
  }
  // VK de letras = char code MAIÚSCULO (vkWindows usa toUpperCase); dígitos
  // da fileira de cima e teclas de controle nunca são estendidos.
  const comuns = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => c.charCodeAt(0))
    .concat([...'0123456789'].map((c) => c.charCodeAt(0)), [0x0d, 0x08, 0x09, 0x1b, 0x20]);
  for (const vk of comuns) {
    assert.ok(!VK_ESTENDIDOS.has(vk), `VK 0x${vk.toString(16)} NÃO deveria ser estendido`);
  }
});

// ---------------------------------------------------------------------------
// Linhas PowerShell do worker residente (linhaKey / linhaTap)
// ---------------------------------------------------------------------------

test('linhaKey das setas contém as flags estendidas na chamada real', () => {
  const down = linhaKey(0x26, true);
  const up = linhaKey(0x26, false);
  assert.match(down, /keybd_event\(38,\[KB\]::MapVirtualKey\(38,0\),1,\[UIntPtr\]::Zero\)/,
    'keydown da seta precisa chamar com flags=1 (EXTENDEDKEY)');
  assert.match(up, /keybd_event\(38,\[KB\]::MapVirtualKey\(38,0\),3,\[UIntPtr\]::Zero\)/,
    'keyup da seta precisa chamar com flags=3 (EXTENDEDKEY|KEYUP) — sem isso a tecla fica PRESA');
});

test('linhaKey de letra comum segue com flags 0/2', () => {
  assert.match(linhaKey(0x58, true), /keybd_event\(88,\[KB\]::MapVirtualKey\(88,0\),0,/);
  assert.match(linhaKey(0x58, false), /keybd_event\(88,\[KB\]::MapVirtualKey\(88,0\),2,/);
});

test('linhaTap da seta: down com flag 1 → sleep → up com flag 3, nessa ordem', () => {
  const tap = linhaTap(0x25, 100); // left
  const idxDown = tap.indexOf('keybd_event(37,[KB]::MapVirtualKey(37,0),1,');
  const idxSleep = tap.indexOf('[System.Threading.Thread]::Sleep(100)');
  const idxUp = tap.indexOf('keybd_event(37,[KB]::MapVirtualKey(37,0),3,');
  assert.ok(idxDown >= 0, 'tap da seta deve começar com keydown estendido (flags 1)');
  assert.ok(idxSleep > idxDown, 'sleep deve vir DEPOIS do keydown (bug da v2.2.0)');
  assert.ok(idxUp > idxSleep, 'keyup estendido (flags 3) deve vir por último');
});

// ---------------------------------------------------------------------------
// Script PowerShell do modo compatível / encerramento (scriptWindows)
// ---------------------------------------------------------------------------

test('scriptWindows: tap de seta usa flags estendidas e sleep entre down e up', () => {
  const script = scriptWindows([{ vk: 0x26, down: true }, { vk: 0x26, down: false }], 120);
  const idxDown = script.indexOf('keybd_event(38,[KB]::MapVirtualKey(38,0),1,');
  const idxSleep = script.indexOf('Start-Sleep -Milliseconds 120');
  const idxUp = script.indexOf('keybd_event(38,[KB]::MapVirtualKey(38,0),3,');
  assert.ok(idxDown >= 0, 'keydown com EXTENDEDKEY (flags 1) no script legado');
  assert.ok(idxSleep > idxDown, 'sleep entre down e up (regressão da v2.2.0)');
  assert.ok(idxUp > idxSleep, 'keyup com EXTENDEDKEY|KEYUP (flags 3) por último');
});

test('scriptWindows: soltar setas no encerramento usa flags 3 (estende + keyup)', () => {
  // caminho do soltarTodasSync — soltar sem a flag certa deixaria a seta PRESA
  const script = scriptWindows([{ vk: 0x25, down: false }, { vk: 0x28, down: false }]);
  assert.match(script, /keybd_event\(37,\[KB\]::MapVirtualKey\(37,0\),3,/);
  assert.match(script, /keybd_event\(40,\[KB\]::MapVirtualKey\(40,0\),3,/);
});

test('scriptWindows: teclas comuns seguem com flags 0/2 no modo legado', () => {
  const script = scriptWindows([{ vk: 0x58, down: true }, { vk: 0x58, down: false }], 50);
  assert.match(script, /keybd_event\(88,\[KB\]::MapVirtualKey\(88,0\),0,/);
  assert.match(script, /keybd_event\(88,\[KB\]::MapVirtualKey\(88,0\),2,/);
});

// ---------------------------------------------------------------------------
// Coerência: cada botão do jogo gera a linha certa
// ---------------------------------------------------------------------------

test('os 4 direcionais do mapeamento padrão geram toques estendidos de ponta a ponta', () => {
  const casos = [
    ['up', 38],
    ['down', 40],
    ['left', 37],
    ['right', 39],
  ];
  for (const [tecla, vk] of casos) {
    const convertido = vkWindows(tecla);
    assert.strictEqual(convertido, vk, `"${tecla}" -> VK ${vk}`);
    const tap = linhaTap(convertido, 50);
    assert.match(tap, new RegExp(`keybd_event\\(${vk},\\[KB\\]::MapVirtualKey\\(${vk},0\\),1,`),
      `tap de "${tecla}" com keydown estendido`);
    assert.match(tap, new RegExp(`keybd_event\\(${vk},\\[KB\\]::MapVirtualKey\\(${vk},0\\),3,`),
      `tap de "${tecla}" com keyup estendido`);
  }
});

// ---------------------------------------------------------------------------
// v2.3: teclas customizáveis (TECLA_*) — suporte multi-backend
// ---------------------------------------------------------------------------

test('teclaSuportada aceita setas, letras, dígitos e teclas nomeadas', () => {
  const aceitas = ['up', 'down', 'left', 'right', 'enter', 'backspace', 'space', 'tab', 'esc', 'shift', 'a', 'q', 'z', '5'];
  for (const tecla of aceitas) {
    assert.ok(tecladoModulo.teclaSuportada(tecla), `"${tecla}" deveria ser suportada nos 3 backends`);
  }
});

test('teclaSuportada aceita F1-F12 (savestates, v2.5)', () => {
  for (let i = 1; i <= 12; i++) {
    assert.ok(tecladoModulo.teclaSuportada(`f${i}`), `"f${i}" deveria ser suportada (savestate do emulador)`);
  }
  // maiúsculas também (o resolver normaliza)
  assert.ok(tecladoModulo.teclaSuportada('F5'));
});

test('teclaSuportada aceita COMBOS com modificadores (v2.5)', () => {
  assert.ok(tecladoModulo.teclaSuportada('shift+f5'), 'shift+f5 (salvar do VBA-M)');
  assert.ok(tecladoModulo.teclaSuportada('ctrl+alt+f2'), 'ctrl+alt+f2');
  assert.ok(tecladoModulo.teclaSuportada('Shift+F5'), 'normalização de maiúsculas');
  assert.ok(tecladoModulo.teclaSuportada('shift + f5'), 'espaços em volta do +');
});

test('teclaSuportada rejeita lixo, combos inválidos e teclas desconhecidas', () => {
  const rejeitadas = [
    'cima', 'seta', 'xyz', 'f13', 'enter2', '', null, undefined,
    'shift+shift', // modificador como tecla principal do combo
    'a+b', // "a" não é modificador
    'shift+f13', // tecla principal desconhecida
    '+f5', 'shift+', '++',
  ];
  for (const tecla of rejeitadas) {
    assert.ok(!tecladoModulo.teclaSuportada(tecla), `"${tecla}" NÃO deveria passar como tecla`);
  }
});

test('shift funciona nos 3 backends (DeSmuME/RetroArch usam no Select)', () => {
  assert.strictEqual(vkWindows('shift'), 0x10, 'VK_SHIFT');
  assert.strictEqual(keycodeMac('shift'), 56, 'keycode macOS');
  assert.strictEqual(nomeXdotool('shift'), 'Shift_L', 'keysym Linux');
});
