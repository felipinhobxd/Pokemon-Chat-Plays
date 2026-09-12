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
const mouse = require('./controllers/mouse');
const pausa = require('./utils/pausa');
const votacao = require('./utils/votacao');
const dialogo = require('./utils/dialogo');
const overlay = require('./overlay');
const { parseComando } = require('./commands');
const { parseMouseCommand } = require('./mouse-commands');
const { duracaoEfetiva } = require('./utils/duracao');
const msg = require('./messages');

/**
 * Anti-flood de respostas: evita o bot repetir a MESMA resposta para
 * várias pessoas num curto intervalo (protege contra spam e rate limit).
 * @type {Map<string, number>}
 */
const ultimaResposta = new Map();
const RESPOSTA_COOLDOWN_MS = {
  comandos: 8000,
  hold: 8000,
  stats: 5000,
  top: 5000,
  ola: 3000,
  'hold-uso': 4000,
  'hold-confirmado': 1500,
  'soltar-confirmado': 1500,
  uptime: 8000,
  recorde: 8000,
  modo: 4000,
  'modo-bloqueado': 8000,
  'modo-voto': 1200,
};

function podeResponder(tipo) {
  const agora = Date.now();
  const ultimo = ultimaResposta.get(tipo) || 0;
  const limite = RESPOSTA_COOLDOWN_MS[tipo] ?? 5000;
  if (agora - ultimo < limite) return false;
  ultimaResposta.set(tipo, agora);
  return true;
}

function resetarCooldownResposta(tipo) {
  ultimaResposta.delete(tipo);
}

function resetarAntiFlood() {
  ultimaResposta.clear();
}

function identidadeAtor(ctx = {}) {
  const plataforma = String(ctx.plataforma || 'chat').toLowerCase().trim() || 'chat';
  const id = String(ctx.usuarioId || ctx.usuario || 'desconhecido').toLowerCase().trim() || 'desconhecido';
  return `${plataforma}:${id}`;
}

/** Privilégio de streamer nunca depende do displayName de outra plataforma. */
function ehStreamerContexto(ctx = {}) {
  if (ctx.broadcaster === true) return true;
  if (String(ctx.plataforma || '').toLowerCase() !== 'twitch') return false;
  const canal = String(config.twitch.channel || '').toLowerCase().trim();
  return Boolean(canal) && String(ctx.usuario || '').toLowerCase().trim() === canal;
}

function verificarCooldown(ctx, chaveComando) {
  if (ehStreamerContexto(ctx)) return { permitido: true };
  return cooldown.podeExecutar(identidadeAtor(ctx), chaveComando);
}

let ultimoLogPausa = 0;

function bloqueadoPelaPausa(usuario, comando) {
  if (!pausa.estaPausado()) return false;
  const agora = Date.now();
  if (agora - ultimoLogPausa > 10000) {
    ultimoLogPausa = agora;
    logger.info(`[Pausa] ⛔ comandos do chat ignorados (ex: "${comando}" de @${usuario}) — streamer pausou com F9`);
  }
  return true;
}

function responderSeguro(responder, texto, prioridade) {
  if (typeof responder === 'function') {
    responder(texto, prioridade);
  } else {
    logger.debug(`[Chat] (sem canal de resposta) ${texto.replace(/\n/g, ' | ')}`);
  }
}

