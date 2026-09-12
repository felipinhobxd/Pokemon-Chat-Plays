from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, found {count}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')


index = 'src/index.js'
replace_once(
    index,
    """  const usarLauncherMinecraft =\n    String(config.teclado.preset || '').toLowerCase() === 'minecraft' &&\n    minecraftLauncher.ehAtLauncher(exeDoJogo);\n""",
    """  // O próprio caminho do ATLauncher é a fonte de verdade. O preset pode\n  // estar personalizado/legado; nunca trate ATLauncher.exe como o jogo real.\n  const usarLauncherMinecraft = minecraftLauncher.ehAtLauncher(exeDoJogo);\n""",
)
replace_once(
    index,
    """  const launcherMinecraftAtivo =\n    String(config.teclado.preset || '').toLowerCase() === 'minecraft' &&\n    minecraftLauncher.ehAtLauncher(exeDoJogo);\n""",
    """  // Mesmo princípio do gerenciador: ATLauncher.exe identifica o fluxo\n  // Minecraft ainda que o perfil tenha virado \"personalizado\".\n  const launcherMinecraftAtivo = minecraftLauncher.ehAtLauncher(exeDoJogo);\n""",
)

assistente = 'src/assistente.js'
replace_once(
    assistente,
    """  for (const chave of ['EMULADOR_EXE', 'JOGO_ROM']) {\n    finais[chave] = normalizarCaminhoJogo(finais[chave]);\n  }\n""",
    """  for (const chave of ['EMULADOR_EXE', 'JOGO_ROM']) {\n    finais[chave] = normalizarCaminhoJogo(finais[chave]);\n  }\n\n  // ATLauncher é um launcher de Minecraft, não um executável do jogo. Se o\n  // seletor de controles ficou \"personalizado\", não deixe o save cair em\n  // outro preset e desativar a integração no próximo boot.\n  if (require('./utils/minecraft-launcher').ehAtLauncher(finais.EMULADOR_EXE)) {\n    finais.EMULADOR_PRESET = 'minecraft';\n    finais.MODO_TECLADO = 'global';\n    finais.MODO_MOUSE = 'global';\n  }\n""",
)

pagina = 'src/assistente-pagina.js'
replace_once(
    pagina,
    """  '      var lista = \"Não foi possível salvar:\";',\n  '      for (var j = 0; j < (r.erros || []).length; j++) lista += \"\\\\n• \" + r.erros[j];',\n  '      txt(errosEl, lista);',\n""",
    """  '      var lista = \"Não foi possível salvar:\";',\n  '      var detalhes = (r.erros || []).slice();',\n  '      if (!detalhes.length && r.mensagem) detalhes.push(r.mensagem);',\n  '      if (!detalhes.length) detalhes.push(\"Erro desconhecido — confira o terminal do ChatPlays.\");',\n  '      for (var j = 0; j < detalhes.length; j++) lista += \"\\\\n• \" + detalhes[j];',\n  '      txt(errosEl, lista);',\n""",
)

Path('src/tests/atlauncher-integration.test.js').write_text(
    """'use strict';\n\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst fs = require('fs');\nconst path = require('path');\n\nfunction fonte(nome) {\n  return fs.readFileSync(path.join(__dirname, '..', nome), 'utf8');\n}\n\ntest('ATLauncher: integração não depende do preset Minecraft', () => {\n  const src = fonte('index.js');\n  assert.match(src, /const usarLauncherMinecraft = minecraftLauncher\\.ehAtLauncher\\(exeDoJogo\\);/);\n  assert.match(src, /const launcherMinecraftAtivo = minecraftLauncher\\.ehAtLauncher\\(exeDoJogo\\);/);\n  assert.doesNotMatch(src, /const usarLauncherMinecraft =[\\s\\S]{0,180}teclado\\.preset[\\s\\S]{0,180}ehAtLauncher/);\n});\n\ntest('Assistente: ATLauncher normaliza preset e input para Minecraft global', () => {\n  const src = fonte('assistente.js');\n  assert.match(src, /ehAtLauncher\\(finais\\.EMULADOR_EXE\\)/);\n  assert.match(src, /finais\\.EMULADOR_PRESET = 'minecraft'/);\n  assert.match(src, /finais\\.MODO_TECLADO = 'global'/);\n  assert.match(src, /finais\\.MODO_MOUSE = 'global'/);\n});\n\ntest('Assistente: erro de backend com mensagem nunca fica vazio na tela', () => {\n  const src = fonte('assistente-pagina.js');\n  assert.match(src, /if \\(!detalhes\\.length && r\\.mensagem\\) detalhes\\.push\\(r\\.mensagem\\)/);\n});\n""",
    encoding='utf-8',
)
