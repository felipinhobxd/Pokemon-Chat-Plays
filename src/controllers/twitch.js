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
const overlay = require('../overlay');

let cliente = null;
let canal = '';
let intervaloAnuncio = null;
let timerRetry = null;
let parado = false;

// Intervalo de retentativa quando a PRIMEIRA conexão falha (v2.4.1).
// Depois de conectado, o próprio tmi.js reconecta sozinho (reconnect: true)
// — mas se o connect() inicial falha (internet caiu no boot, Twitch fora do
// ar), nada mais tentava: o bot ficava vivo e morto. Agora ele insiste.
const RETRY_CONEXAO_MS = 15000;

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
  // Log seguro (v2.8.1): nenhum caractere do token aparece — só o tamanho,
  // para o streamer conferir se colou o token inteiro.
  const preview = token.length > 14 ? `oauth:•••• (${token.length} caracteres)` : `(muito curto: ${token.length} caracteres)`;
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
    overlay.setConexao('twitch', true);
    iniciarAnunciosAutomaticos();
  });
  cliente.on('disconnected', (motivo) => {
    logger.aviso(`[Twitch] Desconectado: ${motivo}`);
    overlay.setConexao('twitch', false);
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
    parado = false;
    await cliente.connect();
    return cliente;
  } catch (err) {
    // tmi rejeita com string às vezes ("Login authentication failed")
    const motivo = (err && err.message) || String(err || 'motivo desconhecido');
    logger.erro(`[Twitch] Falha ao conectar: ${motivo}`);
    // token/oauth inválido não se resolve sozinho — não adianta re-tentar
    if (!/authenticat|login|oauth|token|senha/i.test(motivo)) {
      agendarReconexaoInicial();
    } else {
      logger.erro('[Twitch] Parece problema de credencial — confira o TWITCH_OAUTH_TOKEN no .env.');
    }
    return null;
  }
}

/**
 * Agenda uma nova tentativa de conexão (primeira conexão falhou).
 * O 'connected' do tmi cuida do overlay/anúncios quando der certo.
 */
function agendarReconexaoInicial() {
  if (timerRetry || parado || !cliente) return;
  timerRetry = setTimeout(async () => {
    timerRetry = null;
    if (parado || !cliente) return;
    logger.twitch('Tentando conectar ao Twitch de novo...');
    try {
      await cliente.connect();
    } catch {
      agendarReconexaoInicial(); // continua insistindo a cada 15s
    }
  }, RETRY_CONEXAO_MS);
  timerRetry.unref?.();
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
 *
 * v2.5.2: mensagens do SISTEMA (vencedor da votação, aviso de pausa,
 * troca de modo...) chegam aqui mesmo quando a Twitch não está ativa —
 * num setup só-YouTube com democracia isso aconteceria a cada janela
 * de 10s e virava spam de terminal. Regras:
 *  - Twitch fora das plataformas ativas: silêncio (logger.debug);
 *  - ativa mas desconectada: 1 aviso a cada 60s (o tmi reconecta sozinho
 *    — repetir o aviso não recupera a mensagem perdida).
 * @param {string} mensagem
 */
const AVISO_DESCONECTADO_MS = 60000;
let ultimoAvisoDesconectado = 0;

function enviarMensagem(mensagem) {
  const twitchAtiva = config.geral.plataformasAtivas.includes('twitch');
  if (!twitchAtiva) {
    logger.debug(`[Twitch] (plataforma inativa, msg não enviada) ${mensagem}`);
    return;
  }
  if (!cliente || !canal) {
    const agora = Date.now();
    if (agora - ultimoAvisoDesconectado > AVISO_DESCONECTADO_MS) {
      ultimoAvisoDesconectado = agora;
      logger.aviso('[Twitch] Cliente não conectado, não foi possível enviar mensagem.');
    } else {
      logger.debug('[Twitch] Cliente não conectado (aviso já dado há pouco).');
    }
    return;
  }
  responder(mensagem, 'alta');
}

/**
 * Desconecta o cliente Twitch.
 */
async function parar() {
  parado = true;
  if (timerRetry) {
    clearTimeout(timerRetry);
    timerRetry = null;
  }
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
  // v2.5.2: exposto APENAS para os testes de regressão do throttle
  __resetTeste: () => { ultimoAvisoDesconectado = 0; },
};
