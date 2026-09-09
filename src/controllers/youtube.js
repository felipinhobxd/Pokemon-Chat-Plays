/**
 * Cliente YouTube Live Chat usando a YouTube Data API v3 — versão 2.2.
 *
 * Funcionamento:
 * 1. Dado o videoId de uma transmissão ao vivo, chama videos.list
 *    para obter o activeLiveChatId.
 * 2. Em seguida, faz polling de liveChatMessages.list a cada 10 segundos
 *    (respeitando os quotas do YouTube).
 * 3. Cada nova mensagem é entregue ao pipeline central (src/handlers.js).
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

let youtubeClient = null;
let liveChatId = null;
let pollTimer = null;
let reconnectTimer = null;
let pageToken = null;
let emExecucao = false;

/**
 * Inicia o cliente YouTube: obtém o activeLiveChatId e começa o polling.
 * @returns {Promise<boolean>}
 */
async function iniciar() {
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
    const resp = await youtubeClient.videos.list({
      part: 'liveStreamingDetails,snippet',
      id: config.youtube.videoId,
    });

    if (!resp.data.items || resp.data.items.length === 0) {
      logger.erro('[YouTube] Vídeo não encontrado ou não é uma transmissão ao vivo.');
      return false;
    }

    const video = resp.data.items[0];
    liveChatId = video.liveStreamingDetails?.activeLiveChatId;

    if (!liveChatId) {
      logger.erro('[YouTube] Esta transmissão não possui liveChatId ativo. A live pode estar offline.');
      return false;
    }

    const titulo = video.snippet?.title || '(sem título)';
    const canalYt = video.snippet?.channelTitle || '(sem canal)';
    logger.youtube(`Conectado ao chat da live: "${titulo}" no canal ${canalYt}`);
    logger.youtube(`liveChatId: ${liveChatId}`);

    iniciarPolling();
    return true;
  } catch (err) {
    logger.erro(`[YouTube] Erro ao buscar liveChatId: ${err.message}`);
    if (err.code === 403) {
      logger.erro('[YouTube] Possível erro de quota ou API key inválida.');
    }
    return false;
  }
}

/**
 * Inicia o polling de mensagens do live chat.
 */
function iniciarPolling() {
  if (pollTimer) clearInterval(pollTimer);
  emExecucao = false;

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
    logger.erro(`[YouTube] Erro no polling de mensagens: ${err.message}`);
    if (err.code === 403) {
      logger.aviso('[YouTube] Quota possivelmente excedida. Aguardando antes de tentar novamente...');
      agendarReconnect();
    }
  } finally {
    emExecucao = false;
  }
}

/**
 * Agenda tentativa de reconexão em caso de erro 403.
 */
function agendarReconnect() {
  if (reconnectTimer) return;
  pararPolling();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    logger.youtube('Tentando retomar o polling...');
    iniciarPolling();
  }, INTERVALO_RECONNECT_MS);
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
  pararPolling();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  liveChatId = null;
  pageToken = null;
  logger.youtube('Cliente desconectado.');
}

module.exports = {
  iniciar,
  parar,
};
