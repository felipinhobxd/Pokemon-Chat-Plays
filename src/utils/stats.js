/**
 * Estatísticas de uso dos comandos.
 * Conta quantas vezes cada comando foi executado, por plataforma e por usuário.
 */

const logger = require('./logger');
const { config } = require('../config');

class StatsManager {
  constructor() {
    /** @type {Map<string, number>} - contagem por comando */
    this.comandos = new Map();
    /** @type {Map<string, number>} - contagem por plataforma */
    this.plataformas = new Map();
    /** @type {Map<string, number>} - contagem por usuário (top 10) */
    this.usuarios = new Map();
    /** @type {number} - total de comandos */
    this.total = 0;
    /** @type {number} - timestamp de início */
    this.inicio = Date.now();
  }

  /**
   * Registra um comando executado.
   * @param {string} comando - Nome do comando (up, down, a, b, etc.)
   * @param {string} plataforma - 'twitch' ou 'youtube'
   * @param {string} usuario - Nome do usuário
   */
  registrar(comando, plataforma, usuario) {
    if (!config.geral.statsAtivadas) return;

    this.comandos.set(comando, (this.comandos.get(comando) || 0) + 1);
    this.plataformas.set(plataforma, (this.plataformas.get(plataforma) || 0) + 1);
    this.usuarios.set(usuario, (this.usuarios.get(usuario) || 0) + 1);
    this.total++;
  }

  /**
   * Gera um resumo das estatísticas.
   * @returns {object}
   */
  resumo() {
    const topUsuarios = [...this.usuarios.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([nome, count]) => ({ nome, comandos: count }));

    const porComando = [...this.comandos.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cmd, count]) => ({ comando: cmd, count }));

    const uptimeMs = Date.now() - this.inicio;
    const uptimeMin = Math.floor(uptimeMs / 60000);

    return {
      total: this.total,
      uptimeMin,
      porPlataforma: Object.fromEntries(this.plataformas),
      porComando,
      topUsuarios,
    };
  }

  /**
   * Formata o resumo como string amigável para o chat.
   * @returns {string}
   */
  resumoTexto() {
    const r = this.resumo();
    const linhas = [
      `Estatisticas do bot:`,
      `Total de comandos: ${r.total}`,
      `Tempo ativo: ${r.uptimeMin} min`,
    ];
    for (const [plataforma, count] of Object.entries(r.porPlataforma)) {
      linhas.push(`${plataforma}: ${count} comandos`);
    }
    if (r.topUsuarios.length > 0) {
      linhas.push(`Top jogador: ${r.topUsuarios[0].nome} (${r.topUsuarios[0].comandos} cmds)`);
    }
    return linhas.join(' | ');
  }

  /**
   * Log de resumo (para o console, periodicamente).
   */
  logResumo() {
    if (!config.geral.statsAtivadas) return;
    const r = this.resumo();
    logger.info(`[Stats] Total: ${r.total} | Uptime: ${r.uptimeMin}min`);
    for (const [plataforma, count] of Object.entries(r.porPlataforma)) {
      logger.info(`[Stats] ${plataforma}: ${count} comandos`);
    }
  }
}

const instance = new StatsManager();

// Log de resumo a cada 15 minutos
setInterval(() => instance.logResumo(), 900000);

module.exports = instance;
module.exports.StatsManager = StatsManager;
