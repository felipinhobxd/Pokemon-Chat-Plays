/**
 * Sistema de cooldown para evitar spam.
 * Cada usuário só pode enviar um comando a cada intervalo configurado.
 * Inclui cooldown global opcional para evitar sobrecarga do jogo.
 */

const logger = require('./logger');
const { config } = require('../config');

class CooldownManager {
  constructor() {
    /** @type {Map<string, number>} - última execução por usuário (timestamp) */
    this.usuario = new Map();
    /** @type {number} - última execução global (timestamp) */
    this.ultimoGlobal = 0;
    this.cooldownMs = config.geral.cooldownMs;
    this.cooldownGlobalMs = Math.max(150, this.cooldownMs / 10); // cooldown global mínimo 150ms
  }

  /**
   * Verifica se o usuário pode executar um comando agora.
   * @param {string} usuario - Nome do usuário
   * @returns {{permitido: boolean, motivo?: string}}
   */
  podeExecutar(usuario) {
    const agora = Date.now();

    // Cooldown global (limita taxa de comandos total)
    const desdeUltimoGlobal = agora - this.ultimoGlobal;
    if (desdeUltimoGlobal < this.cooldownGlobalMs) {
      const esperaMs = Math.ceil(this.cooldownGlobalMs - desdeUltimoGlobal);
      return {
        permitido: false,
        motivo: `cooldown global: aguarde ${esperaMs}ms`,
      };
    }

    // Cooldown por usuário
    const ultimo = this.usuario.get(usuario) || 0;
    const desdeUltimo = agora - ultimo;
    if (desdeUltimo < this.cooldownMs) {
      const esperaMs = Math.ceil((this.cooldownMs - desdeUltimo) / 1000 * 10) / 10;
      return {
        permitido: false,
        motivo: `cooldown de usuário: aguarde ${esperaMs}s`,
      };
    }

    return { permitido: true };
  }

  /**
   * Registra que o usuário executou um comando com sucesso.
   * @param {string} usuario - Nome do usuário
   */
  registrarExecucao(usuario) {
    this.usuario.set(usuario, Date.now());
    this.ultimoGlobal = Date.now();
  }

  /**
   * Remove registros antigos (mais de 1 hora) para liberar memória.
   */
  limparAntigos() {
    const limite = Date.now() - 3600000; // 1 hora atrás
    let removidos = 0;
    for (const [usuario, ts] of this.usuario.entries()) {
      if (ts < limite) {
        this.usuario.delete(usuario);
        removidos++;
      }
    }
    if (removidos > 0) {
      logger.debug(`[Cooldown] ${removidos} registros antigos removidos`);
    }
  }
}

const instance = new CooldownManager();

// Limpa registros antigos a cada 10 minutos (apos a instancia ser criada)
setInterval(() => {
  instance.limparAntigos();
}, 600000);

module.exports = instance;
module.exports.CooldownManager = CooldownManager;
