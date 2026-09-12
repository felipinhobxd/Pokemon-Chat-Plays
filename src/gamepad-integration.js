'use strict';

/**
 * Liga os comandos de gamepad ao pipeline existente sem misturar gamepad no
 * registro de teclas. O prefixo `pad` evita colisao com `a`, `b`, setas etc.
 */

const logger = require('./utils/logger');
const cooldown = require('./utils/cooldown');
const stats = require('./utils/stats');
const pausa = require('./utils/pausa');
const votacao = require('./utils/votacao');
const overlay = require('./overlay');
const handlers = require('./handlers');
const gamepad = require('./controllers/gamepad');
const { parseGamepadCommand, normalizar } = require('./gamepad-commands');

let instalado = false;
let removerObservadorPausa = null;
let originalProcessarMensagem = null;

function chaveCooldownGamepad(parsed) {
  if (parsed.tipo === 'gamepad-botao') return `pad:${String(parsed.botao || '').toLowerCase()}`;
  if (parsed.tipo === 'gamepad-stick') return `pad:${String(parsed.stick || '').toLowerCase()}`;
  if (parsed.tipo === 'gamepad-trigger') return `pad:${parsed.trigger === 'L' ? 'lt' : 'rt'}`;
  return 'gamepad';
}

function permitidoPeloCooldown(ctx, chave) {
  if (handlers.ehStreamerContexto(ctx)) return true;
  return cooldown.podeExecutar(handlers.identidadeAtor(ctx), chave).permitido;
}

function processarGamepad({ plataforma, usuario, usuarioId, broadcaster = false, parsed }) {
  const contexto = { plataforma, usuario, usuarioId, broadcaster };
  if (parsed.tipo === 'gamepad-reset') {
    const ok = gamepad.resetar();
    if (ok) {
      stats.registrar('pad soltar', plataforma, usuario);
      overlay.registrarAcao(usuario, null, 'gamepad-reset');
      logger.comando(`[Chat] 🎮 @${usuario}: gamepad neutralizado`);
    }
    return;
  }

  if (pausa.estaPausado()) {
    if (config.geral.debug) logger.debug(`[Gamepad] "${parsed.descricao}" ignorado: chat pausado.`);
    return;
  }
  const chaveCooldown = chaveCooldownGamepad(parsed);
  if (!permitidoPeloCooldown(contexto, chaveCooldown)) return;

  if (votacao.modoAtual() === 'democracia') {
    if (config.geral.debug) logger.debug(`[Gamepad] "${parsed.descricao}" ignorado em democracia.`);
    return;
  }

  const ok = gamepad.executar(parsed);
  if (!ok) return;

  cooldown.registrarExecucao(handlers.identidadeAtor(contexto), chaveCooldown);
  stats.registrar(parsed.descricao, plataforma, usuario);
  overlay.registrarAcao(usuario, null, 'gamepad');
  logger.comando(`[Chat] 🎮 @${usuario}: ${parsed.descricao}`);
}

function instalar() {
  if (instalado) return gamepad.status();
  instalado = true;

  gamepad.configurarDeEnv(process.env);
  gamepad.preparar();

  originalProcessarMensagem = handlers.processarMensagem;
  handlers.processarMensagem = function processarMensagemComGamepad(ctx) {
    const texto = String(ctx?.texto || '');
    const n = normalizar(texto);
    if (['soltar', 'solta', 'solte', 'release'].includes(n)) gamepad.resetar();

    const parsed = parseGamepadCommand(texto);
    if (!parsed) return originalProcessarMensagem(ctx);
    return processarGamepad({
      plataforma: ctx.plataforma,
      usuario: ctx.usuario,
      usuarioId: ctx.usuarioId,
      broadcaster: ctx.broadcaster,
      parsed,
    });
  };

  removerObservadorPausa = pausa.observar((pausado) => {
    if (pausado) gamepad.resetar();
  });

  return gamepad.status();
}

function desinstalar() {
  if (!instalado) return;
  instalado = false;
  try { removerObservadorPausa?.(); } catch { /* nada */ }
  removerObservadorPausa = null;
  if (originalProcessarMensagem) handlers.processarMensagem = originalProcessarMensagem;
  originalProcessarMensagem = null;
  gamepad.parar();
}

module.exports = {
  instalar,
  desinstalar,
  processarGamepad,
  chaveCooldownGamepad,
};
