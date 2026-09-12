from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')


minecraft_block = r'''

// ---------------------------------------------------------------------------
// Modelo Minecraft (Java Edition — teclas padrão)
// ---------------------------------------------------------------------------

/**
 * Controles prontos para Minecraft. Mouse continua usando os comandos globais
 * do ChatPlays (clique/clique direito e HOLD), então o modelo cobre aqui as
 * ações de teclado sem duplicar o parser de mouse.
 */
const CONTROLES_MINECRAFT = [
  { id: 'mc_forward', label: 'Frente', icone: '⬆', key: 'w', aliases: ['frente', 'forward', 'w'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_back', label: 'Trás', icone: '⬇', key: 's', aliases: ['tras', 'back', 's'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_left', label: 'Esquerda', icone: '⬅', key: 'a', aliases: ['esquerda', 'left', 'a'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_right', label: 'Direita', icone: '➡', key: 'd', aliases: ['direita', 'right', 'd'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_jump', label: 'Pular', icone: '⤴', key: 'space', aliases: ['pular', 'jump', 'space', 'espaco'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_sneak', label: 'Agachar', icone: '🧎', key: 'shift', aliases: ['agachar', 'sneak', 'shift'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_sprint', label: 'Correr', icone: '🏃', key: 'ctrl', aliases: ['correr', 'sprint', 'ctrl'], holdable: true, builtin: false, enabled: true },
  { id: 'mc_inventory', label: 'Inventário', icone: '🎒', key: 'e', aliases: ['inventario', 'inventory', 'e'], holdable: false, builtin: false, enabled: true },
  { id: 'mc_drop', label: 'Dropar', icone: '📦', key: 'q', aliases: ['dropar', 'drop', 'q'], holdable: false, builtin: false, enabled: true },
  { id: 'mc_offhand', label: 'Mão secundária', icone: '🤚', key: 'f', aliases: ['mao secundaria', 'offhand', 'f'], holdable: false, builtin: false, enabled: true },
  { id: 'mc_chat', label: 'Chat', icone: '💬', key: 't', aliases: ['chat', 't'], holdable: false, builtin: false, enabled: true },
  { id: 'mc_players', label: 'Jogadores', icone: '👥', key: 'tab', aliases: ['jogadores', 'players', 'tab'], holdable: false, builtin: false, enabled: true },
  { id: 'mc_menu', label: 'Menu', icone: '⏸', key: 'esc', aliases: ['menu', 'escape', 'esc'], holdable: false, builtin: false, enabled: true },
  { id: 'mc_perspective', label: 'Perspectiva', icone: '👁', key: 'f5', aliases: ['perspectiva', 'perspective', 'f5'], holdable: false, builtin: false, enabled: true },
  ...Array.from({ length: 9 }, (_, i) => {
    const n = i + 1;
    return {
      id: `mc_slot_${n}`,
      label: `Slot ${n}`,
      icone: `#${n}`,
      key: String(n),
      aliases: [`slot ${n}`, `slot${n}`, String(n)],
      holdable: false,
      builtin: false,
      enabled: true,
    };
  }),
];

function controlesMinecraft() {
  return CONTROLES_MINECRAFT.map((c) => ({ ...c, aliases: [...c.aliases] }));
}
'''

replace_once(
    'src/controles.js',
    "const IDS_BUILTIN = new Set(BUILTINS.map((b) => b.id));\n",
    "const IDS_BUILTIN = new Set(BUILTINS.map((b) => b.id));" + minecraft_block + "\n",
)

replace_once(
    'src/controles.js',
    "function controlesPadrao(nomePreset, overrides) {\n  const { mapa } = montarMapeamento(\n",
    "function controlesPadrao(nomePreset, overrides) {\n  const solicitado = nomePreset !== undefined ? nomePreset : config.teclado.preset;\n  if (String(solicitado || '').toLowerCase().replace(/[^a-z]/g, '') === 'minecraft') {\n    return controlesMinecraft();\n  }\n\n  const { mapa } = montarMapeamento(\n",
)

replace_once(
    'src/assistente.js',
    "    // modelos (VBA-M/mGBA/DeSmuME/RetroArch) como listas prontas — o wizard\n",
    "    // modelos (VBA-M/mGBA/DeSmuME/RetroArch/Minecraft) como listas prontas — o wizard\n",
)
replace_once(
    'src/assistente.js',
    "      retroarch: controles.controlesPadrao('retroarch'),\n    },\n",
    "      retroarch: controles.controlesPadrao('retroarch'),\n      minecraft: controles.controlesPadrao('minecraft'),\n    },\n",
)
replace_once(
    'src/assistente.js',
    '# Modelo INICIAL dos controles (vbam, mgba, desmume, retroarch).',
    '# Modelo INICIAL dos controles (vbam, mgba, desmume, retroarch, minecraft).',
)

replace_once(
    'src/assistente-pagina.js',
    "  '          <option value=\"retroarch\">RetroArch</option>',\n  '          <option value=\"personalizado\" disabled>Personalizado (editado)</option>',",
    "  '          <option value=\"retroarch\">RetroArch</option>',\n  '          <option value=\"minecraft\">Minecraft</option>',\n  '          <option value=\"personalizado\" disabled>Personalizado (editado)</option>',",
)
replace_once(
    'src/assistente-pagina.js',
    "  '  var nomes = { vbam: \"VBA-M\", mgba: \"mGBA\", desmume: \"DeSmuME\", retroarch: \"RetroArch\" };',",
    "  '  var nomes = { vbam: \"VBA-M\", mgba: \"mGBA\", desmume: \"DeSmuME\", retroarch: \"RetroArch\", minecraft: \"Minecraft\" };',",
)
replace_once(
    'src/assistente-pagina.js',
    "  '    if ([\"vbam\",\"mgba\",\"desmume\",\"retroarch\"].indexOf(modeloEnv) === -1) modeloEnv = \"vbam\";',",
    "  '    if ([\"vbam\",\"mgba\",\"desmume\",\"retroarch\",\"minecraft\"].indexOf(modeloEnv) === -1) modeloEnv = \"vbam\";',",
)
replace_once(
    'src/assistente-pagina.js',
    "  '  var personalizado = EDITOU_CONTROLES || ORIGEM_CONTROLES === \"arquivo\" || !CONTROLES.length;',",
    "  '  var modeloAtual = sel.value !== \"personalizado\" ? MODELOS[sel.value] : null;',\n  '  var igualAoModelo = Array.isArray(modeloAtual) && JSON.stringify(CONTROLES) === JSON.stringify(modeloAtual);',\n  '  var personalizado = EDITOU_CONTROLES || (!igualAoModelo && (ORIGEM_CONTROLES === \"arquivo\" || !CONTROLES.length));',",
)

env = Path('.env.example')
s = env.read_text(encoding='utf-8')
s = s.replace('vbam, mgba, desmume, retroarch', 'vbam, mgba, desmume, retroarch, minecraft')
env.write_text(s, encoding='utf-8')

Path('src/tests/minecraft-preset.test.js').write_text(r'''const assert = require('assert');
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
''', encoding='utf-8')
