/**
 * Sistema de cooldown para evitar spam.
 *
 * Mantém as proteções antigas (global + por usuário) e acrescenta cooldowns
 * independentes por comando. Exemplo:
 *   dialogo=10s, mouse-click=2s, a=500ms
 *
 * O cooldown específico só impede repetir aquela ação. Depois do cooldown
 * base, o espectador pode usar outras ações normalmente.
 */

const logger = require('./logger');
const { config } = require('../config');
const { normalizarChaveCooldown } = require('./cooldown-config');

class CooldownManager {
  constructor(opcoes = {}) {
    this.usuario = new Map();
    this.comando = new Map();
    this.ultimoGlobal = 0;
    this.opcoes = opcoes;
    this.metricas = { global: 0, usuario: 0, comando: 0 };
  }

  _config() {
    const base = Number.isFinite(this.opcoes.cooldownMs)
      ? Math.max(0, this.opcoes.cooldownMs)
      : Math.max(0, Number(config.geral.cooldownMs) || 0);
    const global = Number.isFinite(this.opcoes.cooldownGlobalMs)
      ? Math.max(0, this.opcoes.cooldownGlobalMs)
      : Math.max(150, base / 10);
    const especificos = this.opcoes.cooldownsPorComando || config.geral.cooldownsPorComando || {};
    return { base, global, especificos };
  }

  _limitesEspecificos(chave, especificos) {
    const k = normalizarChaveCooldown(chave);
    if (!k) return [];
    const candidatos = [k];
    if (k.startsWith('hold:')) candidatos.push('hold');
    if (k.startsWith('mouse-')) candidatos.push('mouse');
    if (k.startsWith('pad:')) candidatos.push('gamepad');
    const saida = [];
    for (const nome of candidatos) {
      if (!Object.prototype.hasOwnProperty.call(especificos, nome)) continue;
      const ms = Math.max(0, Number(especificos[nome]) || 0);
      if (ms > 0) saida.push({ chave: nome, ms });
    }
    return saida;
  }

  podeExecutar(usuario, chaveComando = '') {
    const agora = Date.now();
    const cfg = this._config();

    const desdeGlobal = agora - this.ultimoGlobal;
    if (desdeGlobal < cfg.global) {
      this.metricas.global++;
      return { permitido: false, motivo: `cooldown global: aguarde ${Math.ceil(cfg.global - desdeGlobal)}ms` };
    }

    const ultimoUsuario = this.usuario.get(usuario) || 0;
    const desdeUsuario = agora - ultimoUsuario;
    if (desdeUsuario < cfg.base) {
      this.metricas.usuario++;
      const espera = Math.ceil((cfg.base - desdeUsuario) / 100) / 10;
      return { permitido: false, motivo: `cooldown de usuário: aguarde ${espera}s` };
    }

    for (const limite of this._limitesEspecificos(chaveComando, cfg.especificos)) {
      const id = `${usuario}\u0000${limite.chave}`;
      const ultimo = this.comando.get(id) || 0;
      const desde = agora - ultimo;
      if (desde < limite.ms) {
        this.metricas.comando++;
        const espera = Math.ceil((limite.ms - desde) / 100) / 10;
        return {
          permitido: false,
          motivo: `cooldown de ${limite.chave}: aguarde ${espera}s`,
          comando: limite.chave,
        };
      }
    }

    return { permitido: true };
  }

  registrarExecucao(usuario, chaveComando = '') {
    const agora = Date.now();
    const cfg = this._config();
    this.usuario.set(usuario, agora);
    this.ultimoGlobal = agora;
    for (const limite of this._limitesEspecificos(chaveComando, cfg.especificos)) {
      this.comando.set(`${usuario}\u0000${limite.chave}`, agora);
    }
  }

  /**
   * (Somente leitura) Maior cooldown ESPECÍFICO configurado que se aplica à
   * chave (ex.: "a" → 5000; "hold:w" → 3000). Retorna 0 quando não há
   * regra específica — usado para decisões como "pode repetir esta ação
   * dentro de uma mesma sequência sem driblar a política de cooldown?".
   * Não registra nem consume NADA (não tem efeito colateral).
   */
  limiteEspecificoMs(chaveComando = '') {
    const cfg = this._config();
    let max = 0;
    for (const limite of this._limitesEspecificos(chaveComando, cfg.especificos)) {
      if (limite.ms > max) max = limite.ms;
    }
    return max;
  }

  diagnostico() {
    const cfg = this._config();
    return {
      baseMs: cfg.base,
      globalMs: cfg.global,
      regrasEspecificas: Object.keys(cfg.especificos || {}).length,
      usuariosRastreados: this.usuario.size,
      bloqueios: { ...this.metricas },
    };
  }

  limparAntigos() {
    const limite = Date.now() - 3600000;
    let removidos = 0;
    for (const [usuario, ts] of this.usuario.entries()) {
      if (ts < limite) { this.usuario.delete(usuario); removidos++; }
    }
    for (const [chave, ts] of this.comando.entries()) {
      if (ts < limite) { this.comando.delete(chave); removidos++; }
    }
    if (removidos > 0) logger.debug(`[Cooldown] ${removidos} registros antigos removidos`);
  }
}

const instance = new CooldownManager();
setInterval(() => instance.limparAntigos(), 600000).unref();

module.exports = instance;
module.exports.CooldownManager = CooldownManager;
