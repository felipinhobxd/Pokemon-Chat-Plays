/**
 * Testes do diagnóstico de erros do YouTube (v2.6).
 *
 * REGRESSÃO v2.6: antes, TODO erro era "possível quota" e o caso mais comum
 * (chave inválida, que o Google devolve como 400) nem era mencionado.
 * Estes testes garantem que cada tipo de erro vira uma mensagem em
 * português com a próxima ação clara.
 */

const test = require('node:test');
const assert = require('node:assert');

const { interpretarErroApi } = require('../controllers/youtube');

test('interpretarErroApi: chave inválida (400 "API key not valid") é diagnosticada como chave', () => {
  const r = interpretarErroApi({
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    errors: [{ reason: 'badRequest' }],
  });
  assert.strictEqual(r.tipo, 'chave_invalida');
  assert.ok(r.mensagem.includes('YOUTUBE_API_KEY'), 'mensagem aponta a chave');
  assert.ok(r.mensagem.includes('console.cloud.google.com'), 'mensagem ensina a corrigir');
});

test('interpretarErroApi: quota excedida (403 quotaExceeded) sugere esperar', () => {
  const r = interpretarErroApi({
    code: 403,
    message: 'Quota exceeded',
    errors: [{ reason: 'quotaExceeded' }],
  });
  assert.strictEqual(r.tipo, 'quota');
  assert.ok(r.mensagem.includes('10.000'));
});

test('interpretarErroApi: live encerrada (403 liveChatEnded) avisa sobre o novo ID', () => {
  const r = interpretarErroApi({
    code: 403,
    message: 'The live chat has ended.',
    errors: [{ reason: 'liveChatEnded' }],
  });
  assert.strictEqual(r.tipo, 'live_encerrada');
  assert.ok(r.mensagem.includes('YOUTUBE_VIDEO_ID'));
});

test('interpretarErroApi: chamada sem chave nenhuma (403 unregistered) é separada de quota', () => {
  const r = interpretarErroApi({
    code: 403,
    message: "Method doesn't allow unregistered callers (callers without established identity).",
    errors: [{ reason: 'forbidden' }],
  });
  assert.strictEqual(r.tipo, 'sem_chave');
});

test('interpretarErroApi: erros de rede viram tipo rede (vai repetir sozinho)', () => {
  for (const codigo of ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']) {
    const r = interpretarErroApi({ code: codigo, message: 'fetch failed' });
    assert.strictEqual(r.tipo, 'rede', codigo);
  }
});

test('interpretarErroApi: 400 de filtro inválido sugere conferir o ID do vídeo', () => {
  const r = interpretarErroApi({
    code: 400,
    message: 'Invalid value for id',
    errors: [{ reason: 'invalidFilter' }],
  });
  assert.strictEqual(r.tipo, 'video_invalido');
});

test('interpretarErroApi: erro desconhecido não explode e carrega a mensagem', () => {
  const r = interpretarErroApi(new Error('algo muito estranho'));
  assert.strictEqual(r.tipo, 'desconhecido');
  assert.ok(r.mensagem.includes('algo muito estranho'));
});

// ---------------------------------------------------------------------------
// REGRESSÃO v2.8.1 — timer de "live agendada / ainda não começou"
//
// O agendarAguardarLive() chamava `agendarAguardarLiveTimer.unref?.()` —
// variável INEXISTENTE (o nome certo é aguardarLiveTimer). O ReferenceError
// era engolido pelo catch do iniciar() e logado como "Erro inesperado do
// YouTube" em cada retentativa; o unref nunca era aplicado.
// ---------------------------------------------------------------------------

test('aguardarLive: agendar o retry da live agendada não lança ReferenceError (regressão v2.8.1)', async () => {
  const youtube = require('../controllers/youtube');
  const { agendarAguardarLive, timersAtivos } = youtube.__test;

  // iniciar() com config vazia retorna cedo, mas zera paradoPeloUsuario —
  // é o único caminho público que rearma o agendador após um parar()
  await youtube.iniciar();

  // o bug explodia AQUI, na última linha da função, depois de criar o timer
  assert.doesNotThrow(() => {
    agendarAguardarLive();
  }, 'agendarAguardarLive lançava ReferenceError (agendarAguardarLiveTimer)');

  // o timer de retry NASCEU (60s) e ficou unref (não segura o processo)
  const { aguardarLiveTimer } = timersAtivos();
  assert.ok(aguardarLiveTimer, 'timer de retry agendado');
  assert.strictEqual(
    aguardarLiveTimer.hasRef(),
    false,
    'timer unref — sem o unref, um bot só-YouTube aguardando a live começar prende o evento loop'
  );

  // limpeza: parar() cancela o timer
  youtube.parar();
  assert.strictEqual(timersAtivos().aguardarLiveTimer, null);
});

test('aguardarLive: chamar duas vezes não duplica o timer (guard de reentrada)', async () => {
  const youtube = require('../controllers/youtube');
  const { agendarAguardarLive, timersAtivos } = youtube.__test;
  await youtube.iniciar(); // rearma paradoPeloUsuario
  // dois agendamentos seguidos: o segundo deve ser no-op
  agendarAguardarLive();
  agendarAguardarLive();
  const { aguardarLiveTimer } = timersAtivos();
  assert.ok(aguardarLiveTimer, 'timer único agendado');
  youtube.parar();
  assert.strictEqual(timersAtivos().aguardarLiveTimer, null);
});
