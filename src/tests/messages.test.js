/**
 * Testes do formatador de mensagens (src/messages.js).
 * Garante que todas as mensagens cabem no limite da Twitch (~500 chars)
 * e que o conteúdo inclui TODOS os controles ATIVOS do registro (o
 * problema antigo do "!comandos" incompleto nunca mais volta — e desde a
 * v2.9 a lista é DINÂMICA: Minecraft mostra Minecraft, não A/B/Start).
 */

const test = require('node:test');
const assert = require('node:assert');
const msg = require('../messages');
const controles = require('../controles');

const LIMITE = 500; // limite oficial da Twitch

/**
 * Coleta todas as mensagens que o bot pode mandar no chat.
 * @returns {string[]}
 */
function todasAsMensagens() {
  const resumoFake = {
    total: 999999,
    holds: 42,
    soltas: 7,
    uptimeMin: 125,
    porPlataforma: { twitch: 500000, youtube: 499999 },
    porComando: [],
    topUsuarios: [
      { nome: 'nome_muito_longo_aaaaaaaaaaaaaaaaaaaaaa', comandos: 999999 },
      { nome: 'user2', comandos: 500 },
      { nome: 'user3', comandos: 300 },
      { nome: 'user4', comandos: 200 },
      { nome: 'user5', comandos: 100 },
    ],
  };

  return [
    ...msg.msgComandos(),
    msg.msgHoldAjuda(),
    msg.msgAnuncio(),
    msg.msgBoasVindas('usuario_com_nome_bem_comprido_para_testar'),
    msg.msgHoldConfirmado('usuario_com_nome_bem_comprido_para_testar', 'up', 12345),
    msg.msgSoltarConfirmado('usuario_com_nome_bem_comprido_para_testar', 4),
    msg.msgUsoHold('usuario_com_nome_bem_comprido_para_testar'),
    msg.msgStats(resumoFake),
    msg.msgTop(resumoFake),
    msg.msgTop({ topUsuarios: [] }), // ranking vazio
    msg.msgStats({ total: 0, uptimeMin: 0, porPlataforma: {} }),
  ];
}

test('nenhuma mensagem estoura o limite de 500 caracteres', () => {
  for (const texto of todasAsMensagens()) {
    assert.ok(
      texto.length <= LIMITE,
      `mensagem com ${texto.length} chars estoura o limite:\n"${texto}"`
    );
  }
});

test('não há mensagens vazias', () => {
  for (const texto of todasAsMensagens()) {
    assert.ok(texto.trim().length > 0, 'mensagem vazia detectada');
  }
});

test('!comandos mostra TODOS os controles ativos do registro', () => {
  const textoCompleto = msg.msgComandos().join('\n').toLowerCase();
  // cada controle ativo aparece com sua primeira palavra de chat
  for (const c of controles.ativos()) {
    const palavra = c.aliases[0];
    assert.ok(
      palavra && textoCompleto.includes(palavra),
      `controle "${c.label}" (${palavra}) não aparece no !comandos`
    );
  }
  // extras essenciais
  assert.ok(textoCompleto.includes('hold'), 'falta mencionar hold');
  assert.ok(textoCompleto.includes('soltar'), 'falta mencionar soltar');
  assert.ok(textoCompleto.includes('!stats'), 'falta !stats');
  assert.ok(textoCompleto.includes('!top'), 'falta !top');
  assert.ok(textoCompleto.includes('!hold'), 'falta !hold (v3.1: o !segurar virou secundário, o par exibido é !hold)');
});

test('!comandos responde em 3 mensagens organizadas (registro padrão)', () => {
  const partes = msg.msgComandos();
  assert.strictEqual(partes.length, 3, 'esperado 3 mensagens (jogo + avançado + outros)');
  // 1 = controles do jogo, 2 = hold/mouse/gamepad/soltar, 3 = comandos !
  assert.ok(partes[0].includes('🎮 JOGO'));
  assert.ok(partes[1].includes('AVANÇADO'));
  assert.ok(partes[1].includes('hold'));
  assert.ok(partes[2].includes('OUTROS'));
});

