/**
 * Cliente Twitch usando tmi.js — versão 2.2.
 *
 * Melhorias:
 *  - Fila de envio com espaçamento mínimo entre mensagens (respeita o rate
 *    limit da Twitch de ~20 msg / 30s e evita ban por spam).
 *  - Prioridade: mensagens 'alta' (respostas de comandos) nunca são
 *    descartadas; confirmações 'baixa' (hold/soltar) podem ser descartadas
 *    se a fila encher em chats muito movimentados.
 *  - Processamento de mensagens delegado ao pipeline central (src/handlers.js).
 *  - Anúncio automático bonito e com anti-flood integrado.
 */

const tmi = require('tmi.js');
const logger = require('../utils/logger');
const { config } = require('../config');
const { processarMensagem, resetarCooldownResposta } = require('../handlers');
const { msgAnuncio } = require('../messages');

let cliente = null;
let canal = '';
let intervaloAnuncio = null;

// ---------------------------------------------------------------------------
// Fila de envio (anti rate-limit)
// ---------------------------------------------------------------------------
const filaEnvio = [];
let enviando = false;
const ESPACAMENTO_ENVIO_MS = 1500; // garante <= 20 msg / 30s com folga
const FILA_ENVIO_MAX = 12;

/**
 * Envia (ou enfileira) uma mensagem para o canal.
 * @param {string} texto - Mensagem pronta para enviar
 * @param {'alta'|'baixa'} [prioridade='alta']
 */
function responder(texto, prioridade = 'alta') {
  if (!cliente || !canal) return;
  if (filaEnvio.length >= FILA_ENVIO_MAX) {
    if (prioridade === 'baixa') {
      // confirmações descartáveis: joga fora para não atrasar respostas úteis
      return;
    }
    filaEnvio.shift(); // mantém as mais novas (mais relevantes agora)
  }
  filaEnvio.push(texto);
  processarFilaEnvio();
}

function processarFilaEnvio() {
  if (enviando || filaEnvio.length === 0) return;
  enviando = true;
  const texto = filaEnvio.shift();
  const promessa = cliente.say(canal, texto);
  if (promessa && typeof promessa.catch === 'function') {
    promessa.catch((err) => logger.erro(`[Twitch] Falha ao enviar mensagem: ${err.message}`));
  }
  setTimeout(() => {
    enviando = false;
    processarFilaEnvio();
  }, ESPACAMENTO_ENVIO_MS);
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/**
 * Cria e conecta o cliente Twitch.
 * @returns {Promise<object|null>} Cliente tmi.js conectado
 */
async function iniciar() {
  if (!config.twitch.username || !config.twitch.oauthToken || !config.twitch.channel) {
    logger.erro('[Twitch] Credenciais não configuradas. Verifique o arquivo .env.');
    return null;
  }

  canal = config.twitch.channel;

  // Normaliza o token OAuth: aceita com ou sem o prefixo "oauth:".
  let token = config.twitch.oauthToken.trim();
  if (!token.startsWith('oauth:')) {
    token = `oauth:${token}`;
    logger.info('[Twitch] Token OAuth sem prefixo "oauth:" — prefixo adicionado automaticamente.');
  }
  // Log seguro: só os primeiros caracteres
  const preview = token.length > 14 ? `${token.substring(0, 10)}...(${token.length} chars)` : '(muito curto)';
  logger.info(`[Twitch] Token carregado: ${preview}`);

  cliente = new tmi.Client({
    options: { debug: config.geral.debug },
    connection: { secure: true, reconnect: true, maxReconnectAttempts: Infinity },
    identity: {
      username: config.twitch.username,
      password: token,
    },
    channels: [canal],
  });

  cliente.on('connected', (endereco, porta) => {
    logger.twitch(`Conectado a ${endereco}:${porta} no canal #${canal}`);
    iniciarAnunciosAutomaticos();
  });

  cliente.on('disconnected', (motivo) => {
    logger.aviso(`[Twitch] Desconectado: ${motivo}`);
    pararAnunciosAutomaticos();
  });

  cliente.on('reconnect', () => {
    logger.twitch('Reconectando...');
  });

  cliente.on('message', (canalAlvo, tags, mensagem, self) => {
    if (self) return; // ignora as próprias mensagens do bot
    processarMensagem({
      plataforma: 'twitch',
      usuario: tags.username || 'desconhecido',
      texto: mensagem,
      responder,
    });
  });

  try {
    await cliente.connect();
    return cliente;
  } catch (err) {
    logger.erro(`[Twitch] Falha ao conectar: ${err.message}`);
    return null;
  }
}

/**
 * Inicia anúncios automáticos dos comandos (se configurado).
 */
function iniciarAnunciosAutomaticos() {
  pararAnunciosAutomaticos();
  if (config.geral.intervaloAnuncioMin <= 0) return;
  const intervaloMs = config.geral.intervaloAnuncioMin * 60000;
  intervaloAnuncio = setInterval(() => {
    if (!cliente || !canal) return;
    logger.twitch('Enviando anúncio automático dos comandos...');
    // reseta o anti-flood para que "!comandos" logo após o anúncio não fique mudo
    resetarCooldownResposta('comandos');
    responder(msgAnuncio(), 'alta');
  }, intervaloMs);
  logger.twitch(`Anúncios automáticos ativados (a cada ${config.geral.intervaloAnuncioMin} min)`);
}

/**
 * Para os anúncios automáticos.
 */
function pararAnunciosAutomaticos() {
  if (intervaloAnuncio) {
    clearInterval(intervaloAnuncio);
    intervaloAnuncio = null;
  }
}

/**
 * Envia uma mensagem direta (bypassa o pipeline, mas usa a fila).
 * @param {string} mensagem
 */
function enviarMensagem(mensagem) {
  if (!cliente || !canal) {
    logger.aviso('[Twitch] Cliente não conectado, não foi possível enviar mensagem.');
    return;
  }
  responder(mensagem, 'alta');
}

/**
 * Desconecta o cliente Twitch.
 */
async function parar() {
  pararAnunciosAutomaticos();
  if (cliente) {
    try {
      await cliente.disconnect();
      logger.twitch('Cliente desconectado.');
    } catch (err) {
      logger.erro(`[Twitch] Erro ao desconectar: ${err.message}`);
    }
  }
}

module.exports = {
  iniciar,
  parar,
  enviarMensagem,
};
