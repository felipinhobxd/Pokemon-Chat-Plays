/**
 * Testes do cliente Twitch (v2.5.2) — mensagens do SISTEMA sem Twitch.
 *
 * REGRESSÃO v2.5.2: num setup só-YouTube (ACTIVE_PLATFORMS=youtube) com
 * democracia ativa, o executor da votação chamava twitch.enviarMensagem a
 * cada janela de 10s — e cada chamada logava "[Twitch] Cliente não
 * conectado...". Com a Twitch nem ativa, isso é spam puro de terminal
 * (~360 avisos/hora). Garantias destes testes:
 *  1. Twitch fora das plataformas ativas: NENHUM aviso (só debug);
 *  2. Twitch ativa mas desconectada: no máximo 1 aviso por minuto
 *     (throttle — o tmi.js reconecta sozinho, repetir não recupera nada).
 */

const test = require('node:test');
const assert = require('node:assert');

const twitch = require('../controllers/twitch');
const { config } = require('../config');
const logger = require('../utils/logger');

/** Conta chamadas de logger.aviso enquanto intercepta. */
function espiarAvisos(fn) {
  const avisoOriginal = logger.aviso;
  const debugOriginal = logger.debug;
  const estado = { avisos: 0, debugs: 0 };
  logger.aviso = () => { estado.avisos += 1; };
  logger.debug = () => { estado.debugs += 1; };
  try {
    fn();
  } finally {
    logger.aviso = avisoOriginal;
    logger.debug = debugOriginal;
  }
  return estado;
}

test('twitch.enviarMensagem: plataforma INATIVA não gera aviso (só-YouTube não vira spam)', () => {
  const ativasOriginal = config.geral.plataformasAtivas;
  config.geral.plataformasAtivas = ['youtube'];
  try {
    const r = espiarAvisos(() => {
      // uma live inteira de democracia: uma janela a cada "10s"
      for (let i = 0; i < 30; i++) {
        twitch.enviarMensagem('🗳️ O CHAT decidiu: ⬆ CIMA — 3 votos');
      }
    });
    assert.strictEqual(r.avisos, 0, 'nenhum aviso com a Twitch desativada');
    assert.strictEqual(r.debugs, 30, 'cada mensagem vira debug rastreável');
  } finally {
    config.geral.plataformasAtivas = ativasOriginal;
  }
});

test('twitch.enviarMensagem: desconectado avisa 1x por minuto (throttle)', () => {
  const ativasOriginal = config.geral.plataformasAtivas;
  config.geral.plataformasAtivas = ['twitch'];
  twitch.__resetTeste();
  try {
    // cliente nunca conectou -> cliente === null -> cai no aviso
    const r = espiarAvisos(() => {
      for (let i = 0; i < 10; i++) {
        twitch.enviarMensagem('⛔ CHAT PAUSADO');
      }
    });
    assert.strictEqual(r.avisos, 1, '10 chamadas seguidas -> 1 aviso apenas');
    assert.strictEqual(r.debugs, 9, 'as demais viram debug');
  } finally {
    config.geral.plataformasAtivas = ativasOriginal;
    twitch.__resetTeste();
  }
});
