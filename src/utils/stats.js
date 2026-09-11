/**
 * Estatísticas de uso dos comandos.
 * Conta quantas vezes cada comando foi executado, por plataforma e por usuário,
 * incluindo os comandos de hold (v2.2) e, desde a v2.3, PERSISTE tudo em
 * arquivo (dados/stats.json): o ranking e os totais sobrevivem a restarts
 * e o !top passa a valer por live inteira (ou para sempre).
 */

const fs = require('fs');
const path = require('path');
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
    /** @type {number} - minutos de live acumulados de sessões anteriores */
    this.uptimeAcumuladoMin = 0;
    /** @type {string|null} - caminho do arquivo de persistência */
    this.arquivo = null;
    /** @type {boolean} - há mudanças não salvas? */
    this.sujo = false;
    /** @type {NodeJS.Timeout|null} - timer do autosave */
    this.timerSalvar = null;
  }

  /**
   * Ativa a persistência: carrega o histórico existente e agenda autosave.
   * @param {string} caminho - Caminho do arquivo JSON (relativo ao cwd)
   * @returns {boolean} true se carregou um histórico existente
   */
  configurarArquivo(caminho) {
    this.arquivo = caminho;
    const carregou = this.carregar();
    // autosave a cada 30s quando houver mudanças (unref: não trava o exit)
    if (this.timerSalvar) clearInterval(this.timerSalvar);
    this.timerSalvar = setInterval(() => this.salvar(), 30000);
    this.timerSalvar.unref?.();
    return carregou;
  }

  /**
   * Carrega o histórico do arquivo (se existir e for válido).
   * @returns {boolean}
   */
  carregar() {
    if (!this.arquivo) return false;
    try {
      const bruto = fs.readFileSync(this.arquivo, 'utf8');
      const dados = JSON.parse(bruto);
      if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return false;

      const paraMapa = (obj) => {
        const m = new Map();
        for (const [chave, valor] of Object.entries(obj || {})) {
          const n = Number(valor);
          if (chave && Number.isFinite(n) && n > 0) m.set(String(chave), n);
        }
        return m;
      };

      this.comandos = paraMapa(dados.comandos);
      this.plataformas = paraMapa(dados.plataformas);
      this.usuarios = paraMapa(dados.usuarios);
      this.total = Number.isFinite(dados.total) ? Number(dados.total) : 0;
      this.holds = Number.isFinite(dados.holds) ? Number(dados.holds) : 0;
      this.soltas = Number.isFinite(dados.soltas) ? Number(dados.soltas) : 0;
      this.uptimeAcumuladoMin = Number.isFinite(dados.uptimeMin) ? Number(dados.uptimeMin) : 0;
      this.inicio = Date.now();
      this.sujo = false;
      return true;
    } catch {
      return false; // não existe ainda / corrompido — começa do zero
    }
  }

  /**
   * Salva o histórico no arquivo (se houver mudanças).
   * @returns {boolean} true se salvou
   */
  salvar() {
    if (!this.arquivo || !this.sujo) return false;
    const dados = {
      versao: 1,
      salvoEm: new Date().toISOString(),
      comandos: Object.fromEntries(this.comandos),
      plataformas: Object.fromEntries(this.plataformas),
      usuarios: Object.fromEntries(this.usuarios),
      total: this.total,
      holds: this.holds,
      soltas: this.soltas,
      uptimeMin: this.uptimeAcumuladoMin + Math.floor((Date.now() - this.inicio) / 60000),
    };
    try {
      fs.mkdirSync(path.dirname(path.resolve(this.arquivo)), { recursive: true });
      // v2.8.1: gravação ATÔMICA — escreve num .tmp e renomeia por cima. Um
      // writeFileSync direto, se o processo morrer/cair energia no meio da
      // escrita, deixa um JSON truncado; no próximo boot o parse falha e o
      // histórico do streamer zera sem aviso. rename dentro do mesmo
      // diretório/disco é atômico no Windows (MoveFileEx) e no POSIX.
      const caminhoTmp = `${this.arquivo}.tmp`;
      fs.writeFileSync(caminhoTmp, JSON.stringify(dados, null, 2));
      fs.renameSync(caminhoTmp, this.arquivo);
      this.sujo = false;
      return true;
    } catch (err) {
      logger.aviso(`[Stats] Não foi possível salvar o histórico (${err.message}).`);
      return false;
    }
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
    this.sujo = true;
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

    const uptimeMin = this.uptimeAcumuladoMin + Math.floor((Date.now() - this.inicio) / 60000);

    return {
      total: this.total,
      holds: this.holds,
      soltas: this.soltas,
      uptimeMin,
      jogadores: this.usuarios.size,
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
