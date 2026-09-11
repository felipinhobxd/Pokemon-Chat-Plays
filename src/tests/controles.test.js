/**
 * Testes do REGISTRO de controles do chat (src/controles.js) — v2.9.
 *
 * Cobre: lista padrão idêntica ao sistema antigo (compatibilidade .env),
 * edição/adição de controles, persistência (save → restart), geração
 * automática de aliases, normalização de acentos, conflitos, palavras
 * reservadas, validação de tecla, hold de controles personalizados e
 * votação (democracia) com controles personalizados.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// diretório isolado para o controles.json desta suíte
const DIR_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-controles-'));
process.env.CONTROLES_ARQUIVO = path.join(DIR_TMP, 'controles.json');

const controles = require('../controles');
const { parseComando } = require('../commands');
const votacao = require('../utils/votacao');

test.after(() => {
  try { fs.rmSync(DIR_TMP, { recursive: true, force: true }); } catch { /* ignora */ }
  controles.restaurarPadrao();
});

// ---------------------------------------------------------------------------
// Lista padrão — compatibilidade total com as versões <= 2.8
// ---------------------------------------------------------------------------

test('padrão: 12 controles embutidos ativos com os aliases clássicos', () => {
  controles.restaurarPadrao();
  const ativos = controles.ativos();
  assert.strictEqual(ativos.length, 12);

  const aliasEsperados = {
    up: ['up', 'cima', 'subir', 'sobe'],
    down: ['down', 'baixo', 'descer', 'desce'],
    left: ['left', 'esquerda', 'esq'],
    right: ['right', 'direita', 'dir'],
    a: ['a'],
    b: ['b'],
    l: ['l'],
    r: ['r'],
    start: ['start'],
    select: ['select', 'seleciona', 'selecionar'],
    salvar: ['salvar', 'salva', 'save'],
    carregar: ['carregar', 'carrega', 'load'],
  };
  for (const c of ativos) {
    assert.deepStrictEqual(c.aliases, aliasEsperados[c.id], `aliases de ${c.id} mudaram`);
    assert.strictEqual(c.enabled, true);
    assert.strictEqual(c.builtin, true);
  }
});

test('padrão: teclas vêm do preset (vbam) — mapa do teclado clássico', () => {
  controles.restaurarPadrao();
  const mapa = controles.mapaTeclado();
  assert.strictEqual(mapa.a, 'x');
  assert.strictEqual(mapa.b, 'z');
  assert.strictEqual(mapa.start, 'enter');
  assert.strictEqual(mapa.select, 'backspace');
  assert.strictEqual(mapa.salvar, 'shift+f5');
  assert.strictEqual(mapa.carregar, 'f5');
  assert.strictEqual(mapa.up, 'up');
});

test('padrão: TECLA_* do .env continua sendo respeitada (compat v2.3+)', () => {
  // simula um .env com override de duas teclas
  const lista = controles.controlesPadrao('vbam', { a: 'q', start: 'tab' });
  controles.__definirLista(lista);
  try {
    assert.strictEqual(controles.mapaTeclado().a, 'q', 'TECLA_A=q deveria valer');
    assert.strictEqual(controles.mapaTeclado().start, 'tab', 'TECLA_START=tab deveria valer');
    assert.strictEqual(controles.mapaTeclado().b, 'z', 'o resto segue o preset');
    // e o parser continua entendendo 'a' (a palavra não mudou, só a tecla)
    assert.deepStrictEqual(parseComando('a'), { tipo: 'botao', botao: 'a' });
  } finally {
    controles.restaurarPadrao();
  }
});

test('padrão: salvar/carregar não são seguráveis; combos também não', () => {
  controles.restaurarPadrao();
  assert.strictEqual(controles.ehSeguravel('salvar'), false);
  assert.strictEqual(controles.ehSeguravel('carregar'), false);
  assert.strictEqual(controles.ehSeguravel('up'), true);
  // "hold salvar" vira toque (comportamento das versões antigas preservado)
  assert.deepStrictEqual(parseComando('hold salvar'), { tipo: 'botao', botao: 'salvar' });
});

// ---------------------------------------------------------------------------
// Edição e adição de controles
// ---------------------------------------------------------------------------

