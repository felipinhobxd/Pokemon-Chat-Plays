/**
 * Cliente Twitch usando tmi.js.
 * Encapsula conexão, eventos e envio de mensagens.
 */

const tmi = require('tmi.js');
const logger = require('../utils/logger');
const { config } = require('../config');
const cooldown = require('../utils/cooldown');
const stats = require('../utils/stats');
const { executarBotao, normalizarComando, ehPedidoAjuda, gerarMensagemAjuda } = require('./keyboard');

let cliente = null;
let canal = '';
let intervaloAnuncio = null;

/**
 * Cria e conecta o cliente Twitch.
 * @returns {Promise<object>} - Cliente tmi.js conectado
 */
async function iniciar() {
  if (!config.twitch.username || !config.twitch.oauthToken || !config.twitch.channel) {
    logger.erro('[Twitch] Credenciais não configuradas. Verifique o arquivo .env.');
    return null;
  }

  canal = config.twitch.channel;

  cliente = new tmi.Client({
    options: {
      debug: config.geral.debug,
    },
    connection: {
      secure: true,
      reconnect: true,
    },
    identity: {
      username: config.twitch.username,
      password: config.twitch.oauthToken,
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
    // Ignora as próprias mensagens do bot para evitar loop
    if (self) return;

    processarMensagem(canalAlvo, tags, mensagem);
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
 * Processa uma mensagem recebida do chat da Twitch.
 * @param {string} canalAlvo - Nome do canal
 * @param {object} tags - Tags do tmi.js (username, mod, subscriber, etc.)
 * @param {string} mensagem - Mensagem bruta
 */
function processarMensagem(canalAlvo, tags, mensagem) {
  const usuario = tags.username || 'desconhecido';

  // Pedido de ajuda / comandos
  if (ehPedidoAjuda(mensagem)) {
    logger.twitch(`Ajuda solicitada por @${usuario}`);
    cliente.say(canalAlvo, gerarMensagemAjuda());
    return;
  }

  // Cumprimento simples (mantemos a feature original)
  if (mensagem.trim().toLowerCase() === 'ola' || mensagem.trim().toLowerCase() === 'olá') {
    cliente.say(canalAlvo, `Bem-vindo ao canal, @${usuario}! Para ver os comandos digite: !comandos`);
    return;
  }

  // Tenta interpretar como comando de jogo
  const botao = normalizarComando(mensagem);
  if (!botao) return;

  // Verifica cooldown
  const verificacao = cooldown.podeExecutar(usuario);
  if (!verificacao.permitido) {
    if (config.geral.debug) {
      logger.debug(`[Twitch] @${usuario} bloqueado: ${verificacao.motivo}`);
    }
    return;
  }

  // Executa o botão
  const ok = executarBotao(botao);
  if (ok) {
    cooldown.registrarExecucao(usuario);
    stats.registrar(botao, 'twitch', usuario);
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
    cliente.say(canal, gerarMensagemAjuda());
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
 * Envia uma mensagem para o canal Twitch.
 * @param {string} mensagem - Mensagem a enviar
 */
function enviarMensagem(mensagem) {
  if (!cliente || !canal) {
    logger.aviso('[Twitch] Cliente não conectado, não foi possível enviar mensagem.');
    return;
  }
  cliente.say(canal, mensagem);
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
