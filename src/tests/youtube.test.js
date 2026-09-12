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

// ---------------------------------------------------------------------------
// REGRESSÃO v3.1.x — quota diária não pode ficar spammando a live inteira.
// A primeira ocorrência explica o problema. Se a API confirmar quota de novo,
// o cliente entra em circuit breaker e fica offline até reativação explícita.
// ---------------------------------------------------------------------------

test('quota: mensagem detalhada aparece uma vez e a segunda ocorrência suspende o YouTube', () => {
  const youtube = require('../controllers/youtube');
  const logger = require('../utils/logger');
  const { registrarFalhaQuota, estadoQuota, resetarEstadoQuota, agendarReconexaoInicial, timersAtivos } = youtube.__test;
  const erroOriginal = logger.erro;
  const avisoOriginal = logger.aviso;
  const erros = [];
  const avisos = [];

  resetarEstadoQuota();
  logger.erro = (msg) => erros.push(String(msg));
  logger.aviso = (msg) => avisos.push(String(msg));

  try {
    const diagnostico = {
      tipo: 'quota',
      mensagem:
        'Quota diária da API do YouTube excedida (padrão: 10.000 unidades). ' +
        'Ela zera à 0h (Horário do Pacífico). O bot vai reduzir o ritmo e tentar de novo.',
    };

    assert.strictEqual(registrarFalhaQuota(diagnostico, ' (falha consecutiva nº 1)'), false);
    assert.strictEqual(estadoQuota().suspenso, false);

    assert.strictEqual(registrarFalhaQuota(diagnostico, ' (falha consecutiva nº 2)'), true);
    assert.strictEqual(estadoQuota().suspenso, true);

    // Mesmo que algum callback velho tente registrar outra vez, a mensagem
    // grande e o aviso de suspensão não podem virar spam.
    assert.strictEqual(registrarFalhaQuota(diagnostico, ' (falha consecutiva nº 3)'), true);

    assert.strictEqual(
      erros.filter((msg) => msg.includes('Quota diária da API do YouTube excedida')).length,
      1,
      'a mensagem de quota deve aparecer exatamente uma vez por ativação'
    );
    assert.strictEqual(
      avisos.filter((msg) => msg.includes('Quota excedida novamente')).length,
      1,
      'o circuit breaker deve avisar uma única vez'
    );

    const estado = estadoQuota();
    assert.strictEqual(estado.ocorrencias, 3);
    assert.strictEqual(estado.mensagemExibida, true);
    assert.strictEqual(estado.suspenso, true);

    agendarReconexaoInicial(1);
    assert.strictEqual(timersAtivos().reconnectTimer, null, 'suspenso por quota não agenda reconexão');
  } finally {
    logger.erro = erroOriginal;
    logger.aviso = avisoOriginal;
    resetarEstadoQuota();
    youtube.parar();
  }
});

// ---------------------------------------------------------------------------
// REGRESSÃO v3.1.x (parte 2) — ciclo COMPLETO do circuit breaker de quota,
// exercitado pelo pipeline REAL de polling com um cliente falso (nenhuma
// chamada de rede). Cobre os 11 pontos exigidos:
//   1. 1ª ocorrência: mensagem detalhada UMA vez;
//   2. 2ª ocorrência confirmada abre o breaker;
//   3. a 2ª NÃO repete a mensagem detalhada;
//   4. ocorrências seguintes não geram spam;
//   5. timers de polling/reconexão cancelados na suspensão;
//   6. timer velho (stale) não reinicia o YouTube;
//   7. estado de conexão/painel vira desconectado (e SUSPENSO — QUOTA);
//   8. Twitch segue intacto;
//   9. parar() segue seguro/idempotente;
//   10. reativação explícita reseta o breaker;
//   11. erro de rede NÃO vira suspensão por quota.
// ---------------------------------------------------------------------------

/** Cliente falso que lança o erro que o teste quiser (e conta as chamadas). */
function clienteQueFalha(erro) {
  const chamadas = { list: 0 };
  return {
    chamadas,
    liveChatMessages: {
      list: async () => {
        chamadas.list++;
        throw erro;
      },
    },
  };
}

const ERRO_QUOTA = Object.freeze({
  code: 403,
  message: 'Quota exceeded',
  errors: [{ reason: 'quotaExceeded' }],
});

const ERRO_REDE = Object.freeze({ code: 'ETIMEDOUT', message: 'fetch failed' });