test('EDITAR botão existente: trocar tecla e palavras vale na hora', () => {
  const lista = controles.validarLista(
    controles.todos().map((c) => (c.id === 'a' ? { ...c, key: 'q', aliases: ['alpha', 'confirmar'] } : c))
  );
  assert.strictEqual(lista.ok, true, lista.erros);
  controles.__definirLista(lista.lista);
  try {
    assert.strictEqual(controles.mapaTeclado().a, 'q');
    assert.deepStrictEqual(parseComando('alpha'), { tipo: 'botao', botao: 'a' });
    assert.deepStrictEqual(parseComando('confirmar'), { tipo: 'botao', botao: 'a' });
    // a palavra antiga foi substituída (o streamer EDITOU, não somou)
    assert.strictEqual(parseComando('a'), null);
    // os outros controles seguem intactos
    assert.deepStrictEqual(parseComando('cima'), { tipo: 'botao', botao: 'up' });
  } finally {
    controles.restaurarPadrao();
  }
});

test('ADICIONAR controle personalizado (Minecraft) funciona sem tocar em código', () => {
  const res = controles.validarLista([
    ...controles.todos(),
    { label: 'Pular', key: 'space', aliases: ['pular', 'pulo', 'jump'] },
    { label: 'Inventário', key: 'e', aliases: ['inventario', 'inventory', 'e'] },
    { label: 'Agachar', key: 'shift', aliases: ['agachar', 'crouch', 'shift'] },
  ]);
  assert.strictEqual(res.ok, true, res.erros);
  controles.__definirLista(res.lista);
  try {
    assert.deepStrictEqual(parseComando('pular'), { tipo: 'botao', botao: 'pular' });
    assert.deepStrictEqual(parseComando('jump'), { tipo: 'botao', botao: 'pular' });
    assert.deepStrictEqual(parseComando('inventário'), { tipo: 'botao', botao: 'inventario' });
    assert.deepStrictEqual(parseComando('inventory'), { tipo: 'botao', botao: 'inventario' });
    assert.deepStrictEqual(parseComando('agachar'), { tipo: 'botao', botao: 'agachar' });
    // mapa do teclado ganhou as techas custom
    const mapa = controles.mapaTeclado();
    assert.strictEqual(mapa.pular, 'space');
    assert.strictEqual(mapa.inventario, 'e');
    assert.strictEqual(mapa.agachar, 'shift');
    // metadados p/ overlay/stats
    const meta = controles.meta('pular');
    assert.strictEqual(meta.rotulo, 'PULAR');
    assert.strictEqual(meta.holdable, true);
  } finally {
    controles.restaurarPadrao();
  }
});

test('controle DESATIVADO sai do parser, do mapa e das mensagens', () => {
  const lista = controles.todos().map((c) => (c.id === 'start' ? { ...c, enabled: false } : c));
  controles.__definirLista(lista);
  try {
    assert.strictEqual(parseComando('start'), null);
    assert.strictEqual(controles.mapaTeclado().start, undefined);
    assert.ok(!controles.ativos().some((c) => c.id === 'start'));
    // religar volta a funcionar
    const religado = controles.todos().map((c) => (c.id === 'start' ? { ...c, enabled: true } : c));
    controles.__definirLista(religado);
    assert.deepStrictEqual(parseComando('start'), { tipo: 'botao', botao: 'start' });
  } finally {
    controles.restaurarPadrao();
  }
});

// ---------------------------------------------------------------------------
// Geração automática de aliases
// ---------------------------------------------------------------------------

test('aliases automáticos: space → space, espaco, barra de espaco (+ label)', () => {
  assert.deepStrictEqual(controles.gerarAliases('space', 'Pular'), [
    'pular',
    'space',
    'espaco',
    'barra de espaco',
  ]);
});

test('aliases automáticos: setas ganham PT e EN', () => {
  assert.deepStrictEqual(controles.gerarAliases('up', 'Frente'), ['frente', 'up', 'cima']);
  assert.deepStrictEqual(controles.gerarAliases('down', 'Trás'), ['tras', 'down', 'baixo']);
  assert.deepStrictEqual(controles.gerarAliases('left', 'Esquerda'), ['esquerda', 'left']);
});

