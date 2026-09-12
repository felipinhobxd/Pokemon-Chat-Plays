'use strict';

/**
 * Liga os comandos de gamepad ao pipeline existente sem misturar gamepad no
 * registro de teclas. O prefixo `pad` evita colisao com `a`, `b`, setas etc.
 */

const logger = require('./utils/logger');
const { config } = require('./config');
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

function ehStreamer(usuario) {
  const canal = String(config.twitch.channel || '').toLowerCase().trim();
  return Boolean(canal) && String(usuario || '').toLowerCase().trim() === canal;
}

function permitidoPeloCooldown(usuario) {
  if (ehStreamer(usuario)) return true;
  return cooldown.podeExecutar(usuario).permitido;
}

function processarGamepad({ plataforma, usuario, parsed }) {
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
  if (!permitidoPeloCooldown(usuario)) return;

  if (votacao.modoAtual() === 'democracia') {
    if (config.geral.debug) logger.debug(`[Gamepad] "${parsed.descricao}" ignorado em democracia.`);
    return;
  }

  const ok = gamepad.executar(parsed);
  if (!ok) return;

  cooldown.registrarExecucao(usuario);
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
};