test('!comandos (v3.1): cada parte é UMA linha compacta dentro do alvo ideal', () => {
  const partes = msg.msgComandos();
  for (const parte of partes) {
    // sem depender de o cliente do chat renderizar quebras de linha
    assert.ok(!parte.includes('\n'), 'parte deve ser uma linha única');
    assert.ok(
      parte.length <= 430,
      `parte com ${parte.length} chars passou do alvo ideal (430): "${parte}"`
    );
    assert.ok(parte.trim().length > 0, 'parte vazia');
  }
  // numeração (i/3) coerente
  for (let i = 1; i <= 3; i++) {
    assert.ok(partes[i - 1].includes(`(${i}/3)`), `parte ${i} sem numeração (i/3)`);
  }
  // estilo compacto: pares PT/EN no formato "cima/up" (não "(ou up, subir, sobe)")
  assert.ok(partes[0].includes('cima/up'), 'par compacto cima/up deveria aparecer');
  assert.ok(partes[0].includes('salvar/save'));
  assert.ok(!partes[0].includes('(ou '), 'formato verboso "(ou ...)" não deve mais aparecer');
  // a dica de que controles não levam ! continua presente
  assert.ok(partes[0].includes('sem !'), 'dica "sem !" deveria aparecer na parte 1');
});

test('!comandos DINÂMICO: registro Minecraft mostra os controles do Minecraft', () => {
  const lista = controles.validarLista([
    { label: 'Frente', key: 'w', aliases: ['frente', 'forward'] },
    { label: 'Trás', key: 's', aliases: ['tras', 'back'] },
    { label: 'Pular', key: 'space', aliases: ['pular', 'jump'] },
    { label: 'Inventário', key: 'e', aliases: ['inventario', 'inventory'] },
    { label: 'Agachar', key: 'shift', aliases: ['agachar', 'crouch'] },
  ]).lista;
  for (const c of lista) if (!['frente', 'tras', 'pular', 'inventario', 'agachar'].includes(c.id)) c.enabled = false;
  controles.__definirLista(lista);

  try {
    const partes = msg.msgComandos();
    for (const p of partes) assert.ok(p.length <= 500, 'parte estourou o limite');
    const tudo = partes.join('\n').toLowerCase();
    for (const palavra of ['frente', 'tras', 'pular', 'inventario', 'agachar']) {
      assert.ok(tudo.includes(palavra), `controle Minecraft "${palavra}" sumiu do !comandos`);
    }
    // comandos de Game Boy desligados NÃO aparecem
    assert.ok(!tudo.includes('start'), 'start (desligado) não deveria aparecer');
    assert.ok(!tudo.includes('cima'), 'cima (desligado) não deveria aparecer');
    // anúncio também reflete os controles configurados
    const anuncio = msg.msgAnuncio().toLowerCase();
    assert.ok(anuncio.includes('pular'), 'anúncio deveria citar pular');
    assert.ok(!anuncio.includes('cima'), 'anúncio não deveria citar cima (desligado)');
    // boas-vindas citam as palavras reais
    const boas = msg.msgBoasVindas('novato').toLowerCase();
    assert.ok(boas.includes('frente') || boas.includes('pular'), 'boas-vindas citam controles reais');
  } finally {
    controles.restaurarPadrao();
  }
});