test('aliases automáticos: esc vira esc+escape; enter fica enter', () => {
  assert.deepStrictEqual(controles.gerarAliases('esc', 'Menu'), ['menu', 'esc', 'escape']);
  assert.deepStrictEqual(controles.gerarAliases('enter', 'Confirmar'), ['confirmar', 'enter']);
});

test('aliases automáticos: letras e números geram só eles (l → l, e → e, 1 → 1)', () => {
  assert.deepStrictEqual(controles.gerarAliases('l', 'L'), ['l']);
  assert.deepStrictEqual(controles.gerarAliases('e', 'E'), ['e']);
  assert.deepStrictEqual(controles.gerarAliases('1', 'Ataque 1'), ['ataque 1', '1']);
});

test('aliases automáticos: COMBO não inventa palavras — só o label', () => {
  assert.deepStrictEqual(controles.gerarAliases('shift+f5', 'Salvar rápido'), ['salvar rapido']);
  assert.deepStrictEqual(controles.gerarAliases('ctrl+f5', ''), []);
});

test('aliases automáticos: palavras reservadas nunca são geradas', () => {
  // label que slugifica para palavra do sistema não gera alias dela
  assert.deepStrictEqual(controles.gerarAliases('x', 'Soltar'), ['x']);
  assert.deepStrictEqual(controles.gerarAliases('x', 'Hold'), ['x']);
});

// ---------------------------------------------------------------------------
// Normalização (acentos, caixa, espaços, duplicatas)
// ---------------------------------------------------------------------------

test('normalização: espaço ≡ espaco, maiúsculas e espaços extras somem', () => {
  const res = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['  Espaço ', 'ESPACO', 'espaço', 'Pular'] },
  ]);
  // tudo colapsa em 'espaco' e 'pular' (duplicatas removidas, ordem preservada)
  const c = res.lista.find((x) => x.id === 'pular');
  assert.deepStrictEqual(c.aliases, ['espaco', 'pular']);
});

test('normalização: o chat pode digitar COM acento e sem acento', () => {
  controles.__definirLista(controles.validarLista([{ label: 'Inventário', key: 'e', aliases: ['inventário'] }]).lista);
  try {
    assert.deepStrictEqual(parseComando('inventário'), { tipo: 'botao', botao: 'inventario' });
    assert.deepStrictEqual(parseComando('INVENTARIO'), { tipo: 'botao', botao: 'inventario' });
  } finally {
    controles.restaurarPadrao();
  }
});

// ---------------------------------------------------------------------------
// Validação: conflitos, reservadas, teclas
// ---------------------------------------------------------------------------

test('CONFLITO: mesma palavra em dois controles ATIVOS é rejeitada', () => {
  const res = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['pular', 'jump'] },
    { label: 'Voar', key: 'f', aliases: ['voar', 'jump'] },
  ]);
  assert.strictEqual(res.ok, false);
  assert.ok(
    res.erros.some((e) => e.includes('jump') && e.includes('Pular') && e.includes('Voar')),
    `mensagem deveria nomear os dois controles: ${res.erros}`
  );
});

test('sem conflito quando um dos dois controles está DESATIVADO (ele não disputa o chat)', () => {
  const res = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['pular', 'jump'] },
    { label: 'Voar', key: 'f', aliases: ['voar', 'jump'], enabled: false },
  ]);
  assert.strictEqual(res.ok, true, res.erros);
});

test('RESERVADAS: hold, soltar, comandos, stats... não viram palavra de controle', () => {
  for (const proibida of ['hold', 'segurar', 'soltar', 'release', 'comandos', 'help', 'stats', 'top', 'uptime', 'recorde', 'democracia', 'anarquia', 'ola', 'oi']) {
    const res = controles.validarLista([{ label: 'X', key: 'x', aliases: ['valida', proibida] }]);
    assert.strictEqual(res.ok, false, `"${proibida}" deveria ser rejeitada`);
    assert.ok(res.erros.some((e) => e.includes('reservada')), `mensagem deveria citar reservada: ${res.erros}`);
  }
});

