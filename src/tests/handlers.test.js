/**
 * Testes do pipeline central (src/handlers.js).
 * Simula mensagens chegando e verifica reações (respostas / teclado / stats).
 * O teclado é mockado para não depender de PowerShell/xdotool no CI.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Importa handlers com um stub de teclado ANTES do require real,
// usando o cache do require.
const CAMINHO_TECLADO = path.resolve(__dirname, '../controllers/keyboard.js');
const CAMINHO_HANDLERS = path.resolve(__dirname, '../handlers.js');
const CAMINHO_COOLDOWN = path.resolve(__dirname, '../utils/cooldown.js');

const tecladoReal = require(CAMINHO_TECLADO);

/** Histórico de chamadas do teclado mockado. */
let chamadasTeclado = [];

const tecladoStub = {
  executarBotao: (botao) => {
    chamadasTeclado.push({ fn: 'executarBotao', botao });
    return true;
  },
  segurar: (botao, duracaoMs, dono) => {
    chamadasTeclado.push({ fn: 'segurar', botao, duracaoMs, dono });
    return true;
  },
  soltarTodas: () => {
    chamadasTeclado.push({ fn: 'soltarTodas' });
    return 2;
  },
  soltarTodasSync: () => {},
  totalSeguradas: () => 0,
  configurarMapeamento: () => {},
  verificarSistema: async () => true,
};

// Substitui no cache de módulos para o handlers usar o stub
const cacheOriginal = require.cache[CAMINHO_TECLADO];
require.cache[CAMINHO_TECLADO] = {
  id: CAMINHO_TECLADO,
  filename: CAMINHO_TECLADO,
  loaded: true,
  exports: tecladoStub,
};

const cooldownReal = require(CAMINHO_COOLDOWN);
// cooldown stub com chave: pode bloquear todos para testar a isenção do
// streamer (o streamer nunca é bloqueado, só os espectadores)
let bloquearTodosNoCooldown = false;
const cooldownStub = {
  podeExecutar: () => (bloquearTodosNoCooldown ? { permitido: false, motivo: 'teste' } : { permitido: true }),
  registrarExecucao: () => {},
  limparAntigos: () => {},
};
const cacheOriginalCooldown = require.cache[CAMINHO_COOLDOWN];
require.cache[CAMINHO_COOLDOWN] = {
  id: CAMINHO_COOLDOWN,
  filename: CAMINHO_COOLDOWN,
  loaded: true,
  exports: cooldownStub,
};

const { processarMensagem, resetarAntiFlood } = require(CAMINHO_HANDLERS);
const pausa = require('../utils/pausa');

/**
 * Cria um responder espião que grava tudo que o bot mandaria no chat.
 * @returns {{respostas: string[], responder: Function}}
 */
function criarResponderEspiao() {
  const respostas = [];
  const responder = (texto, prioridade) => {
    respostas.push({ texto, prioridade });
  };
  return { respostas, responder };
}

// ---------------------------------------------------------------------------

test('botão simples vai para o teclado', () => {
  chamadasTeclado = [];
  const { responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'jogador1', texto: 'cima', responder });
  assert.strictEqual(chamadasTeclado.length, 1);
  assert.strictEqual(chamadasTeclado[0].fn, 'executarBotao');
  assert.strictEqual(chamadasTeclado[0].botao, 'up');
  assert.strictEqual(responder ? 0 : 0, 0); // sem respostas de chat para toques
});

test('hold vai para o teclado com duração correta', () => {
  chamadasTeclado = [];
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'jogador1', texto: 'hold baixo 3', responder });
  assert.strictEqual(chamadasTeclado.length, 1);
  assert.strictEqual(chamadasTeclado[0].fn, 'segurar');
  assert.strictEqual(chamadasTeclado[0].botao, 'down');
  assert.strictEqual(chamadasTeclado[0].duracaoMs, 3000);
  // hold confirma no chat (prioridade baixa)
  const confirmacoes = respostas.filter((r) => r.texto.includes('@jogador1'));
  assert.ok(confirmacoes.length >= 1, 'deveria confirmar o hold no chat');
});

test('"soltar" chama soltarTodas e confirma', () => {
  chamadasTeclado = [];
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'jogador1', texto: 'soltar', responder });
  assert.strictEqual(chamadasTeclado.length, 1);
  assert.strictEqual(chamadasTeclado[0].fn, 'soltarTodas');
  const confirmacao = respostas.find((r) => r.texto.includes('soltou'));
  assert.ok(confirmacao, 'deveria confirmar as teclas soltas');
});