function processarMensagem({ plataforma, usuario, usuarioId, broadcaster = false, texto, responder }) {
  const contexto = { plataforma, usuario, usuarioId, broadcaster };
  const ator = identidadeAtor(contexto);
  // Macros/comandos especiais são resolvidos antes dos controles simples.
  // `dialogo` aperta A repetidamente; mouse usa um parser próprio para não
  // poluir o registro configurável de teclas.
  const parsed = dialogo.ehComando(texto)
    ? { tipo: 'dialogo' }
    : (parseMouseCommand(texto) || parseComando(texto));
  if (!parsed) return;

  switch (parsed.tipo) {
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
        case 'uptime':
          if (podeResponder('uptime')) {
            responderSeguro(responder, msg.msgUptime(stats.resumo()), 'alta');
          }
          break;
        case 'recorde':
          if (podeResponder('recorde')) {
            responderSeguro(responder, msg.msgRecorde(stats.resumo()), 'alta');
          }
          break;
        case 'modo': {
          // v2.9.4+: comandos de modo enviados pelo CHAT são votos.
          // Uma única pessoa nunca troca o modo. Cada usuário tem um voto
          // recente e a troca só ocorre com maioria estrita (mínimo 2 pessoas).
          // !votacao continua como atalho para votar no modo oposto ao atual.
          const destino = parsed.bruto === 'anarquia'
            ? 'anarquia'
            : parsed.bruto === 'democracia'
              ? 'democracia'
              : (votacao.modoAtual() === 'anarquia' ? 'democracia' : 'anarquia');

          const resultado = votacao.votarModo(destino, ator);

          if (resultado.mudou) {
            if (podeResponder('modo')) {
              const resposta = votacao.modoAtual() === 'democracia'
                ? msg.msgModoDemocracia()
                : msg.msgModoAnarquia();
              responderSeguro(responder, resposta, 'alta');
            }
          } else {
            logger.info(
              `[Votação] @${usuario} votou ${destino.toUpperCase()} — `
              + `${resultado.votos}/${resultado.necessario} para maioria `
              + `(${resultado.totalVotantes} votante(s)).`
            );
            if (podeResponder('modo-voto')) {
              const rotulo = destino === 'democracia' ? 'DEMOCRACIA' : 'ANARQUIA';
              responderSeguro(
                responder,
                `🗳️ @${usuario} votou ${rotulo} — ${resultado.votos}/${resultado.necessario} para maioria`,
                'baixa'
              );
            }
          }
          break;
        }
        default:
          break;
      }
      return;
    }

    case 'ola': {
      if (podeResponder('ola')) {
        responderSeguro(responder, msg.msgBoasVindas(usuario), 'alta');
      }
      return;
    }

    case 'hold-invalido': {
      if (config.geral.confirmarComandos && podeResponder('hold-uso')) {
        responderSeguro(responder, msg.msgUsoHold(usuario), 'alta');
      }
      return;
    }

    case 'soltar': {
      if (bloqueadoPelaPausa(usuario, 'soltar')) return;
      dialogo.parar();
      // v3.1: soltar libera TUDO — teclado, botões do mouse (o gamepad é
      // neutralizado pelo wrapper do gamepad-integration antes de chegar aqui)
      const quantidade = teclado.soltarTodas();
      mouse.soltarTodos();
      stats.registrar('soltar', plataforma, usuario);
      overlay.registrarAcao(usuario, null, 'soltar');
      if (config.geral.confirmarComandos && podeResponder('soltar-confirmado')) {
        responderSeguro(responder, msg.msgSoltarConfirmado(usuario, quantidade), 'baixa');
      }
      return;
    }

    case 'hold': {
      if (bloqueadoPelaPausa(usuario, `hold ${parsed.botao}`)) return;
      const chaveCooldown = `hold:${parsed.botao}`;
      const verificacao = verificarCooldown(contexto, chaveCooldown);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado no hold: ${verificacao.motivo}`);
        }
        return;
      }
      if (votacao.modoAtual() === 'democracia') {
        votacao.votar(parsed.botao, ator);
        return;
      }
      const ok = teclado.segurar(parsed.botao, parsed.duracaoMs, usuario);
      if (ok) {
        cooldown.registrarExecucao(ator, chaveCooldown);
        stats.registrar(`hold ${parsed.botao}`, plataforma, usuario);
        overlay.registrarAcao(usuario, parsed.botao, 'hold', parsed.duracaoMs);
        if (config.geral.confirmarComandos && podeResponder('hold-confirmado')) {
          responderSeguro(responder, msg.msgHoldConfirmado(usuario, parsed.botao, parsed.duracaoMs), 'baixa');
        }
      }
      return;
    }

    case 'dialogo': {
      if (bloqueadoPelaPausa(usuario, 'dialogo')) return;
      const chaveCooldown = 'dialogo';
      const verificacao = verificarCooldown(contexto, chaveCooldown);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado no dialogo: ${verificacao.motivo}`);
        }
        return;
      }

      if (votacao.modoAtual() === 'democracia') {
        // identidade estável (platform:id) — displayNames do YouTube podem
        // colidir; o voto tem que ser 1 por usuário REAL (mesma regra do
        // hold/botao acima)
        votacao.votar('a', ator);
        return;
      }

      const iniciou = dialogo.iniciar({
        executar: () => teclado.executarBotao('a'),
        estaPausado: () => pausa.estaPausado(),
      });
      if (iniciou) {
        cooldown.registrarExecucao(ator, chaveCooldown);
        stats.registrar('dialogo', plataforma, usuario);
        overlay.registrarAcao(usuario, 'a', 'dialogo', dialogo.DURACAO_MS);
        logger.comando(`[Chat] 💬 @${usuario} iniciou DIALOGO — pressionando A repetidamente por 5s.`);
      }
      return;
    }

    // ------------------------------------------------------------- mouse
    // A votação de comandos de mouse é uma implementação separada (item 6
    // do plano). Até ela entrar, o mouse é BLOQUEADO em democracia para não
    // permitir que alguém burle a votação de gameplay.
    case 'mouse-mover':
    case 'mouse-pos':
    case 'mouse-click': {
      const descricao = parsed.descricao || parsed.tipo;
      if (bloqueadoPelaPausa(usuario, descricao)) return;

      const chaveCooldown = parsed.tipo;
      const verificacao = verificarCooldown(contexto, chaveCooldown);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado no mouse: ${verificacao.motivo}`);
        }
        return;
      }

      if (votacao.modoAtual() === 'democracia') {
        if (config.geral.debug) {
          logger.debug(`[Mouse] "${descricao}" ignorado em democracia até a etapa de votação de mouse.`);
        }
        return;
      }

      const ok = mouse.executar(parsed);
      if (ok) {
        cooldown.registrarExecucao(ator, chaveCooldown);
        stats.registrar(descricao, plataforma, usuario);
        overlay.registrarAcao(usuario, null, 'mouse');
        logger.comando(`[Chat] 🖱️ @${usuario}: ${descricao}`);
      }
      return;
    }

    // ------------------------------------- hold de movimento do mouse
    // Movimento contínuo da câmera (Minecraft/3D). É repetido em ticks
    // pelo controller e cancelado por soltar/F9/troca de alvo/shutdown.
    case 'mouse-move-hold': {
      const descricao = parsed.descricao || `hold olhar ${parsed.direcao || ''}`.trim();
      if (bloqueadoPelaPausa(usuario, descricao)) return;

      const chaveCooldown = `hold:mouse:move:${parsed.direcao || `${parsed.dx},${parsed.dy}`}`;
      const verificacao = verificarCooldown(contexto, chaveCooldown);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado no hold de movimento do mouse: ${verificacao.motivo}`);
        }
        return;
      }

      if (votacao.modoAtual() === 'democracia') {
        if (config.geral.debug) {
          logger.debug(`[Mouse] "${descricao}" ignorado em democracia (hold de movimento ainda não votável).`);
        }
        return;
      }

      const duracao = duracaoEfetiva(parsed.duracaoMs, config.geral);
      const ok = mouse.segurarMovimento(parsed.dx, parsed.dy, duracao, usuario);
      if (ok) {
        cooldown.registrarExecucao(ator, chaveCooldown);
        stats.registrar(`${descricao} ${duracao}ms`, plataforma, usuario);
        overlay.registrarAcao(usuario, null, 'hold', duracao);
        if (config.geral.confirmarComandos && podeResponder('hold-confirmado')) {
          responderSeguro(responder, msg.msgHoldConfirmado(usuario, `olhar ${parsed.direcao}`, duracao), 'baixa');
        }
        logger.comando(`[Chat] 🖱️↔️ @${usuario}: ${descricao} por ${duracao}ms`);
      }
      return;
    }

    // ------------------------------------------- hold de botão do mouse
    // v3.1: HOLD real (down ... up), mesma faixa 1ms–10s do teclado. Em
    // democracia fica BLOQUEADO (igual aos demais comandos de mouse) —
    // nunca executa direto para não furar o modo.
    case 'mouse-hold': {
      const descricao = parsed.descricao || 'hold clique';
      if (bloqueadoPelaPausa(usuario, descricao)) return;

      const chaveCooldown = `hold:mouse:${parsed.botao}`;
      const verificacao = verificarCooldown(contexto, chaveCooldown);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado no hold de mouse: ${verificacao.motivo}`);
        }
        return;
      }

      if (votacao.modoAtual() === 'democracia') {
        if (config.geral.debug) {
          logger.debug(`[Mouse] "${descricao}" ignorado em democracia (hold de mouse ainda não votável).`);
        }
        return;
      }

      const duracao = duracaoEfetiva(parsed.duracaoMs, config.geral);
      const ok = mouse.segurar(parsed.botao, duracao, usuario);
      if (ok) {
        cooldown.registrarExecucao(ator, chaveCooldown);
        stats.registrar(`${descricao} ${duracao}ms`, plataforma, usuario);
        overlay.registrarAcao(usuario, null, 'hold', duracao);
        if (config.geral.confirmarComandos && podeResponder('hold-confirmado')) {
          const rotulo = parsed.botao === 'right' ? 'clique direito' : 'clique';
          responderSeguro(responder, msg.msgHoldConfirmado(usuario, rotulo, duracao), 'baixa');
        }
        logger.comando(`[Chat] 🖱️🔒 @${usuario}: ${descricao} por ${duracao}ms`);
      }
      return;
    }

    case 'botao': {
      if (bloqueadoPelaPausa(usuario, parsed.botao)) return;
      const chaveCooldown = parsed.botao;
      const verificacao = verificarCooldown(contexto, chaveCooldown);
      if (!verificacao.permitido) {
        if (config.geral.debug) {
          logger.debug(`[Chat] @${usuario} bloqueado: ${verificacao.motivo}`);
        }
        return;
      }
      if (votacao.modoAtual() === 'democracia') {
        votacao.votar(parsed.botao, ator);
        return;
      }
      const ok = teclado.executarBotao(parsed.botao);
      if (ok) {
        cooldown.registrarExecucao(ator, chaveCooldown);
        stats.registrar(parsed.botao, plataforma, usuario);
        overlay.registrarAcao(usuario, parsed.botao, 'tap');
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
  identidadeAtor,
  ehStreamerContexto,
};