test('TECLA: tecla desconhecida é rejeitada com mensagem útil', () => {
  for (const tecla of ['insert', 'pizza', 'win', 'printscreen', 'f13']) {
    const res = controles.validarLista([{ label: 'X', key: tecla, aliases: ['valida'] }]);
    assert.strictEqual(res.ok, false, `tecla "${tecla}" deveria ser rejeitada`);
    assert.ok(res.erros.some((e) => e.includes('não é suportada')), `mensagem deveria explicar: ${res.erros}`);
  }
});

test('TECLA: combo válido passa; combo malformado não', () => {
  assert.strictEqual(controles.validarLista([{ label: 'S', key: 'shift+f5', aliases: ['valida'] }]).ok, true);
  assert.strictEqual(controles.validarLista([{ label: 'S', key: 'shift+ctrl+alt+f5', aliases: ['valida'] }]).ok, true, 'combo triplo de modificadores é válido');
  for (const ruim of ['f5+shift', 'shift+', '+f5', 'a+b', 'f5+f6']) {
    const res = controles.validarLista([{ label: 'S', key: ruim, aliases: ['valida'] }]);
    assert.strictEqual(res.ok, false, `combo "${ruim}" deveria ser rejeitado`);
  }
});

test('combo não pode ser segurável (vira toque) — com aviso', () => {
  const res = controles.validarLista([{ label: 'Turbo', key: 'ctrl+t', aliases: ['turbo'], holdable: true }]);
  assert.strictEqual(res.ok, true, res.erros);
  const c = res.lista.find((x) => x.id === 'turbo');
  assert.strictEqual(c.holdable, false, 'combo deveria virar não-segurável');
  assert.ok(res.avisos.some((a) => a.includes('combo')), 'deveria avisar sobre o combo');
});

test('controle ATIVO sem palavra de chat é rejeitado (desativado pode)', () => {
  // label com slug reservado + combo (não gera nada automático) → fica sem palavra
  const travado = controles.validarLista([{ label: 'Soltar', key: 'shift+f5', aliases: [] }]);
  assert.strictEqual(travado.ok, false, 'controle ativo sem palavra deveria ser barrado');
  assert.ok(travado.erros.some((e) => e.includes('sem NENHUMA palavra')), travado.erros);
  // tecla simples SEMPRE gera ao menos uma palavra (aqui, o próprio x)
  const auto = controles.validarLista([{ label: 'X', key: 'x', aliases: [] }]);
  assert.strictEqual(auto.ok, true, auto.erros);
  assert.ok(auto.lista.find((c) => c.id === 'x').aliases.includes('x'));
  // desativado sem palavra é aceitável (não disputa o chat)
  const desativado = controles.validarLista([{ label: 'Soltar', key: 'f1', aliases: [], enabled: false }]);
  assert.strictEqual(desativado.ok, true, desativado.erros);
});

test('embutido ausente da lista volta DESATIVADO (não some do sistema)', () => {
  const res = controles.validarLista([{ label: 'Pular', key: 'space', aliases: ['pular'] }]);
  assert.strictEqual(res.ok, true, res.erros);
  const ids = res.lista.map((c) => c.id);
  for (const esperado of ['up', 'down', 'a', 'b', 'start', 'select', 'salvar']) {
    assert.ok(ids.includes(esperado), `embutido "${esperado}" deveria voltar na lista`);
  }
  // e voltam desligados (só o custom novo está ativo)
  assert.ok(res.lista.filter((c) => c.builtin).every((c) => c.enabled === false));
  assert.ok(res.avisos.some((a) => a.includes('reaplicado')), 'deveria avisar sobre os reaplicados');
});

// ---------------------------------------------------------------------------
// Persistência: save → restart → mesmos controles
// ---------------------------------------------------------------------------

