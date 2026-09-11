/**
 * Cliente YouTube Live Chat usando a YouTube Data API v3 — versão 2.6.
 *
 * Funcionamento:
 * 1. Dado o videoId de uma transmissão ao vivo (aceita ID puro OU a URL
 *    inteira colada do navegador — normalizado em src/config.js), chama
 *    videos.list para obter o activeLiveChatId.
 * 2. Em seguida, faz polling de liveChatMessages.list a cada 10 segundos
 *    (respeitando os quotas do YouTube).
 * 3. Cada nova mensagem é entregue ao pipeline central (src/handlers.js).
 *
 * v2.6 — diagnóstico de verdade:
 *  - Erros da API são CLASSIFICADOS (key inválida, quota, live encerrada,
 *    rede) com mensagem em português dizendo o que fazer.
 *  - Se a live ainda não começou (bot ligado antes da stream), o cliente
 *    re-tenta a cada 60s em vez de desistir na primeira tentativa.
 *  - Polling com falhas consecutivas contadas e backoff para quota.
 *
 * Limitações do YouTube (somente API Key, sem OAuth2):
 *  - LER mensagens: OK.
 *  - ENVIAR mensagens: não é possível (exige OAuth2).
 *    Por isso o `responder` passado ao pipeline é null.
 *
 * Quota diária padrão: 10.000 unidades; cada listagem custa ~5 unidades.
 */

const { google } = require('googleapis');
const logger = require('../utils/logger');
const { config } = require('../config');
const { processarMensagem } = require('../handlers');

const INTERVALO_POLLING_MS = 10000; // 10s
const INTERVALO_RECONNECT_MS = 30000; // 30s
const INTERVALO_AGUARDAR_LIVE_MS = 60000; // 60s (live ainda não começou)
const FALHAS_CONSECUTIVAS_MAX = 30; // ~5min de polling falhando = desiste

let youtubeClient = null;
let liveChatId = null;
let pollTimer = null;
let reconnectTimer = null;
let aguardarLiveTimer = null;
let pageToken = null;
let emExecucao = false;
let falhasSeguidas = 0;
let paradoPeloUsuario = false;

/**
 * Classifica um erro da YouTube Data API em algo acionável (v2.6).
 * @param {Error|any} err - erro capturado do googleapis
 * @returns {{tipo: string, mensagem: string}} tipo: 'chave_invalida' |
 *   'quota' | 'live_encerrada' | 'sem_chave' | 'video_invalido' | 'rede' |
 *   'api' | 'desconhecido'
 */
function interpretarErroApi(err) {
  const status =
    typeof err?.code === 'number' ? err.code : Number(err?.response?.status) || 0;
  const reason = String(err?.errors?.[0]?.reason || '');
  const msg = String(err?.message || 'erro desconhecido');

  if (status === 400 && /API key not valid/i.test(msg)) {
    return {
      tipo: 'chave_invalida',
      mensagem:
        'A YOUTUBE_API_KEY é inválida. Gere uma nova em ' +
        'https://console.cloud.google.com/ (ative a "YouTube Data API v3" e crie uma chave de API).',
    };
  }
  if (status === 403 && /unregistered callers|API consumer identity/i.test(msg)) {
    return {
      tipo: 'sem_chave',
      mensagem:
        'A requisição chegou ao YouTube sem chave. Verifique se YOUTUBE_API_KEY está preenchida no .env.',
    };
  }
  if (status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
    return {
      tipo: 'quota',
      mensagem:
        'Quota diária da API do YouTube excedida (padrão: 10.000 unidades). ' +
        'Ela zera à 0h (Horário do Pacífico). O bot vai reduzir o ritmo e tentar de novo.',
    };
  }
  if (
    (status === 403 || status === 400) &&
    (reason === 'liveChatEnded' || /live chat.*(ended|no longer)|live chat is (closed|over)/i.test(msg))
  ) {
    return {
      tipo: 'live_encerrada',
      mensagem:
        'Esta live foi encerrada. Se você começou uma NOVA live, atualize o YOUTUBE_VIDEO_ID no .env (cada live tem um ID novo).',
    };
  }
  if (status === 403) {
    return {
      tipo: 'api',
      mensagem:
        'O YouTube recusou a chamada (403' +
        (reason ? `, motivo: ${reason}` : '') +
        '). Verifique se a chave permite a YouTube Data API v3 e se o vídeo é seu.',
    };
  }
  if (status === 400 && /invalid filter|malformed|Invalid value/i.test(msg)) {
    return {
      tipo: 'video_invalido',
      mensagem:
        'O YOUTUBE_VIDEO_ID não parece válido. Use o ID do vídeo (a parte depois de "v=" na URL) ou cole a URL completa da live.',
    };
  }
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
    return {
      tipo: 'rede',
      mensagem: 'Falha de rede ao falar com o YouTube (requisição será repetida).',
    };
  }
  return {
    tipo: 'desconhecido',
    mensagem: `Erro inesperado do YouTube (${status || 'sem status'}): ${msg}`,
  };
}