test('!comandos divide em mais mensagens quando a lista é ENORME (determinístico)', () => {
  // 40 controles com nomes longos — não cabe numa mensagem só
  const lista = [];
  for (let i = 1; i <= 40; i++) {
    lista.push({ label: `Ação Composta numero ${i}`, key: 'space', aliases: [`acao composta numero ${i}`, `ac${i}`] });
  }
  const res = controles.validarLista(lista);
  assert.strictEqual(res.ok, true, res.erros);
  controles.__definirLista(res.lista);

  try {
    const partes = msg.msgComandos();
    assert.ok(partes.length > 3, `esperado > 3 mensagens, veio ${partes.length}`);
    for (const p of partes) {
      assert.ok(p.length <= 480, `parte com ${p.length} chars estoura o limite prático`);
      assert.ok(!p.includes('\n'), 'cada parte continua sendo uma linha única');
    }
    // numeração (i/total) coerente nas partes de controles
    const total = partes[partes.length - 1].match(/\((\d+)\/(\d+)\)/);
    assert.ok(total, 'numeração (i/total) ausente');
    assert.strictEqual(Number(total[1]), Number(total[2]), 'última parte deveria fechar a numeração');
    assert.strictEqual(partes.length, Number(total[2]), 'numeração não bate com a quantidade de partes');
    // TODOS os controles apareceram (uma vez cada — conta ocorrências únicas)
    const encontrados = new Set(partes.join(' ').match(/acao composta numero \d+/g) || []);
    assert.strictEqual(encontrados.size, 40, `esperado 40 controles distintos, veio ${encontrados.size}`);
    // determinístico: mesma lista gera exatamente as mesmas mensagens
    assert.deepStrictEqual(msg.msgComandos(), partes, 'geração não é determinística');
  } finally {
    controles.restaurarPadrao();
  }
});

test('ajuda do hold também é uma lista linha a linha', () => {
  const linhas = msg.msgHoldAjuda().split('\n');
  assert.ok(linhas.length >= 6, 'esperado >= 6 linhas na ajuda de hold');
  for (const linha of linhas) {
    assert.ok(linha.length <= 45, `linha longa demais: "${linha}"`);
  }
});

test('anúncio automático é curto e cita os essenciais', () => {
  const anuncio = msg.msgAnuncio();
  assert.ok(anuncio.length <= 500);
  assert.ok(anuncio.includes('hold'));
  assert.ok(anuncio.includes('!comandos'));
  // anúncio também em formato de lista (linhas curtas)
  for (const linha of anuncio.split('\n')) {
    assert.ok(linha.length <= 45, `linha longa demais no anúncio: "${linha}"`);
  }
});

test('confirmação de hold cita usuário, botão e duração', () => {
  const texto = msg.msgHoldConfirmado('user1', 'up', 3000);
  assert.ok(texto.includes('@user1'));
  assert.ok(texto.includes('CIMA'));
  assert.ok(texto.includes('3s'));
});

test('confirmação de hold usa o rótulo de controles PERSONALIZADOS', () => {
  controles.__definirLista(
    controles.validarLista([{ label: 'Agachar', key: 'shift', aliases: ['agachar'] }]).lista
  );
  try {
    const texto = msg.msgHoldConfirmado('user1', 'agachar', 2000);
    assert.ok(texto.includes('AGACHAR'), 'rótulo do controle personalizado deveria aparecer');
    assert.ok(texto.includes('2s'));
  } finally {
    controles.restaurarPadrao();
  }
});

test('durações formatam corretamente', () => {
  assert.strictEqual(msg.formatarDuracao(1000), '1s');
  assert.strictEqual(msg.formatarDuracao(3000), '3s');
  assert.strictEqual(msg.formatarDuracao(500), '500ms');
  assert.strictEqual(msg.formatarDuracao(2500), '2,5s');
});

test('uptime formata corretamente', () => {
  assert.strictEqual(msg.formatarUptime(45), '45 min');
  assert.strictEqual(msg.formatarUptime(125), '2h 5min');
  assert.strictEqual(msg.formatarUptime(1500), '1d 1h');
});

test('ranking com jogadores mostra medalhas', () => {
  const texto = msg.msgTop({
    topUsuarios: [
      { nome: 'a', comandos: 10 },
      { nome: 'b', comandos: 5 },
    ],
  });
  assert.ok(texto.includes('🥇'));
  assert.ok(texto.includes('🥈'));
  assert.ok(texto.includes('@a'));
});

test('todo controle do registro tem ícone, rótulo e pelo menos uma palavra', () => {
  for (const c of controles.ativos()) {
    assert.ok(c.icone, `controle "${c.id}" sem ícone`);
    assert.ok(c.label, `controle "${c.id}" sem rótulo`);
    assert.ok(c.key, `controle "${c.id}" sem tecla`);
    assert.ok(Array.isArray(c.aliases) && c.aliases.length >= 1, `controle "${c.id}" sem palavra de chat`);
  }
});