test('PERSISTÊNCIA: salvar → restaurarPadrao → inicializar devolve o que foi salvo', () => {
  const minecraft = controles.validarLista([
    { label: 'Frente', key: 'w', aliases: ['frente', 'w', 'forward'] },
    { label: 'Pular', key: 'space', aliases: ['pular', 'jump'] },
    { label: 'Agachar', key: 'shift', aliases: ['agachar', 'crouch'] },
  ]).lista;

  const salvo = controles.salvarArquivo(minecraft);
  assert.strictEqual(salvo.ok, true, salvo.erro);

  // arquivo gravado com versão e lista
  const disco = JSON.parse(fs.readFileSync(process.env.CONTROLES_ARQUIVO, 'utf8'));
  assert.strictEqual(disco.versao, 1);
  assert.ok(Array.isArray(disco.controles) && disco.controles.length >= 15);

  // "restart": registry volta ao padrão e o boot recarrega o arquivo
  controles.restaurarPadrao();
  const r = controles.inicializar();
  assert.strictEqual(r.origem, 'arquivo');
  assert.strictEqual(controles.origem(), 'arquivo');

  assert.deepStrictEqual(parseComando('pular'), { tipo: 'botao', botao: 'pular' });
  assert.deepStrictEqual(parseComando('jump'), { tipo: 'botao', botao: 'pular' });
  assert.deepStrictEqual(parseComando('frente'), { tipo: 'botao', botao: 'frente' });
  assert.strictEqual(controles.mapaTeclado().pular, 'space');
  // builtins que não vieram na lista estão desligados
  assert.strictEqual(parseComando('cima'), null);
});

test('PERSISTÊNCIA: gravação é ATÔMICA (sem .tmp sobrando; inválida não substitui a boa)', () => {
  // 1) sobra nada
  controles.salvarArquivo(controles.controlesPadrao('mgba'));
  assert.ok(!fs.existsSync(process.env.CONTROLES_ARQUIVO + '.tmp'), 'arquivo .tmp não deveria existir');

  // 2) lista inválida NÃO gravar por cima da boa
  const antes = fs.readFileSync(process.env.CONTROLES_ARQUIVO, 'utf8');
  const ruim = controles.salvarArquivo([{ label: 'X', key: 'pizza', aliases: ['x'] }]);
  assert.strictEqual(ruim.ok, false, 'lista inválida deveria ser barrada');
  const depois = fs.readFileSync(process.env.CONTROLES_ARQUIVO, 'utf8');
  assert.strictEqual(depois, antes, 'arquivo válido foi substituído por lixo!');
});

test('PERSISTÊNCIA: arquivo corrompido não derruba o bot — cai no .env', () => {
  fs.writeFileSync(process.env.CONTROLES_ARQUIVO, '{ isto não é json !!!', 'utf8');
  controles.restaurarPadrao();
  const r = controles.inicializar();
  assert.strictEqual(r.origem, 'env');
  assert.deepStrictEqual(parseComando('a'), { tipo: 'botao', botao: 'a' });

  // arquivo válido de novo (campo controles ausente também cai no .env)
  fs.writeFileSync(process.env.CONTROLES_ARQUIVO, JSON.stringify({ versao: 1 }), 'utf8');
  controles.restaurarPadrao();
  assert.strictEqual(controles.inicializar().origem, 'env');
});

// ---------------------------------------------------------------------------
// Hold e votação com controles personalizados
// ---------------------------------------------------------------------------

test('HOLD de controle personalizado segurável executa com duração', () => {
  controles.__definirLista(controles.validarLista([{ label: 'Agachar', key: 'shift', aliases: ['agachar'] }]).lista);
  try {
    const p = parseComando('hold agachar 3');
    assert.strictEqual(p.tipo, 'hold');
    assert.strictEqual(p.botao, 'agachar');
    assert.strictEqual(p.duracaoMs, 3000);
  } finally {
    controles.restaurarPadrao();
  }
});

test('HOLD de combo personalizado vira toque (igual ao savestate)', () => {
  controles.__definirLista(controles.validarLista([{ label: 'Turbo', key: 'ctrl+t', aliases: ['turbo'] }]).lista);
  try {
    const p = parseComando('hold turbo 2');
    assert.deepStrictEqual(p, { tipo: 'botao', botao: 'turbo' });
  } finally {
    controles.restaurarPadrao();
  }
});

test('DEMOCRACIA: chat vota em controle personalizado e o vencedor sai com o id dele', async () => {
  controles.__definirLista(controles.validarLista([{ label: 'Pular', key: 'space', aliases: ['pular', 'jump'] }]).lista);
  votacao.resetar();
  votacao.configurar({ intervaloMs: 40, trocaMinMs: 0 });
  let vencedorRecebido = null;
  votacao.configurarExecutor((v) => { vencedorRecebido = v; });
  try {
    votacao.definirModo('democracia', 'teste');
    votacao.votar('pular', 'steve');
    votacao.votar('pular', 'alex');
    votacao.votar('turbo', 'zeca'); // candidato rival com 1 voto
    // espera a janela de 40ms fechar (o timer roda solto no event loop)
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(vencedorRecebido, 'executor deveria ter rodado');
    assert.strictEqual(vencedorRecebido.botao, 'pular');
    assert.strictEqual(vencedorRecebido.votos, 2);
  } finally {
    votacao.resetar();
    controles.restaurarPadrao();
  }
});

