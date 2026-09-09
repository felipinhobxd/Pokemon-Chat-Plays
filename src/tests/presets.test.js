/**
 * Testes dos presets de emulador e mapeamento customizável (src/presets.js).
 * Garante que trocar EMULADOR_PRESET / TECLA_* no .env produz exatamente
 * o mapeamento esperado — sem quebrar os padrões do VBA-M.
 */

const test = require('node:test');
const assert = require('node:assert');
const { PRESETS, BOTOES_REMAPEAVEIS, montarMapeamento, normalizarPreset } = require('../presets');
const { MAPEAMENTO_PADRAO } = require('../controllers/keyboard');

test('preset padrão (vbam) é idêntico ao mapeamento padrão do teclado', () => {
  const { mapa, preset, presetDesconhecido } = montarMapeamento('vbam', {});
  assert.strictEqual(preset, 'vbam');
  assert.strictEqual(presetDesconhecido, false);
  assert.deepStrictEqual(mapa, MAPEAMENTO_PADRAO);
});

test('nomes de preset são normalizados ("VBA-M" -> "vbam", "mGBA" -> "mgba")', () => {
  assert.strictEqual(normalizarPreset('VBA-M'), 'vbam');
  assert.strictEqual(normalizarPreset('mGBA'), 'mgba');
  assert.strictEqual(normalizarPreset('DeSmuME'), 'desmume');
  assert.strictEqual(normalizarPreset('RetroArch'), 'retroarch');
  assert.strictEqual(normalizarPreset('  '), '');
});

test('todos os emuladores conhecidos montam mapeamento completo', () => {
  for (const nome of ['vbam', 'mgba', 'desmume', 'retroarch']) {
    const { mapa, preset, presetDesconhecido } = montarMapeamento(nome, {});
    assert.strictEqual(preset, nome, `preset ${nome} deveria resolver`);
    assert.strictEqual(presetDesconhecido, false);
    for (const botao of BOTOES_REMAPEAVEIS) {
      assert.ok(mapa[botao], `preset ${nome} deveria mapear "${botao}"`);
    }
  }
});

test('DeSmuME e RetroArch usam L=Q, R=W, Select=Shift (padrão deles)', () => {
  for (const nome of ['desmume', 'retroarch']) {
    const { mapa } = montarMapeamento(nome, {});
    assert.strictEqual(mapa.l, 'q');
    assert.strictEqual(mapa.r, 'w');
    assert.strictEqual(mapa.select, 'shift');
    assert.strictEqual(mapa.a, 'x');
    assert.strictEqual(mapa.b, 'z');
    assert.strictEqual(mapa.start, 'enter');
  }
});

test('TECLA_* sobrescreve o preset e é normalizada para minúsculo', () => {
  const { mapa, sobrescritas } = montarMapeamento('vbam', { a: 'Q', start: 'tab' });
  assert.strictEqual(mapa.a, 'q', 'tecla custom deve vir minúscula');
  assert.strictEqual(mapa.start, 'tab');
  assert.strictEqual(sobrescritas, 2);
  // o resto vem do preset
  assert.strictEqual(mapa.b, 'z');
  assert.strictEqual(mapa.up, 'up');
});

test('overrides vazios/nulos são ignorados', () => {
  const { mapa, sobrescritas } = montarMapeamento('vbam', { a: '', b: null, l: '   ' });
  assert.strictEqual(mapa.a, 'x');
  assert.strictEqual(mapa.b, 'z');
  assert.strictEqual(sobrescritas, 0);
});

test('preset desconhecido cai no VBA-M e sinaliza', () => {
  const { mapa, preset, presetDesconhecido } = montarMapeamento('citrus', {});
  assert.strictEqual(preset, 'vbam');
  assert.strictEqual(presetDesconhecido, true);
  assert.deepStrictEqual(mapa, MAPEAMENTO_PADRAO);
});

test('todos os mapeamentos usam teclas suportadas pelos 3 backends', () => {
  const teclado = require('../controllers/keyboard');
  for (const nome of Object.keys(PRESETS)) {
    const { mapa } = montarMapeamento(nome, {});
    for (const [botao, tecla] of Object.entries(mapa)) {
      assert.ok(
        teclado.teclaSuportada(tecla),
        `preset ${nome}: tecla "${tecla}" (botão ${botao}) deve ser suportada em Windows/Linux/macOS`
      );
    }
  }
});