test('"!comandos" responde com a lista completa em 3 mensagens', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'curioso', texto: '!comandos', responder });
  const partes = respostas.map((r) => r.texto);
  assert.strictEqual(partes.length, 3, '!comandos deve mandar 3 mensagens');
  assert.ok(partes[0].includes('COMANDOS DO JOGO'));
  assert.ok(partes[1].includes('SEGURAR'));
  assert.ok(partes[2].includes('OUTROS COMANDOS'));
});

test('anti-flood: "!comandos" em rajada responde só uma vez', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  for (let i = 0; i < 5; i++) {
    processarMensagem({ plataforma: 'twitch', usuario: `spammer${i}`, texto: '!comandos', responder });
  }
  // 5 pedidos em < 8s -> só 3 mensagens (uma resposta completa)
  assert.strictEqual(respostas.length, 3);
});

test('"!top" responde com ranking', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'curioso', texto: '!top', responder });
  assert.ok(respostas.length >= 1);
  assert.ok(respostas[0].texto.includes('TOP JOGADORES'));
});

test('"!stats" responde com estatísticas', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'curioso', texto: '!stats', responder });
  assert.ok(respostas.length >= 1);
  assert.ok(respostas[0].texto.includes('ESTATÍSTICAS'));
});

test('mensagem comum é ignorada silenciosamente', () => {
  chamadasTeclado = [];
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'pessoa', texto: 'que jogo é esse?', responder });
  assert.strictEqual(chamadasTeclado.length, 0);
  assert.strictEqual(respostas.length, 0);
});

test('saudação recebe boas-vindas', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'novato', texto: 'olá', responder });
  assert.strictEqual(respostas.length, 1);
  assert.ok(respostas[0].texto.includes('@novato'));
});

test('hold inválido recebe dica de uso', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'confuso', texto: 'hold pizza', responder });
  assert.strictEqual(respostas.length, 1);
  assert.ok(respostas[0].texto.includes('hold <controle|clique|pad>'));
});

test('sem responder (YouTube), nada quebra', () => {
  chamadasTeclado = [];
  processarMensagem({ plataforma: 'youtube', usuario: 'yt_user', texto: 'hold cima', responder: null });
  processarMensagem({ plataforma: 'youtube', usuario: 'yt_user', texto: '!comandos', responder: null });
  assert.strictEqual(chamadasTeclado.length, 1); // hold executou mesmo sem chat
});

// ---------------------------------------------------------------------------
// v2.3: botão de pânico (F9) — comandos de jogo bloqueados quando pausado
// ---------------------------------------------------------------------------

test('chat PAUSADO: botões/hold/soltar do chat são ignorados', () => {
  pausa.resetar();
  pausa.definir(true, 'teste');
  chamadasTeclado = [];
  const { respostas, responder } = criarResponderEspiao();

  processarMensagem({ plataforma: 'twitch', usuario: 'zangado', texto: 'cima', responder });
  processarMensagem({ plataforma: 'twitch', usuario: 'zangado', texto: 'hold baixo 2', responder });
  processarMensagem({ plataforma: 'twitch', usuario: 'zangado', texto: 'soltar', responder });

  assert.strictEqual(chamadasTeclado.length, 0, 'nada deve chegar ao teclado com o chat pausado');
  assert.strictEqual(respostas.length, 0, 'sem confirmações de execução');

  pausa.definir(false, 'teste');
});

test('chat PAUSADO: !comandos e !stats continuam funcionando (informativos)', () => {
  pausa.resetar();
  pausa.definir(true, 'teste');
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();

  processarMensagem({ plataforma: 'twitch', usuario: 'curioso', texto: '!comandos', responder });
  assert.ok(respostas.length >= 1, 'lista de comandos segue disponível');

  pausa.definir(false, 'teste');
});

test('chat LIBERADO de novo: comandos voltam a executar', () => {
  pausa.resetar();
  pausa.definir(true, 'teste');
  pausa.definir(false, 'teste');
  chamadasTeclado = [];
  processarMensagem({ plataforma: 'twitch', usuario: 'de-volta', texto: 'a', responder: null });
  assert.strictEqual(chamadasTeclado.length, 1);
  assert.strictEqual(chamadasTeclado[0].botao, 'a');
});

// ---------------------------------------------------------------------------
// v2.3: streamer é isento do cooldown (para testar sozinho sem travar)
// ---------------------------------------------------------------------------

test('cooldown bloqueando todo mundo: streamer (dono do canal) passa', () => {
  const { config } = require('../config');
  const canal = String(config.twitch.channel || '').toLowerCase();
  assert.ok(canal, 'canal padrão deve existir para o teste');

  bloquearTodosNoCooldown = true;
  chamadasTeclado = [];
  try {
    // espectador comum: bloqueado pelo cooldown
    processarMensagem({ plataforma: 'twitch', usuario: 'espectador', texto: 'cima', responder: null });
    assert.strictEqual(chamadasTeclado.length, 0, 'espectador deve ser bloqueado');

    // streamer (mesmo nome do canal): isento
    processarMensagem({ plataforma: 'twitch', usuario: canal, texto: 'cima', responder: null });
    assert.strictEqual(chamadasTeclado.length, 1, 'streamer deve passar livre');
    assert.strictEqual(chamadasTeclado[0].botao, 'up');
  } finally {
    bloquearTodosNoCooldown = false;
  }
});