// ---------------------------------------------------------------------------
// Teclas válidas (para o wizard validar no navegador)
// ---------------------------------------------------------------------------

test('teclasValidas: contém as canônicas e SÓ o que os 3 backends suportam', () => {
  const lista = controles.teclasValidas();
  for (const esperada of ['up', 'down', 'left', 'right', 'enter', 'backspace', 'space', 'tab', 'esc', 'escape', 'shift', 'ctrl', 'alt', 'f1', 'f12', 'a', 'z', '0', '9']) {
    assert.ok(lista.includes(esperada), `tecla ${esperada} deveria ser válida`);
  }
  for (const proibida of ['insert', 'delete', 'home', 'end', 'win', 'pizza']) {
    assert.ok(!lista.includes(proibida), `tecla ${proibida} NÃO deveria estar na lista`);
  }
});

// ---------------------------------------------------------------------------
// REGRESSÃO v2.9.1 — garantia de carga p/ o wizard, conflitos por ID e
// alias de VÁRIAS palavras no hold
// ---------------------------------------------------------------------------

test('REGRESSÃO v2.9.1: garantirInicializado entrega o registro PERSISTIDO antes de o wizard abrir', () => {
  controles.salvarArquivo([{ label: 'Pular', key: 'space', aliases: ['pular', 'jump'] }]);

  // "restart do processo": módulo volta ao estado derivado do .env
  controles.restaurarPadrao();
  assert.strictEqual(controles.origem(), 'env');

  // o assistente chama garantirInicializado() ao subir o servidor — ANTES
  // do aplicarControles() do index.js
  const r = controles.garantirInicializado();
  assert.strictEqual(r.origem, 'arquivo');
  const pular = controles.todos().find((c) => c.id === 'pular');
  assert.ok(pular, 'registro persistido deveria estar carregado');
  assert.deepStrictEqual(pular.aliases, ['pular', 'jump']);
  assert.deepStrictEqual(parseComando('pular'), { tipo: 'botao', botao: 'pular' });

  // IDEMPOTENTE: trocar o arquivo "por fora" depois da 1ª carga não muda
  // o registro (o wizard não recarrega no meio da edição)...
  fs.writeFileSync(process.env.CONTROLES_ARQUIVO, JSON.stringify({
    versao: 1,
    controles: [{ label: 'Outra', key: 'o', aliases: ['outra'], id: 'outra', holdable: true, builtin: false, enabled: true, icone: '🎮' }],
  }), 'utf8');
  assert.strictEqual(controles.garantirInicializado().origem, 'arquivo');
  assert.ok(controles.todos().some((c) => c.id === 'pular'), 'não deveria recarregar sozinho');
  assert.ok(!controles.todos().some((c) => c.id === 'outra'), 'recarregou sem pedir!');

  // ...mas o inicializar() do index.js (depois do wizard) PEGA o novo
  controles.inicializar();
  assert.ok(controles.todos().some((c) => c.id === 'outra'), 'inicializar() deveria reler o arquivo');
});

test('REGRESSÃO v2.9.1: dois ATIVOS com o MESMO NOME não compartilham palavra em silêncio', () => {
  // antes da v2.9.1 a detecção era por LABEL: nomes iguais escapavam do
  // conflito e o mapa de aliases escolhia um vencedor na surdina
  const res = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['pular'] },
    { label: 'Pular', key: 'f', aliases: ['pular'] },
  ]);
  assert.strictEqual(res.ok, false, 'mesma palavra em dois controles ativos (mesmo nome) tem que dar erro');
  assert.ok(res.erros.some((e) => e.includes('pular')), res.erros);
});

