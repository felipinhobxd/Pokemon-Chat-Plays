const test = require('node:test');
const assert = require('node:assert');
const { __test } = require('../controllers/save-guard');

const {
  vkWindows,
  normalizarEspec,
  corrigirEspecPerigosa,
  resolverCombo,
  montarScriptSeguro,
} = __test;

test('SaveGuard normaliza combos sem trocar sua semântica', () => {
  assert.strictEqual(normalizarEspec(' Shift + F5 '), 'shift+f5');
  assert.strictEqual(vkWindows('f5'), 0x74);
  assert.strictEqual(vkWindows('shift'), 0x10);
});

test('SaveGuard corrige save/load perigosamente mapeados na mesma F-key', () => {
  assert.strictEqual(corrigirEspecPerigosa('f5', 'f5'), 'shift+f5');
  assert.strictEqual(corrigirEspecPerigosa('F3', ' f3 '), 'shift+f3');
});

test('SaveGuard preserva mapeamentos distintos legítimos', () => {
  assert.strictEqual(corrigirEspecPerigosa('shift+f5', 'f5'), 'shift+f5');
  assert.strictEqual(corrigirEspecPerigosa('f2', 'f4'), 'f2');
});

test('SaveGuard resolve modificadores e tecla principal do combo de salvar', () => {
  assert.deepStrictEqual(resolverCombo('shift+f5'), {
    mods: ['shift'],
    tecla: 'f5',
    vksMods: [0x10],
    vkTecla: 0x74,
  });
  assert.deepStrictEqual(resolverCombo('ctrl+alt+f2'), {
    mods: ['ctrl', 'alt'],
    tecla: 'f2',
    vksMods: [0x11, 0x12],
    vkTecla: 0x71,
  });
});

test('SaveGuard envia F5 somente para a janela e mantém o modificador no estado real do Windows', () => {
  const combo = resolverCombo('shift+f5');
  const script = montarScriptSeguro('C:\\Emuladores\\vbam.exe', combo, 120);

  assert.ok(script.includes('keybd_event'), 'modificador precisa alterar o estado real do teclado');
  assert.ok(script.includes('SendMessage'), 'teclas precisam ser entregues sincronamente ao emulador');
  assert.ok(script.includes('$mods = [int[]]@(16)'), 'Shift precisa ser o modificador do save');
  assert.ok(script.includes(', 116, 120)'), 'F5 precisa ser a tecla principal por 120ms');
  assert.ok(script.includes('finally'), 'modificadores precisam ser soltos mesmo se o save falhar');
  assert.ok(!script.includes('Global(116'), 'F5 nunca pode ser injetado globalmente pelo caminho protegido');
});

test('SaveGuard escapa apóstrofo no caminho do emulador', () => {
  const script = montarScriptSeguro("C:\\Emu's\\vba.exe", resolverCombo('shift+f5'), 120);
  assert.ok(script.includes("C:\\Emu''s\\vba.exe"));
});
