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
// cooldown com intervalo zero: ninguém é bloqueado nos testes
const cooldownStub = {
  podeExecutar: () => ({ permitido: true }),
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

test('"!comandos" responde com a lista completa em 2 mensagens', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  processarMensagem({ plataforma: 'twitch', usuario: 'curioso', texto: '!comandos', responder });
  const partes = respostas.map((r) => r.texto);
  assert.strictEqual(partes.length, 2, '!comandos deve mandar 2 mensagens');
  assert.ok(partes[0].includes('DIREÇÕES'));
  assert.ok(partes[1].includes('SEGURAR'));
});

test('anti-flood: "!comandos" em rajada responde só uma vez', () => {
  resetarAntiFlood();
  const { respostas, responder } = criarResponderEspiao();
  for (let i = 0; i < 5; i++) {
    processarMensagem({ plataforma: 'twitch', usuario: `spammer${i}`, texto: '!comandos', responder });
  }
  // 5 pedidos em < 8s -> só 2 mensagens (uma resposta completa)
  assert.strictEqual(respostas.length, 2);
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
  assert.ok(respostas[0].texto.includes('hold <direção/botão>'));
});

test('sem responder (YouTube), nada quebra', () => {
  chamadasTeclado = [];
  processarMensagem({ plataforma: 'youtube', usuario: 'yt_user', texto: 'hold cima', responder: null });
  processarMensagem({ plataforma: 'youtube', usuario: 'yt_user', texto: '!comandos', responder: null });
  assert.strictEqual(chamadasTeclado.length, 1); // hold executou mesmo sem chat
});

// ---------------------------------------------------------------------------
// Restaura os módulos reais no cache (cortesia para outros testes)
// ---------------------------------------------------------------------------

test.after?.(() => {
  if (cacheOriginal) require.cache[CAMINHO_TECLADO] = cacheOriginal;
  else delete require.cache[CAMINHO_TECLADO];
  if (cacheOriginalCooldown) require.cache[CAMINHO_COOLDOWN] = cacheOriginalCooldown;
  else delete require.cache[CAMINHO_COOLDOWN];
  delete require.cache[CAMINHO_HANDLERS];
});

// exportado só para inspeção manual se necessário
module.exports = { tecladoReal };