// ---------------------------------------------------------------------------
// v2.3: avisos de pausa do streamer (F9)
// ---------------------------------------------------------------------------

test('mensagens de pausa/liberação são curtas e claras', () => {
  const pausada = msg.msgChatPausado();
  const liberada = msg.msgChatLiberado();
  assert.ok(pausada.includes('PAUSADO'), 'aviso de pausa diz PAUSADO');
  assert.ok(pausada.length <= 480, 'cabe no limite da Twitch');
  assert.ok(liberada.includes('liberado') || liberada.includes('Chat liberado'), 'aviso de liberação');
  assert.ok(liberada.length <= 480, 'cabe no limite da Twitch');
});

// ---------------------------------------------------------------------------
// v3.1.x — !comandos em 3 partes legíveis: o que a parte 2/3 anuncia tem
// que ser sintaxe REAL do parser atual (nada de exemplo inventado), o HOLD
// mostra a faixa verdadeira (1ms–10s), o mouse HOLD é descobrível e a
// geração nunca quebra quando mouse/gamepad estão desligados.
// ---------------------------------------------------------------------------

const { parseComando } = require('../commands');
const { parseMouseCommand } = require('../mouse-commands');
const { parseGamepadCommand } = require('../gamepad-commands');
const dialogo = require('../utils/dialogo');
const { config, recarregar } = require('../config');

test('!comandos (v3.1): HOLD anuncia a faixa real 1ms–10s e exemplos que o parser aceita', () => {
  const partes = msg.msgComandos();
  const avancado = partes[1];

  // faixa real do parser compartilhado (duracao.js: piso 1ms, teto HOLD_MAX_MS)
  assert.ok(avancado.includes('1ms–10s'), 'faixa de HOLD deveria aparecer como 1ms–10s (padrão)');

  // cada exemplo anunciado com o registro padrão é sintaxe REAL
  assert.ok(avancado.includes('hold cima 3s'));
  assert.ok(avancado.includes('hold a 250ms'));
  assert.strictEqual(parseComando('hold cima 3s')?.tipo, 'hold');
  assert.strictEqual(parseComando('hold cima 3s')?.duracaoMs, 3000);
  assert.strictEqual(parseComando('hold a 250ms')?.tipo, 'hold');
  assert.strictEqual(parseComando('hold a 250ms')?.duracaoMs, 250);
});

test('!comandos (v3.1): mouse HOLD é descobrível (clique esquerdo/direito)', () => {
  const avancado = msg.msgComandos()[1];
  assert.ok(avancado.includes('hold clique esquerdo 2s'), 'exemplo de hold do clique esquerdo deveria aparecer');
  assert.ok(avancado.includes('hold clique direito 1s'), 'exemplo de hold do clique direito deveria aparecer');

  const esquerdo = parseMouseCommand('hold clique esquerdo 2s');
  assert.strictEqual(esquerdo?.tipo, 'mouse-hold');
  assert.strictEqual(esquerdo?.botao, 'left');
  assert.strictEqual(esquerdo?.duracaoMs, 2000);
  const direito = parseMouseCommand('hold clique direito 1s');
  assert.strictEqual(direito?.tipo, 'mouse-hold');
  assert.strictEqual(direito?.botao, 'right');
});

test('!comandos (v3.1): exemplos de gamepad anunciados são sintaxe REAL', () => {
  const avancado = msg.msgComandos()[1];
  assert.ok(avancado.includes('pad a'));
  assert.ok(avancado.includes('pad ls direita'));
  assert.ok(avancado.includes('pad rt 75'));

  assert.strictEqual(parseGamepadCommand('pad a')?.tipo, 'gamepad-botao');
  const stick = parseGamepadCommand('pad ls direita');
  assert.strictEqual(stick?.tipo, 'gamepad-stick');
  assert.strictEqual(stick?.stick, 'L'); // parser devolve a haste canonizada
  assert.strictEqual(stick?.x, 100, 'ls direita = x no máximo');
  const trigger = parseGamepadCommand('pad rt 75');
  assert.strictEqual(trigger?.tipo, 'gamepad-trigger');
  assert.strictEqual(trigger?.valor, 75);
});

