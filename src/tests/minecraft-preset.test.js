const assert = require('assert');
const test = require('node:test');
const controles = require('../controles');
const { PAGINA } = require('../assistente-pagina');

test('modelo Minecraft traz controles Java padrão e aliases PT/EN', () => {
  const lista = controles.controlesPadrao('minecraft');
  assert.strictEqual(lista.length, 23);

  const porId = Object.fromEntries(lista.map((c) => [c.id, c]));
  assert.strictEqual(porId.mc_forward.key, 'w');
  assert.strictEqual(porId.mc_back.key, 's');
  assert.strictEqual(porId.mc_left.key, 'a');
  assert.strictEqual(porId.mc_right.key, 'd');
  assert.strictEqual(porId.mc_jump.key, 'space');
  assert.strictEqual(porId.mc_sneak.key, 'shift');
  assert.strictEqual(porId.mc_sprint.key, 'ctrl');
  assert.strictEqual(porId.mc_inventory.key, 'e');
  assert.strictEqual(porId.mc_drop.key, 'q');
  assert.strictEqual(porId.mc_offhand.key, 'f');
  assert.strictEqual(porId.mc_chat.key, 't');
  assert.strictEqual(porId.mc_players.key, 'tab');
  assert.strictEqual(porId.mc_menu.key, 'esc');
  assert.strictEqual(porId.mc_perspective.key, 'f5');
  assert.ok(porId.mc_forward.aliases.includes('frente'));
  assert.ok(porId.mc_forward.aliases.includes('forward'));
  assert.ok(porId.mc_jump.aliases.includes('pular'));
  assert.ok(porId.mc_jump.aliases.includes('jump'));

  for (let n = 1; n <= 9; n++) {
    assert.strictEqual(porId[`mc_slot_${n}`].key, String(n));
    assert.ok(porId[`mc_slot_${n}`].aliases.includes(`slot${n}`));
  }

  const aliases = new Set();
  for (const c of lista) {
    for (const a of c.aliases) {
      assert.ok(!aliases.has(a), `alias duplicado no modelo Minecraft: ${a}`);
      aliases.add(a);
    }
  }
});

test('assistente exibe Minecraft como modelo selecionável', () => {
  assert.match(PAGINA, /<option value="minecraft">Minecraft<\/option>/);
  assert.match(PAGINA, /minecraft: "Minecraft"/);
});