/**
 * Busca o liveChatId do vídeo configurado.
 * @returns {Promise<{ok: boolean, motivo?: string, titulo?: string, aguardarLive?: boolean}>}
 */
async function descobrirLiveChatId() {
  const videoId = config.youtube.videoId;
  const resp = await youtubeClient.videos.list({
    part: 'liveStreamingDetails,snippet',
    id: videoId,
  });

  if (!resp.data.items || resp.data.items.length === 0) {
    return {
      ok: false,
      motivo:
        `Vídeo "${videoId}" não encontrado. Confira o YOUTUBE_VIDEO_ID no .env ` +
        '(cole o ID da live ou a URL completa — o bot extrai o ID sozinho).',
    };
  }

  const video = resp.data.items[0];
  const titulo = video.snippet?.title || '(sem título)';
  const canal = video.snippet?.channelTitle || '(sem canal)';
  const detalhes = video.liveStreamingDetails || {};

  if (detalhes.actualEndTime) {
    return {
      ok: false,
      motivo:
        `A live "${titulo}" já foi encerrada. Cada live nova tem um ID novo — ` +
        'atualize o YOUTUBE_VIDEO_ID (abra o iniciar.bat — o assistente abre preenchido).',
    };
  }

  if (!detalhes.activeLiveChatId) {
    // Sem chat ativo: pode ser uma transmissão agendada (ainda vai começar)
    // ou um vídeo comum (não é live). Nos dois casos, re-tentar não dói.
    const agendada = Boolean(detalhes.scheduledStartTime);
    return {
      ok: false,
      aguardarLive: true,
      motivo: agendada
        ? `A live "${titulo}" está agendada e ainda não começou (${detalhes.scheduledStartTime}). Tentando de novo em ${INTERVALO_AGUARDAR_LIVE_MS / 1000}s...`
        : `O vídeo "${titulo}" (${canal}) não tem chat ao vivo ativo. Não parece ser uma live em andamento — vou conferir de novo em ${INTERVALO_AGUARDAR_LIVE_MS / 60}s (se a live começar, eu conecto sozinho).`,
    };
  }

  return { ok: true, titulo, canal, liveChatId: detalhes.activeLiveChatId };
}

/**
 * Inicia o cliente YouTube: obtém o activeLiveChatId e começa o polling.
 * Se a live ainda não começou, agenda re-tentativa (não desiste).
 * @returns {Promise<boolean>}
 */
async function iniciar() {
  paradoPeloUsuario = false;

  if (!config.youtube.apiKey || !config.youtube.videoId) {
    logger.erro('[YouTube] API key ou videoId não configurados. Verifique o arquivo .env.');
    return false;
  }

  youtubeClient = google.youtube({
    version: 'v3',
    auth: config.youtube.apiKey,
  });

  logger.youtube(`Buscando liveChatId para o vídeo ${config.youtube.videoId}...`);

  try {
    const resultado = await descobrirLiveChatId();

    if (!resultado.ok) {
      logger.erro(`[YouTube] ${resultado.motivo}`);
      if (resultado.aguardarLive && !paradoPeloUsuario) {
        agendarAguardarLive();
      }
      return false;
    }

    liveChatId = resultado.liveChatId;
    logger.youtube(`Conectado ao chat da live: "${resultado.titulo}" no canal ${resultado.canal}`);
    logger.youtube(`liveChatId: ${liveChatId}`);

    iniciarPolling();
    return true;
  } catch (err) {
    const diagnostico = interpretarErroApi(err);
    logger.erro(`[YouTube] ${diagnostico.mensagem}`);
    return false;
  }
}

/**
 * Re-tenta a conexão quando a live ainda não começou (v2.6).
 */
