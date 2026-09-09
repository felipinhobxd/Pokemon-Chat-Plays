/**
 * Pipeline central de processamento de mensagens do chat.
 *
 * Tanto o Twitch quanto o YouTube entregam suas mensagens aqui:
 *   processarMensagem({ plataforma, usuario, texto, responder })
 *
 * A função `responder` (opcional) recebe (texto, prioridade) e sabe como
 * enviar a mensagem de volta no chat da plataforma correspondente.
 * No YouTube (API key sem OAuth) ela é null — o bot só loga.
 */

const logger = require('./utils/logger');
const { config } = require('./config');
const cooldown = require('./utils/cooldown');
const stats = require('./utils/stats');
const teclado = require('./controllers/keyboard');
const { parseComando } = require('./commands');
const msg = require('./messages');

/**
 * Anti-flood de respostas: evita o bot repetir a MESMA resposta para
 * várias pessoas num curto intervalo (protege contra spam e rate limit).
 * @type {Map<string, number>}
 */
const ultimaResposta = new Map();
const RESPOSTA_COOLDOWN_MS = {
  comandos: 8000, // lista completa é grande: 8s entre repetições
  hold: 8000,
  stats: 5000,
  top: 5000,
  ola: 3000,
  'hold-uso': 4000,
  'hold-confirmado': 1500,
  'soltar-confirmado': 1500,
};

/**
 * Verifica se pode responder um tipo de mensagem agora
 * (e registra a resposta para iniciar o cooldown).
 * @param {string} tipo
 * @returns {boolean}
 */
function podeResponder(tipo) {
  const agora = Date.now();
  const ultimo = ultimaResposta.get(tipo) || 0;
  const limite = RESPOSTA_COOLDOWN_MS[tipo] ?? 5000;
  if (agora - ultimo < limite) return false;
  ultimaResposta.set(tipo, agora);
  return true;
}

/** Reseta o anti-flood de um tipo (usado pelo anúncio automático). */
function resetarCooldownResposta(tipo) {
  ultimaResposta.delete(tipo);
}

/**
 * Limpa todo o estado do anti-flood (útil para o anúncio automático
 * e para isolar testes).
 */
function resetarAntiFlood() {
  ultimaResposta.clear();
}

/**
 * Envia uma resposta com fallback seguro quando não há como responder.
 * @param {Function|null} responder
 * @param {string} texto
 * @param {string} prioridade - 'alta' (nunca descarta) | 'baixa' (descartável)
 */
function responderSeguro(responder, texto, prioridade) {
  if (typeof responder === 'function') {
    responder(texto, prioridade);
  } else {
    logger.debug(`[Chat] (sem canal de resposta) ${texto.replace(/\n/g, ' | ')}`);
  }
}

/**
 * Processa uma mensagem de chat de qualquer plataforma.
 * @param {object} params
 * @param {string} params.plataforma - 'twitch' | 'youtube'
 * @param {string} params.usuario - Nome do autor
 * @param {string} params.texto - Mensagem bruta
 * @param {Function|null} [params.responder] - (texto, prioridade) => void
 */
function processarMensagem({ plataforma, usuario, texto, responder }) {
  const parsed = parseComando(texto);
  if (!parsed) return;

  switch (parsed.tipo) {
    // ------------------------------------------------------------- comandos !
    case 'info': {
      logger.info(`[Chat] Comando !${parsed.comando} pedido por @${usuario} (${plataforma})`);
      switch (parsed.comando) {
        case 'comandos':
        case 'ajuda':
          if (podeResponder('comandos')) {
            for (const parte of msg.msgComandos()) {
              responderSeguro(responder, parte, 'alta');
            }
          }
          break;
        case 'hold':
          if (podeResponder('hold')) {
            responderSeguro(responder, msg.msgHoldAjuda(), 'alta');
          }
          break;
        case 'stats':
          if (podeResponder('stats')) {
            responderSeguro(responder, msg.msgStats(stats.resumo()), 'alta');
          }
          break;
        case 'top':
          if (podeResponder('top')) {
            responderSeguro(responder, msg.msgTop(stats.resumo()), 'alta');
          }
          break;
        default:
          break;
      }
      return;
    }

    // ------------------------------------------------------------- saudação
    case 'ola': {
      if (podeResponder('ola')) {
        responderSeguro(responder, msg.msgBoasVindas(usuario), 'alta');
      }
      return;
    }

    // ---------------------------------------------------------- hold inválido
    case 'hold-invalido': {
      if (config.geral.confirmarComandos && podeResponder('hold-uso')) {
        responderSeguro(responder, msg.msgUsoHold(usuario), 'alta');
      }
      return;
    }

    // ------------------------------------------------------------- soltar
    case 'soltar': {
      const quantidade = teclado.soltarTodas();
      stats.registrar('soltar', plataforma, usuario);
      if (config.geral.confirmarComandos && podeResponder('soltar-confirmado')) {
        responderSeguro(responder, msg.msgSoltarConfirmado(usuario, quantidade), 'baixa');
      }
      return;
    }

    // ------------------------------------------------------------- hold
    case 'hold': {
      const verificacao = cooldown.podeExecutar(usuario);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado no hold: ${verificacao.motivo}`);
        }
        return;
      }
      const ok = teclado.segurar(parsed.botao, parsed.duracaoMs, usuario);
      if (ok) {
        cooldown.registrarExecucao(usuario);
        stats.registrar(`hold ${parsed.botao}`, plataforma, usuario);
        if (config.geral.confirmarComandos && podeResponder('hold-confirmado')) {
          responderSeguro(responder, msg.msgHoldConfirmado(usuario, parsed.botao, parsed.duracaoMs), 'baixa');
        }
      }
      return;
    }

    // ------------------------------------------------------------- botão
    case 'botao': {
      const verificacao = cooldown.podeExecutar(usuario);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado: ${verificacao.motivo}`);
        }
        return;
      }
      const ok = teclado.executarBotao(parsed.botao);
      if (ok) {
        cooldown.registrarExecucao(usuario);
        stats.registrar(parsed.botao, plataforma, usuario);
      }
      return;
    }

    default:
      break;
  }
}

module.exports = {
  processarMensagem,
  resetarCooldownResposta,
  resetarAntiFlood,
};
