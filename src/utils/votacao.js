/**
 * Modo DEMOCRACIA / ANARQUIA (v2.5).
 *
 *  - ANARQUIA (padrão, comportamento clássico): todo comando do chat
 *    executa na hora, em ordem de chegada.
 *  - DEMOCRACIA: o chat VOTA durante uma janela de tempo (padrão 10s) e,
 *    no fim dela, APENAS o comando mais votado é executado. Cada usuário
 *    tem 1 voto (pode trocar votando de novo — vale o último).
 *
 * O motor é PURO: ele só coleta votos e entrega o vencedor a um executor
 * registrado pelo index.js (que toca a tecla, registra stats/overlay e
 * avisa o chat). Assim não há dependências circulares.
 *
 * Trocas de modo:
 *  - pelo CHAT (!democracia / !anarquia): respeitam um intervalo mínimo
 *    (VOTACAO_TROCA_MIN_MS, padrão 30s) para não virar flip-flop;
 *  - pelo STREAMER (tecla F8 / !comando do dono do canal / terminal):
 *    sempre imediatas.
 *
 * Empate: ganha o candidato que RECEBEU O PRIMEIRO VOTO mais cedo.
 */

const logger = require('./logger');
const { config } = require('../config');

const MODOS = ['anarquia', 'democracia'];

/** Modo atual. */
let modo = 'anarquia';

/** Duração de cada janela de votação. */
let intervaloMs = config.votacao.intervaloMs;
/** Intervalo mínimo entre trocas pedidas pelo chat. */
let trocaMinMs = config.votacao.trocaMinMs;

/** Executor do vencedor: ({botao, votos, eleitores}) => void. */
let executor = null;

/** Ouvintes de mudança de modo: (novoModo) => void. */
const ouvintes = [];

/** Votos da janela corrente: botao -> {votos, eleitores:Set, primeiroTs}. */
let votos = new Map();
/** Último voto de cada usuário: usuario -> botao. */
let votoDe = new Map();

/** Timer da janela corrente. */
let timer = null;
/** Timestamp do fim da janela corrente (para o overlay). */
let janelaFimEm = 0;
/** Timestamp da última troca de modo. */
let ultimaTroca = 0;

/**
 * Ajusta parâmetros (usado pelo index no boot e pelos testes).
 * @param {object} [opcoes] - { intervaloMs?, trocaMinMs? }
 */
function configurar(opcoes = {}) {
  if (Number.isFinite(opcoes.intervaloMs)) {
    intervaloMs = Math.max(50, opcoes.intervaloMs);
  }
  if (Number.isFinite(opcoes.trocaMinMs)) {
    trocaMinMs = Math.max(0, opcoes.trocaMinMs);
  }
}

/**
 * Registra a função que executa o vencedor de cada janela.
 * @param {(vencedor: {botao: string, votos: number, eleitores: number}) => void} fn
 */
function configurarExecutor(fn) {
  executor = typeof fn === 'function' ? fn : null;
}

/**
 * Registra um ouvinte de mudança de modo.
 * @param {(novoModo: string, origem: string) => void} callback
 * @returns {() => void} cancelador
 */
function observar(callback) {
  if (typeof callback === 'function') ouvintes.push(callback);
  return () => {
    const idx = ouvintes.indexOf(callback);
    if (idx >= 0) ouvintes.splice(idx, 1);
  };
}

function notificarMudanca(origem) {
  for (const cb of [...ouvintes]) {
    try {
      cb(modo, origem);
    } catch (err) {
      logger.erro(`[Votação] Ouvinte falhou: ${err.message}`);
    }
  }
}

/** @returns {string} 'anarquia' | 'democracia' */
function modoAtual() {
  return modo;
}

/**
 * Troca o modo de jogo.
 * @param {string} novo - 'anarquia' | 'democracia'
 * @param {string} [origem] - 'chat @fulano' (respeita o intervalo mínimo) |
 *   'streamer-cmd @fulano' (comando do dono no chat: troca na hora) |
 *   'tecla' / 'terminal' / 'config' / 'api' (trocam na hora)
 * @returns {{mudou: boolean, motivo?: string, esperaMs?: number}}
 */