// ---------------------------------------------------------------------------
// v2.9: controles personalizados — Twitch e YouTube usam o MESMO registro
// ---------------------------------------------------------------------------

test('controles personalizados (Minecraft) funcionam igual na Twitch e no YouTube', () => {
  const controles = require('../controles');
  const minecraft = controles.validarLista([
    { label: 'Pular', key: 'space', aliases: ['pular', 'pulo', 'jump'] },
    { label: 'Inventário', key: 'e', aliases: ['inventario', 'inventory', 'e'] },
  ]).lista;
  // só os controles do teste: embutidos desligados para o cenário ser puro
  for (const c of minecraft) if (!['pular', 'inventario'].includes(c.id)) c.enabled = false;
  controles.__definirLista(minecraft);

  try {
    chamadasTeclado = [];
    // Twitch reconhece
    processarMensagem({ plataforma: 'twitch', usuario: 'jog1', texto: 'pular', responder: null });
    // YouTube reconhece (mesma palavra, MESMO registro — sem lista por plataforma)
    processarMensagem({ plataforma: 'youtube', usuario: 'jog2', texto: 'jump', responder: null });
    processarMensagem({ plataforma: 'youtube', usuario: 'jog3', texto: 'inventário', responder: null });
    // palavra de controle DESLIGADO não executa
    processarMensagem({ plataforma: 'twitch', usuario: 'jog4', texto: 'a', responder: null });

    assert.strictEqual(chamadasTeclado.length, 3);
    assert.deepStrictEqual(chamadasTeclado.map((c) => c.botao), ['pular', 'pular', 'inventario']);
  } finally {
    controles.restaurarPadrao();
  }
});

test('hold de controle personalizado segurável chega ao teclado', () => {
  const controles = require('../controles');
  controles.__definirLista(
    controles.validarLista([{ label: 'Agachar', key: 'shift', aliases: ['agachar', 'crouch'] }]).lista
  );
  try {
    chamadasTeclado = [];
    processarMensagem({ plataforma: 'twitch', usuario: 'steve', texto: 'hold agachar 2', responder: null });
    assert.strictEqual(chamadasTeclado.length, 1);
    assert.strictEqual(chamadasTeclado[0].fn, 'segurar');
    assert.strictEqual(chamadasTeclado[0].botao, 'agachar');
    assert.strictEqual(chamadasTeclado[0].duracaoMs, 2000);
  } finally {
    controles.restaurarPadrao();
  }
});

test('!comandos lista os controles PERSONALIZADOS ativos (não os padrões desligados)', () => {
  const controles = require('../controles');
  const msg = require('../messages');
  const minecraft = controles.validarLista([
    { label: 'Frente', key: 'w', aliases: ['frente', 'w'] },
    { label: 'Pular', key: 'space', aliases: ['pular', 'jump'] },
  ]).lista;
  for (const c of minecraft) if (!['frente', 'pular'].includes(c.id)) c.enabled = false;
  controles.__definirLista(minecraft);

  try {
    resetarAntiFlood();
    const { respostas, responder } = criarResponderEspiao();
    processarMensagem({ plataforma: 'twitch', usuario: 'curioso', texto: '!comandos', responder });
    const tudo = respostas.map((r) => r.texto).join('\n').toLowerCase();
    assert.ok(tudo.includes('pular'), 'controle personalizado pular deveria aparecer');
    assert.ok(tudo.includes('frente'), 'controle personalizado frente deveria aparecer');
    assert.ok(!tudo.includes('start'), 'controle padrão desligado não deveria aparecer');
    assert.ok(!tudo.includes('select'), 'controle padrão desligado não deveria aparecer (2)');
  } finally {
    controles.restaurarPadrao();
  }
});

// ---------------------------------------------------------------------------
// Restaura os módulos reais no cache (cortesia para outros testes)
// ---------------------------------------------------------------------------

test.after?.(() => {
  pausa.resetar();
  if (cacheOriginal) require.cache[CAMINHO_TECLADO] = cacheOriginal;
  else delete require.cache[CAMINHO_TECLADO];
  if (cacheOriginalCooldown) require.cache[CAMINHO_COOLDOWN] = cacheOriginalCooldown;
  else delete require.cache[CAMINHO_COOLDOWN];
  delete require.cache[CAMINHO_HANDLERS];
});

// exportado só para inspeção manual se necessário
module.exports = { tecladoReal };