test('!comandos (v3.1): parte 3 só anuncia comandos que existem; democracia é VOTO', () => {
  const outros = msg.msgComandos()[2];

  // democracia/anarquia são VOTOS desde v2.9.4 — nunca "troca instantânea"
  assert.ok(outros.includes('!democracia / !anarquia'), 'comandos de modo deveriam aparecer');
  assert.ok(outros.includes('votar no modo'), 'modo é decidido por voto, a ajuda tem que dizer isso');
  assert.ok(!/troca (o )?modo (agora|na hora|instant)/i.test(outros), 'não pode prometer troca instantânea de modo');

  // todo comando com ! anunciado resolve no parser
  for (const comando of ['!stats', '!top', '!uptime', '!recorde', '!hold', '!ajuda', '!help', '!commands']) {
    const parsed = parseComando(comando);
    assert.ok(parsed && parsed.tipo === 'info', `${comando} deveria ser um comando de info real`);
    assert.ok(outros.includes(comando), `${comando} anunciado deveria aparecer na parte 3`);
  }
  // !democracia/!anarquia resolvem como voto de modo
  assert.strictEqual(parseComando('!democracia')?.comando, 'modo');
  assert.strictEqual(parseComando('!anarquia')?.comando, 'modo');

  // dialogo/dialogue são comandos reais (apertar A repetido)
  assert.ok(outros.includes('dialogo/dialogue'));
  assert.ok(dialogo.ehComando('dialogo'));
  assert.ok(dialogo.ehComando('dialogue'));

  // soltar/release continua anunciado e funcional
  assert.ok(outros.includes('soltar') || msg.msgComandos()[1].includes('soltar/release'));
  assert.strictEqual(parseComando('soltar')?.tipo, 'soltar');
  assert.strictEqual(parseComando('release')?.tipo, 'soltar');
});

test('!comandos (v3.1): mouse/gamepad desligados não quebram a geração (e somem da parte 2)', () => {
  const modosOriginais = { mouse: process.env.MODO_MOUSE, gamepad: process.env.GAMEPAD_ENABLED };
  try {
    process.env.MODO_MOUSE = 'off';
    process.env.GAMEPAD_ENABLED = 'off';
    recarregar();

    let partes;
    assert.doesNotThrow(() => { partes = msg.msgComandos(); }, 'geração não pode quebrar com mouse/gamepad off');
    assert.strictEqual(partes.length, 3, 'continua sendo 3 partes');
    for (const p of partes) {
      assert.ok(p.trim().length > 0, 'nenhuma parte vazia');
      assert.ok(p.length <= 480, 'limite respeitado mesmo com tudo desligado');
    }
    // desligado não é anunciado: sem clique e sem pad na parte 2
    assert.ok(!partes[1].includes('clique'), 'mouse desligado não deveria ser anunciado');
    assert.ok(!partes[1].includes('pad '), 'gamepad desligado não deveria ser anunciado');
    // hold do teclado e soltar continuam (dependem só do registro)
    assert.ok(partes[1].includes('hold '), 'hold de teclado continua anunciado');
    assert.ok(partes[1].includes('soltar/release'));
  } finally {
    if (modosOriginais.mouse === undefined) delete process.env.MODO_MOUSE;
    else process.env.MODO_MOUSE = modosOriginais.mouse;
    if (modosOriginais.gamepad === undefined) delete process.env.GAMEPAD_ENABLED;
    else process.env.GAMEPAD_ENABLED = modosOriginais.gamepad;
    recarregar();
    // volta ao estado normal para os próximos testes
    const avancado = msg.msgComandos()[1];
    assert.ok(avancado.includes('clique'), 'mouse re-ativado volta a ser anunciado');
    assert.ok(avancado.includes('pad '), 'gamepad re-ativado volta a ser anunciado');
  }
});