function definirModo(novo, origem = 'api') {
  if (!MODOS.includes(novo)) {
    return { mudou: false, motivo: 'modo desconhecido' };
  }
  if (novo === modo) {
    return { mudou: false, motivo: 'já está neste modo' };
  }
  const agora = Date.now();
  const veioDoChat = String(origem).startsWith('chat');
  if (veioDoChat && agora - ultimaTroca < trocaMinMs) {
    return {
      mudou: false,
      motivo: 'troca recente',
      esperaMs: trocaMinMs - (agora - ultimaTroca),
    };
  }

  modo = novo;
  ultimaTroca = agora;
  pararJanela();
  votos = new Map();
  votoDe = new Map();
  if (novo === 'democracia') {
    agendarJanela();
  }
  logger.info(`[Votação] Modo ${novo.toUpperCase()} (${origem}).`);
  notificarMudanca(origem);
  return { mudou: true };
}

/**
 * Alterna entre anarquia e democracia (tecla F8 / terminal / !votacao).
 * @param {string} [origem]
 */
function alternarModo(origem = 'api') {
  const destino = modo === 'anarquia' ? 'democracia' : 'anarquia';
  return definirModo(destino, origem);
}

/**
 * Registra (ou troca) o voto de um usuário — só vale em democracia.
 * @param {string} botao - Botão canônico votado
 * @param {string} usuario - Quem votou
 * @returns {boolean} true se o voto foi aceito
 */
function votar(botao, usuario) {
  if (modo !== 'democracia') return false;

  const anterior = votoDe.get(usuario);
  if (anterior === botao) return true; // mesmo voto: idempotente

  if (anterior) {
    const antigo = votos.get(anterior);
    if (antigo) {
      antigo.votos--;
      antigo.eleitores.delete(usuario);
      if (antigo.votos <= 0) votos.delete(anterior);
    }
  }

  let alvo = votos.get(botao);
  if (!alvo) {
    alvo = { votos: 0, eleitores: new Set(), primeiroTs: Date.now() };
    votos.set(botao, alvo);
  }
  alvo.votos++;
  alvo.eleitores.add(usuario);
  votoDe.set(usuario, botao);
  return true;
}

/** Agenda a próxima janela de votação. */
function agendarJanela() {
  if (modo !== 'democracia') return;
  janelaFimEm = Date.now() + intervaloMs;
  timer = setTimeout(encerrarJanela, intervaloMs);
  timer.unref?.();
}

/** Fecha a janela: executa o vencedor (se houver) e agenda a próxima. */
function encerrarJanela() {
  timer = null;
  janelaFimEm = 0;
  if (modo !== 'democracia') return;

  // vencedor: mais votos; empate -> primeiro a receber voto
  let vencedor = null;
  for (const [botao, alvo] of votos.entries()) {
    if (
      vencedor === null
      || alvo.votos > vencedor.alvo.votos
      || (alvo.votos === vencedor.alvo.votos && alvo.primeiroTs < vencedor.alvo.primeiroTs)
    ) {
      vencedor = { botao, alvo };
    }
  }

  if (vencedor && executor) {
    try {
      executor({
        botao: vencedor.botao,
        votos: vencedor.alvo.votos,
        eleitores: vencedor.alvo.eleitores.size,
      });
    } catch (err) {
      logger.erro(`[Votação] Executor falhou: ${err.message}`);
    }
  }

  votos = new Map();
  votoDe = new Map();
  agendarJanela();
}

/** Cancela a janela corrente (troca de modo / reset). */
function pararJanela() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  janelaFimEm = 0;
}

/**
 * Estado para o overlay do OBS (candidatos + contagem regressiva).
 * @returns {{modo: string, restanteMs: number, intervaloMs: number,
 *   candidatos: Array<{botao: string, votos: number}>, totalVotantes: number}}
 */
function status() {
  const candidatos = [...votos.entries()]
    .sort((a, b) => b[1].votos - a[1].votos || a[1].primeiroTs - b[1].primeiroTs)
    .slice(0, 4)
    .map(([botao, alvo]) => ({ botao, votos: alvo.votos }));
  return {
    modo,
    restanteMs: modo === 'democracia' ? Math.max(0, janelaFimEm - Date.now()) : 0,
    intervaloMs,
    candidatos,
    totalVotantes: votoDe.size,
  };
}

/** Reseta tudo (testes). */
function resetar() {
  pararJanela();
  modo = 'anarquia';
  votos = new Map();
  votoDe = new Map();
  ultimaTroca = 0;
}

module.exports = {
  configurar,
  configurarExecutor,
  observar,
  modoAtual,
  definirModo,
  alternarModo,
  votar,
  status,
  resetar,
};
