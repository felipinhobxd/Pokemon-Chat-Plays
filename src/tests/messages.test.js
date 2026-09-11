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
  assert.ok(textoCompleto.includes('!segurar'), 'falta !segurar');
});

test('!comandos responde em 3 mensagens organizadas (registro padrão)', () => {
  const partes = msg.msgComandos();
  assert.strictEqual(partes.length, 3, 'esperado 3 mensagens (jogo + hold + extras)');
  // 1 = controles, 2 = hold/savestates, 3 = outros comandos
  assert.ok(partes[0].includes('COMANDOS DO JOGO'));
  assert.ok(partes[1].includes('SEGURAR'));
  assert.ok(partes[1].includes('salvar'));
  assert.ok(partes[2].includes('OUTROS COMANDOS'));
});

test('!comandos é uma lista legível: 1 controle por linha, linhas curtas', () => {
  for (const parte of msg.msgComandos()) {
    const linhas = parte.split('\n');
    assert.ok(
      linhas.length >= 8,
      `esperado formato de lista (>= 8 linhas), veio ${linhas.length}`
    );
    for (const linha of linhas) {
      assert.ok(
        linha.length <= 45,
        `linha longa demais (${linha.length} chars): "${linha}"`
      );
    }
  }
  // controles com mais de uma palavra mostram os sinônimos entre parênteses
  const parte1 = msg.msgComandos()[0];
  assert.ok(parte1.includes('(ou up'), 'sinônimos de cima deveriam aparecer');
  assert.ok(parte1.includes('(ou left'), 'sinônimos de esquerda deveriam aparecer');
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

test('!comandos divide em mais mensagens quando a lista é ENORME', () => {
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
    }
    // numeração (i/total) coerente nas partes de controles
    const total = partes[partes.length - 1].match(/\((\d+)\/(\d+)\)/);
    assert.ok(total, 'numeração (i/total) ausente');
    assert.strictEqual(Number(total[1]), Number(total[2]), 'última parte deveria fechar a numeração');
    assert.strictEqual(partes.length, Number(total[2]), 'numeração não bate com a quantidade de partes');
    // TODOS os controles apareceram (um por linha — conta as linhas de controle)
    const linhasControle = partes.join('\n').split('\n').filter((l) => l.startsWith('🎮 acao composta'));
    assert.strictEqual(linhasControle.length, 40, `esperado 40 linhas de controle, veio ${linhasControle.length}`);
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