function agendarAguardarLive() {
  if (aguardarLiveTimer || paradoPeloUsuario) return;
  aguardarLiveTimer = setTimeout(() => {
    aguardarLiveTimer = null;
    if (paradoPeloUsuario) return;
    logger.youtube('Conferindo se a live já começou...');
    iniciar().catch(() => { /* erros já logados dentro do iniciar */ });
  }, INTERVALO_AGUARDAR_LIVE_MS);
  agendarAguardarLiveTimer.unref?.();
}

/**
 * Inicia o polling de mensagens do live chat.
 */
function iniciarPolling() {
  if (pollTimer) clearInterval(pollTimer);
  emExecucao = false;
  falhasSeguidas = 0;

  // Primeira busca imediata
  buscarMensagens();

  // Depois, a cada 10 segundos
  pollTimer = setInterval(buscarMensagens, INTERVALO_POLLING_MS);
  logger.youtube(`Polling iniciado (a cada ${INTERVALO_POLLING_MS / 1000}s).`);
}

/**
 * Busca novas mensagens do live chat do YouTube.
 */
async function buscarMensagens() {
  if (!liveChatId || emExecucao) return;
  emExecucao = true;

  try {
    const params = {
      liveChatId,
      part: 'id,snippet,authorDetails',
      maxResults: 200,
    };
    if (pageToken) params.pageToken = pageToken;

    const resp = await youtubeClient.liveChatMessages.list(params);

    pageToken = resp.data.nextPageToken || null;
    const mensagens = resp.data.items || [];

    if (falhasSeguidas > 0) {
      logger.youtube(`[YouTube] Conexão retomada após ${falhasSeguidas} tentativa(s) falha(s).`);
    }
    falhasSeguidas = 0;

    for (const item of mensagens) {
      const autor = item.authorDetails?.displayName || 'desconhecido';
      const texto = item.snippet?.displayMessage || '';
      if (texto) {
        // YouTube com API key não permite responder: responder = null
        processarMensagem({
          plataforma: 'youtube',
          usuario: autor,
          texto,
          responder: null,
        });
      }
    }
  } catch (err) {
    falhasSeguidas++;
    const diagnostico = interpretarErroApi(err);

    // Log espaçado: a 1ª falha, depois a cada 5 — evita spam em lives longas
    if (falhasSeguidas === 1 || falhasSeguidas % 5 === 0) {
      logger.erro(`[YouTube] ${diagnostico.mensagem} (falha consecutiva nº ${falhasSeguidas})`);
    }

    if (diagnostico.tipo === 'live_encerrada') {
      // Live acabou: parar de vez (polling não tem pra onde voltar)
      pararPolling();
      logger.youtube('[YouTube] Polling encerrado (a live terminou). Até a próxima!');
      return;
    }

    if (diagnostico.tipo === 'quota') {
      // Backoff: 60s dobrando até 5min
      const espera = Math.min(60000 * Math.pow(2, Math.ceil(falhasSeguidas / 3) - 1), 300000);
      agendarReconnect(espera);
    } else if (falhasSeguidas >= FALHAS_CONSECUTIVAS_MAX) {
      // ~5min de falhas sem diagnóstico recuperável: pausa o polling
      pararPolling();
      logger.erro(
        `[YouTube] ${FALHAS_CONSECUTIVAS_MAX} falhas consecutivas — polling pausado. ` +
        'Verifique sua conexão / chave de API e reinicie o bot.'
      );
    }
    // Erros de rede/API pontuais: o próximo tick do intervalo tenta de novo.
  } finally {
    emExecucao = false;
  }
}

/**
 * Agenda tentativa de reconexão (quota / erros repetidos).
 * @param {number} [esperaMs=INTERVALO_RECONNECT_MS]
 */
function agendarReconnect(esperaMs = INTERVALO_RECONNECT_MS) {
  if (reconnectTimer) return;
  pararPolling();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (paradoPeloUsuario) return;
    logger.youtube('Tentando retomar o polling...');
    iniciarPolling();
  }, esperaMs);
  reconnectTimer.unref?.();
}

/**
 * Para o polling atual.
 */
function pararPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Para o cliente YouTube totalmente.
 */
function parar() {
  paradoPeloUsuario = true;
  pararPolling();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (aguardarLiveTimer) {
    clearTimeout(aguardarLiveTimer);
    aguardarLiveTimer = null;
  }
  liveChatId = null;
  pageToken = null;
  logger.youtube('Cliente desconectado.');
}

module.exports = {
  iniciar,
  parar,
  // v2.6: exposto para os testes unitários do diagnóstico de erros
  interpretarErroApi,
};
