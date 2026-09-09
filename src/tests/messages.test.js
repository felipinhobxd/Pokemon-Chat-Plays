/**
 * Testes do formatador de mensagens (src/messages.js).
 * Garante que todas as mensagens cabem no limite da Twitch (~500 chars)
 * e que o conteúdo inclui TODOS os comandos (o problema antigo do
 * "!comandos" incompleto nunca mais volta).
 */

const test = require('node:test');
const assert = require('node:assert');
const msg = require('../messages');
const { BOTOES, DIRECOES, BOTOES_ACAO } = require('../commands');

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

test('!comandos mostra TODOS os botões do controle', () => {
  const textoCompleto = msg.msgComandos().join('\n').toLowerCase();
  // direções (PT e EN)
  for (const d of DIRECOES) {
    const nomePT = { up: 'cima', down: 'baixo', left: 'esquerda', right: 'direita' }[d];
    assert.ok(textoCompleto.includes(nomePT.toLowerCase()), `falta "${nomePT}"`);
    assert.ok(textoCompleto.includes(d), `falta "${d}"`);
  }
  // botões de ação
  for (const b of BOTOES_ACAO) {
    assert.ok(textoCompleto.includes(b), `falta "${b}"`);
  }
  // extras essenciais
  assert.ok(textoCompleto.includes('hold'), 'falta mencionar hold');
  assert.ok(textoCompleto.includes('soltar'), 'falta mencionar soltar');
  assert.ok(textoCompleto.includes('!stats'), 'falta !stats');
  assert.ok(textoCompleto.includes('!top'), 'falta !top');
  assert.ok(textoCompleto.includes('!segurar'), 'falta !segurar');
});

test('!comandos responde em 2 mensagens organizadas', () => {
  const partes = msg.msgComandos();
  assert.strictEqual(partes.length, 2, 'esperado 2 mensagens (jogo + hold)');
  // primeira parte = controles, segunda = hold/extras
  assert.ok(partes[0].includes('DIREÇÕES'));
  assert.ok(partes[1].includes('SEGURAR'));
});

test('anúncio automático é curto e cita os essenciais', () => {
  const anuncio = msg.msgAnuncio();
  assert.ok(anuncio.length <= 500);
  assert.ok(anuncio.includes('hold'));
  assert.ok(anuncio.includes('!comandos'));
});

test('confirmação de hold cita usuário, botão e duração', () => {
  const texto = msg.msgHoldConfirmado('user1', 'up', 3000);
  assert.ok(texto.includes('@user1'));
  assert.ok(texto.includes('CIMA'));
  assert.ok(texto.includes('3s'));
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

test('todo botão tem ícone e rótulo definidos', () => {
  for (const [nome, info] of Object.entries(BOTOES)) {
    assert.ok(info.icone, `botão "${nome}" sem ícone`);
    assert.ok(info.rotulo, `botão "${nome}" sem rótulo`);
  }
});