test('REGRESSÃO v2.9.1: controle DESATIVADO não "protege" a palavra de dois ATIVOS (ordem qualquer)', () => {
  // ordem 1: o desativado chega primeiro e "guarda" a palavra
  const ordem1 = controles.validarLista([
    { label: 'Turbo', key: 't', aliases: ['turbo'], enabled: false },
    { label: 'Pular', key: 'space', aliases: ['turbo'] },
    { label: 'Voar', key: 'f', aliases: ['turbo'] },
  ]);
  assert.strictEqual(ordem1.ok, false, 'dois ativos na mesma palavra: erro mesmo com desativado antes');
  assert.ok(ordem1.erros.some((e) => e.includes('turbo')), ordem1.erros);

  // ordem 2: ativos primeiro, desativado no meio
  const ordem2 = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['turbo'] },
    { label: 'Turbo', key: 't', aliases: ['turbo'], enabled: false },
    { label: 'Voar', key: 'f', aliases: ['turbo'] },
  ]);
  assert.strictEqual(ordem2.ok, false, 'o erro não pode depender da ordem da lista');
});

test('REGRESSÃO v2.9.1: acento/caixa não disfarça palavra repetida', () => {
  const res = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['Espaço'] },
    { label: 'Correr', key: 'r', aliases: ['espaco'] },
  ]);
  assert.strictEqual(res.ok, false, '"Espaço" e "espaco" normalizam para a mesma palavra');
  assert.ok(res.erros.some((e) => e.includes('espaco')), res.erros);
});

test('REGRESSÃO v2.9.1: alias GERADO também disputa com alias manual', () => {
  // gerado primeiro (Pular gera 'pular' porque veio sem palavras),
  // manual depois → conflito entre ativos é erro
  const res = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: [] },
    { label: 'Voa', key: 'f', aliases: ['pular'] },
  ]);
  assert.strictEqual(res.ok, false, 'palavra gerada de um ativo conflita com manual de outro ativo');
  assert.ok(res.erros.some((e) => e.includes('pular')), res.erros);
});

test('REGRESSÃO v2.9.1: gerar NÃO rouba palavra de dono ativo (gerado depois do manual)', () => {
  const res = controles.validarLista([
    { label: 'Voa', key: 'f', aliases: ['pular'] },
    { label: 'Pular', key: 'space', aliases: [] }, // geraria 'pular', mas já tem dono ativo
  ]);
  assert.strictEqual(res.ok, true, res.erros);
  const pular = res.lista.find((c) => c.id === 'pular');
  assert.ok(!pular.aliases.includes('pular'), 'palavra tomada não é reaproveitada');
  assert.ok(pular.aliases.includes('space'), 'as outras palavras geradas valem');
});

test('REGRESSÃO v2.9.1: alias de VÁRIAS palavras funciona simples e no hold', () => {
  controles.restaurarPadrao();
  // clássicos continuam exatamente iguais
  assert.deepStrictEqual(parseComando('hold cima 3'), { tipo: 'hold', botao: 'up', duracaoMs: 3000 });
  assert.deepStrictEqual(parseComando('hold up 500ms'), { tipo: 'hold', botao: 'up', duracaoMs: 500 });

  controles.__definirLista(controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['pular', 'jump', 'barra de espaco'] },
  ]).lista);
  try {
    // comando simples com a frase inteira (com acento e espaços extras)
    assert.deepStrictEqual(parseComando('barra de espaco'), { tipo: 'botao', botao: 'pular' });
    assert.deepStrictEqual(parseComando('BARRA  DE  ESPAÇO'), { tipo: 'botao', botao: 'pular' });

    // hold com alias multi-palavra + duração
    const h1 = parseComando('hold barra de espaco 2');
    assert.strictEqual(h1.tipo, 'hold');
    assert.strictEqual(h1.botao, 'pular');
    assert.strictEqual(h1.duracaoMs, 2000);

    // hold com alias multi-palavra sem duração (padrão)
    assert.strictEqual(parseComando('segurar barra de espaco').tipo, 'hold');

    // hold de palavra única + duração continua ok
    const h2 = parseComando('hold pular 500ms');
    assert.deepStrictEqual(h2, { tipo: 'hold', botao: 'pular', duracaoMs: 500 });
  } finally {
    controles.restaurarPadrao();
  }
});