/** Captura os logs do logger para inspecionar o que o chat veria. */
function espiarLogger() {
  const logger = require('../utils/logger');
  const original = { erro: logger.erro, aviso: logger.aviso, youtube: logger.youtube };
  const registros = { erro: [], aviso: [], youtube: [] };
  logger.erro = (m) => registros.erro.push(String(m));
  logger.aviso = (m) => registros.aviso.push(String(m));
  logger.youtube = (m) => registros.youtube.push(String(m));
  return {
    registros,
    restaurar() {
      logger.erro = original.erro;
      logger.aviso = original.aviso;
      logger.youtube = original.youtube;
    },
  };
}

test('quota (pipeline real): 1ª ocorrência loga detalhado UMA vez e agenda backoff', async () => {
  const youtube = require('../controllers/youtube');
  const overlay = require('../overlay');
  const espiao = espiarLogger();
  const cliente = clienteQueFalha(ERRO_QUOTA);

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(cliente);
  youtube.__test.definirLiveChatId('live-teste');
  overlay.setConexao('youtube', true);
  overlay.setConexao('twitch', true);

  try {
    await youtube.__test.buscarMensagens(); // 1ª ocorrência

    const estado = youtube.__test.estadoQuota();
    assert.strictEqual(estado.suspenso, false, '1ª ocorrência não suspende');
    assert.strictEqual(estado.mensagemExibida, true);
    // 1. mensagem DETALHADA apareceu exatamente uma vez
    const detalhadas = espiao.registros.erro.filter((m) => m.includes('Quota diária da API do YouTube'));
    assert.strictEqual(detalhadas.length, 1, 'mensagem detalhada de quota exatamente 1 vez');
    // backoff agendado (retry automático ainda permitido na 1ª)
    assert.ok(youtube.__test.timersAtivos().reconnectTimer, '1ª ocorrência agenda retry com backoff');
    assert.strictEqual(youtube.__test.quotaBackoff(), 120000, 'backoff dobra (60s → 120s)');
  } finally {
    espiao.restaurar();
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});

test('quota (pipeline real): 2ª ocorrência suspende, cancela TODOS os timers e não repete o detalhe', async () => {
  const youtube = require('../controllers/youtube');
  const overlay = require('../overlay');
  const espiao = espiarLogger();
  const cliente = clienteQueFalha(ERRO_QUOTA);

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(cliente);
  youtube.__test.definirLiveChatId('live-teste');
  overlay.setConexao('youtube', true);
  overlay.setConexao('twitch', true);

  try {
    await youtube.__test.buscarMensagens(); // 1ª → agenda reconnectTimer
    assert.ok(youtube.__test.timersAtivos().reconnectTimer, 'retry agendado após a 1ª');
    const timerDaPrimeira = youtube.__test.timersAtivos().reconnectTimer;

    await youtube.__test.buscarMensagens(); // 2ª → abre o circuit breaker

    // 2. breaker aberto
    assert.strictEqual(youtube.__test.estadoQuota().suspenso, true);

    // 5. TODOS os timers cancelados (o timer agendado pela 1ª ocorrência morreu)
    const timers = youtube.__test.timersAtivos();
    assert.strictEqual(timers.pollTimer, null, 'pollTimer cancelado');
    assert.strictEqual(timers.reconnectTimer, null, 'reconnectTimer (agendado pela 1ª) cancelado');
    assert.strictEqual(timers.aguardarLiveTimer, null, 'aguardarLiveTimer cancelado');
    assert.ok(timerDaPrimeira, 'sanity: havia um timer para cancelar');

    // 3. a mensagem DETALHADA não se repetiu
    const detalhadas = espiao.registros.erro.filter((m) => m.includes('Quota diária da API do YouTube'));
    assert.strictEqual(detalhadas.length, 1, 'sem repetição da mensagem detalhada');

    // 6. aviso final ÚNICO e conciso
    const avisosFinais = espiao.registros.aviso.filter((m) => m.includes('Quota excedida novamente'));
    assert.strictEqual(avisosFinais.length, 1, 'aviso de suspensão exatamente 1 vez');
    assert.ok(avisosFinais[0].includes('suspenso'), 'aviso diz que ficou suspenso');

    // 4. ocorrências seguintes: NADA novo (nem detalhe, nem aviso, nem retry)
    await youtube.__test.buscarMensagens(); // 3ª — callback velho/stale
    await youtube.__test.buscarMensagens(); // 4ª
    assert.strictEqual(
      espiao.registros.erro.filter((m) => m.includes('Quota diária')).length,
      1,
      'sem spam de quota nas ocorrências seguintes'
    );
    assert.strictEqual(
      espiao.registros.aviso.filter((m) => m.includes('Quota excedida novamente')).length,
      1,
      'aviso final não se repete'
    );
    // e nenhuma chamada nova à API depois da suspensão
    const chamadasAte2 = cliente.chamadas.list;
    await youtube.__test.buscarMensagens(); // guard: nem chega a chamar
    assert.strictEqual(cliente.chamadas.list, chamadasAte2, 'suspenso não faz chamadas à API');

    // 7. estado de conexão/painel: desconectado + suspenso por quota
    const snap = overlay.snapshot();
    assert.strictEqual(snap.conexoes.youtube, false, 'painel: YouTube desconectado');
    assert.strictEqual(snap.youtubeSuspensoQuota, true, 'painel: SUSPENSO — QUOTA');

    // 8. Twitch segue intacto
    assert.strictEqual(snap.conexoes.twitch, true, 'Twitch não é afetado pela suspensão do YouTube');

    // 6 (stale timer): nenhum timer sobreviveu — nada pode acordar o YouTube
    assert.ok(
      !youtube.__test.timersAtivos().reconnectTimer,
      'nenhum timer vivo: um timer velho não pode reiniciar o YouTube'
    );
  } finally {
    espiao.restaurar();
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});

test('quota: agendadores são no-op durante a suspensão (timer velho não reinicia)', async () => {
  const youtube = require('../controllers/youtube');
  const cliente = clienteQueFalha(ERRO_QUOTA);

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(cliente);
  youtube.__test.definirLiveChatId('live-teste');

  try {
    await youtube.__test.buscarMensagens();
    await youtube.__test.buscarMensagens(); // suspende
    assert.strictEqual(youtube.__test.estadoQuota().suspenso, true);

    // tentativas de agendar QUALQUER timer durante a suspensão: no-op
    youtube.__test.agendarReconexaoInicial(1);
    youtube.__test.agendarAguardarLive();
    const timers = youtube.__test.timersAtivos();
    assert.strictEqual(timers.reconnectTimer, null, 'agendarReconexaoInicial é no-op');
    assert.strictEqual(timers.aguardarLiveTimer, null, 'agendarAguardarLive é no-op');
  } finally {
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});

test('quota: parar() permanece seguro e idempotente durante/antes da suspensão', async () => {
  const youtube = require('../controllers/youtube');
  const cliente = clienteQueFalha(ERRO_QUOTA);

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(cliente);
  youtube.__test.definirLiveChatId('live-teste');

  try {
    await youtube.__test.buscarMensagens();
    await youtube.__test.buscarMensagens();
    assert.doesNotThrow(() => youtube.parar(), 'parar() suspenso não lança');
    assert.doesNotThrow(() => youtube.parar(), 'parar() de novo não lança (idempotente)');
    const timers = youtube.__test.timersAtivos();
    assert.strictEqual(timers.pollTimer, null);
    assert.strictEqual(timers.reconnectTimer, null);
    assert.strictEqual(timers.aguardarLiveTimer, null);
  } finally {
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});

test('quota: reativação explícita reseta o breaker e a sessão começa do zero', async () => {
  const youtube = require('../controllers/youtube');
  const overlay = require('../overlay');
  const espiao = espiarLogger();

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(clienteQueFalha(ERRO_QUOTA));
  youtube.__test.definirLiveChatId('live-teste');

  try {
    await youtube.__test.buscarMensagens();
    await youtube.__test.buscarMensagens();
    assert.strictEqual(youtube.__test.estadoQuota().suspenso, true);
    assert.strictEqual(overlay.snapshot().youtubeSuspensoQuota, true);

    // reativação explícita pelo streamer (mesmo caminho do botão do painel)
    await youtube.reativar();

    const estado = youtube.__test.estadoQuota();
    assert.strictEqual(estado.suspenso, false, 'breaker rearmando');
    assert.strictEqual(estado.ocorrencias, 0, 'contador zerado');
    assert.strictEqual(estado.mensagemExibida, false, 'mensagem detalhada rearmada p/ nova sessão');
    assert.strictEqual(overlay.snapshot().youtubeSuspensoQuota, false, 'painel deixa de mostrar SUSPENSO');

    // nova sessão: a PRÓXIMA ocorrência de quota é tratada como 1ª de novo
    youtube.__test.definirCliente(clienteQueFalha(ERRO_QUOTA));
    youtube.__test.definirLiveChatId('live-teste');
    await youtube.__test.buscarMensagens();
    const novoEstado = youtube.__test.estadoQuota();
    assert.strictEqual(novoEstado.ocorrencias, 1, 'conta a partir de 1 de novo');
    assert.strictEqual(novoEstado.suspenso, false, 'uma ocorrência não suspende a nova sessão');
    const detalhadas = espiao.registros.erro.filter((m) => m.includes('Quota diária da API do YouTube'));
    assert.strictEqual(detalhadas.length, 2, 'a nova sessão explica a quota 1 vez (msg anterior + esta)');
  } finally {
    espiao.restaurar();
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});

test('quota: erro de rede NÃO abre o circuit breaker (só quota confirmada)', async () => {
  const youtube = require('../controllers/youtube');
  const overlay = require('../overlay');
  const espiao = espiarLogger();
  const cliente = clienteQueFalha(ERRO_REDE);

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(cliente);
  youtube.__test.definirLiveChatId('live-teste');

  try {
    for (let i = 0; i < 8; i++) {
      await youtube.__test.buscarMensagens(); // muitas falhas de rede seguidas
    }
    const estado = youtube.__test.estadoQuota();
    assert.strictEqual(estado.ocorrencias, 0, 'erro de rede não conta como ocorrência de quota');
    assert.strictEqual(estado.suspenso, false, 'erro de rede não suspende o YouTube');
    assert.strictEqual(estado.mensagemExibida, false);
    assert.strictEqual(overlay.snapshot().youtubeSuspensoQuota, false);
    // e a mensagem de quota NUNCA apareceu
    assert.strictEqual(
      espiao.registros.erro.filter((m) => m.includes('Quota diária')).length,
      0,
      'mensagem de quota não pode aparecer para erro de rede'
    );
  } finally {
    espiao.restaurar();
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});

test('quota: resposta da API que chega ATRÁS da suspensão não marca conectado', async () => {
  const youtube = require('../controllers/youtube');
  const overlay = require('../overlay');
  const { recarregar } = require('../config');
  const googleapis = require('googleapis');

  // iniciar() substitui o cliente interno por google.youtube(...): sem isto,
  // o teste faria uma chamada de rede REAL com a chave falsa.
  const fabricaOriginal = googleapis.google.youtube;
  const clienteFake = {
    videos: {
      list: async () => {
        await new Promise((r) => setTimeout(r, 30)); // resposta DEMORA
        return {
          data: {
            items: [{
              snippet: { title: 'Live Teste', channelTitle: 'Canal' },
              liveStreamingDetails: { activeLiveChatId: 'live-teste' },
            }],
          },
        };
      },
    },
    liveChatMessages: {
      list: async () => {
        throw ERRO_QUOTA;
      },
    },
  };
  googleapis.google.youtube = () => clienteFake;

  const envOriginal = {
    apiKey: process.env.YOUTUBE_API_KEY,
    videoId: process.env.YOUTUBE_VIDEO_ID,
  };
  process.env.YOUTUBE_API_KEY = 'chave-de-teste';
  process.env.YOUTUBE_VIDEO_ID = 'videoDeTeste';
  recarregar();

  youtube.__test.resetarEstadoQuota();
  youtube.__test.definirCliente(clienteFake);
  youtube.__test.definirLiveChatId('live-teste');
  overlay.setConexao('youtube', true);

  try {
    // 1ª ocorrência de quota
    await youtube.__test.buscarMensagens();

    // iniciar() entra em espera da API; ENQUANTO isso a 2ª ocorrência
    // abre o circuit breaker
    const promessaIniciar = youtube.iniciar();
    await youtube.__test.buscarMensagens();
    assert.strictEqual(youtube.__test.estadoQuota().suspenso, true, 'sanity: breaker aberto');

    // a resposta atrasada da API chega agora — não pode "conectar"
    const ok = await promessaIniciar;
    assert.strictEqual(ok, false, 'iniciar() não pode conectar com o breaker aberto');
    const snap = overlay.snapshot();
    assert.strictEqual(snap.conexoes.youtube, false, 'nunca "conectado" enquanto suspenso');
    assert.strictEqual(snap.youtubeSuspensoQuota, true, 'painel continua SUSPENSO — QUOTA');
    assert.strictEqual(youtube.__test.timersAtivos().pollTimer, null, 'polling não subiu');
  } finally {
    googleapis.google.youtube = fabricaOriginal;
    if (envOriginal.apiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = envOriginal.apiKey;
    if (envOriginal.videoId === undefined) delete process.env.YOUTUBE_VIDEO_ID;
    else process.env.YOUTUBE_VIDEO_ID = envOriginal.videoId;
    recarregar();
    youtube.__test.resetarEstadoQuota();
    youtube.parar();
  }
});
