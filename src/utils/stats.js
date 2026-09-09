/**
 * Estatísticas de uso dos comandos.
 * Conta quantas vezes cada comando foi executado, por plataforma e por usuário,
 * incluindo os novos comandos de hold (v2.2).
 */

const logger = require('./logger');
const { config } = require('../config');

class StatsManager {
  constructor() {
    /** @type {Map<string, number>} - contagem por comando (inclui "hold up" etc.) */
    this.comandos = new Map();
    /** @type {Map<string, number>} - contagem por plataforma */
    this.plataformas = new Map();
    /** @type {Map<string, number>} - contagem por usuário */
    this.usuarios = new Map();
    /** @type {number} - total de comandos */
    this.total = 0;
    /** @type {number} - total de holds executados */
    this.holds = 0;
    /** @type {number} - total de "soltar" executados */
    this.soltas = 0;
    /** @type {number} - timestamp de início */
    this.inicio = Date.now();
  }

  /**
   * Registra um comando executado.
   * @param {string} comando - Nome do comando (up, down, "hold up", soltar...)
   * @param {string} plataforma - 'twitch' ou 'youtube'
   * @param {string} usuario - Nome do usuário
   */
  registrar(comando, plataforma, usuario) {
    if (!config.geral.statsAtivadas) return;

    this.comandos.set(comando, (this.comandos.get(comando) || 0) + 1);
    this.plataformas.set(plataforma, (this.plataformas.get(plataforma) || 0) + 1);
    this.usuarios.set(usuario, (this.usuarios.get(usuario) || 0) + 1);
    this.total++;
    if (comando.startsWith('hold ')) this.holds++;
    if (comando === 'soltar') this.soltas++;
  }

  /**
   * Gera um resumo das estatísticas.
   * @returns {object}
   */
  resumo() {
    const topUsuarios = [...this.usuarios.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nome, count]) => ({ nome, comandos: count }));

    const porComando = [...this.comandos.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cmd, count]) => ({ comando: cmd, count }));

    const uptimeMs = Date.now() - this.inicio;
    const uptimeMin = Math.floor(uptimeMs / 60000);

    return {
      total: this.total,
      holds: this.holds,
      soltas: this.soltas,
      uptimeMin,
      porPlataforma: Object.fromEntries(this.plataformas),
      porComando,
      topUsuarios,
    };
  }

  /**
   * Log de resumo (para o console, periodicamente).
   */
  logResumo() {
    if (!config.geral.statsAtivadas) return;
    const r = this.resumo();
    logger.info(`[Stats] Total: ${r.total} | Holds: ${r.holds} | Soltas: ${r.soltas} | Uptime: ${r.uptimeMin}min`);
    for (const [plataforma, count] of Object.entries(r.porPlataforma)) {
      logger.info(`[Stats] ${plataforma}: ${count} comandos`);
    }
  }
}

const instance = new StatsManager();

// Log de resumo a cada 15 minutos (unref: não impede o processo de encerrar)
setInterval(() => instance.logResumo(), 900000).unref();

module.exports = instance;
module.exports.StatsManager = StatsManager;
