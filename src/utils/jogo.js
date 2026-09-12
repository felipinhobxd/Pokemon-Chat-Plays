/**
 * Gerenciador de jogo (v2.7) — abre, vigia e REABRE o jogo do stream.
 *
 * Pedido do streamer: "ele pergunta o PATH do jogo, não só o emulador,
 * porque assim pode usar VÁRIOS emuladores, ou até jogos como Minecraft.
 * E faz com que ele cheque se o jogo fechou e tente abrir de novo com a
 * ROM que estava antes."
 *
 * Como funciona:
 *  1. No boot (com EMULADOR_EXE no .env/assistente):
 *     - jogo JÁ RODANDO?  -> modo ANEXAR: só vigia (não abre 2ª instância)
 *     - jogo PARADO?      -> ABRE: spawn(exe, [rom, ...args])
 *  2. Watchdog:
 *     - modo spawn: o evento 'exit' do filho avisa NA HORA que fechou
 *     - modo anexar: ping a cada 5s (tasklist no Win, pgrep no Linux/Mac)
 *  3. Jogo fechou?  -> espera JOGO_REINICIAR_DELAY_MS e reabre com a MESMA
 *     ROM. Anti crash-loop: se o jogo morrer rápido (< JOGO_VIDA_MINIMA_MS)
 *     JOGO_TENTATIVAS_MAX vezes seguidas, o bot DESISTE e avisa (ROM errada,
 *     exe quebrado... reabrir pra sempre só leria lixo no terminal).
 *
 * O processo do jogo NUNCA é morto pelo bot — é do streamer. O Ctrl+C do
 * bot encerra só a vigilância.
 *
 * Tudo que decide reinício é função PURA (avaliarQueda) — testável sem
 * processo de verdade.
 */

const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

/** Intervalo do ping de vigilância no modo anexar (ms). */
const INTERVALO_PING_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers puros (testáveis)
// ---------------------------------------------------------------------------

/**
 * Limpa um caminho colado pelo usuário: aspas do "Copiar como caminho"
 * do Windows, espaços das pontas, quebras de linha acidentais (colagem do
 * chat/terminal) e barras duplicadas.
 * @param {string} entrada
 * @returns {string}
 */
function normalizarCaminhoJogo(entrada) {
  let t = String(entrada || '').trim();
  if (!t) return '';
  const aspas = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  if (aspas && t.length >= 2) t = t.slice(1, -1).trim();
  t = t.replace(/[\r\n]+/g, '');
  const ehUnc = t.startsWith('\\\\');
  t = t.replace(/\\{2,}/g, '\\');
  if (ehUnc && !t.startsWith('\\\\')) t = '\\' + t;
  return t.trim();
}

/**
 * Divide uma string de argumentos respeitando aspas ("a b" = um argumento).
 * @param {string} argsTexto
 * @returns {string[]}
 */
function dividirArgs(argsTexto) {
  const bruto = String(argsTexto || '').trim();
  if (!bruto) return [];
  const partes = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(bruto)) !== null) {
    partes.push(m[1] ?? m[2] ?? m[3]);
  }
  return partes;
}

/**
 * Linha de comando final do jogo (PURO — teste não executa nada).
 * @param {object} p - { exe, rom, args }
 * @returns {{file: string, args: string[], cwd: string|null}}
 */
function montarLinhaComando({ exe, rom, args } = {}) {
  const file = normalizarCaminhoJogo(exe);
  const lista = [];
  const romLimpa = normalizarCaminhoJogo(rom);
  if (romLimpa) lista.push(romLimpa);
  lista.push(...dividirArgs(args));
  let cwd = null;
  try {
    if (file) cwd = path.dirname(path.resolve(file));
  } catch { /* caminho esquisito — cwd fica null */ }
  return { file, args: lista, cwd };
}

/**
 * Decide o que fazer quando o jogo fecha (PURO — núcleo do watchdog).
 * @param {object} p
 * @param {boolean} p.autoReiniciar - vigília ligada?
 * @param {boolean} p.encerrando    - o próprio BOT está encerrando? (não reabre)
 * @param {boolean} p.desistiu      - já bateu o limite de tentativas?
 * @param {number}  p.viveuMs       - quanto tempo esta rodada viveu
 * @param {number}  p.tentativas    - quedas rápidas consecutivas ATÉ AGORA
 * @param {number}  p.tentativasMax - teto de quedas rápidas
 * @param {number}  p.vidaMinimaMs  - abaixo disto a queda é "rápida"
 * @returns {{acao: 'reabrir'|'nada'|'desistir', tentativas: number, motivo: string}}
 */
function avaliarQueda({ autoReiniciar, encerrando, desistiu, viveuMs, tentativas, tentativasMax, vidaMinimaMs } = {}) {
  if (encerrando) return { acao: 'nada', tentativas, motivo: 'bot encerrando' };
  if (!autoReiniciar) return { acao: 'nada', tentativas, motivo: 'reinício automático desligado' };
  if (desistiu) return { acao: 'nada', tentativas, motivo: 'desistiu (crash loop)' };

  const rapida = Number(viveuMs || 0) < Number(vidaMinimaMs || 0);
  const novoContador = rapida ? tentativas + 1 : 0;
  if (novoContador >= Number(tentativasMax || 0)) {
    return { acao: 'desistir', tentativas: novoContador, motivo: 'crash loop' };
  }
  return {
    acao: 'reabrir',
    tentativas: novoContador,
    motivo: rapida ? 'queda rápida' : 'fechou depois de rodar',
  };
}

/** Nome base do executável em qualquer formato de barra. */
function nomeDoProcesso(exe) {
  const limpo = normalizarCaminhoJogo(exe);
  if (!limpo) return '';
  return limpo.replace(/\\/g, '/').split('/').filter(Boolean).pop() || limpo;
}

/**
 * Conta quantas linhas de CSV do tasklist são registros de processo
 * (linhas começando com aspas; o cabeçalho também é uma — 2+ = rodando).
 * @param {string} saida
 * @returns {number}
 */
function contarLinhasDeProcesso(saida) {
  return String(saida || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('"')).length;
}

/**
 * Escapa metacaracteres de ERE — o `pgrep -f` interpreta o padrão como
 * REGEX, e caminhos com . \ ( ) [ ] precisam bater LITERALMENTE
 * (v2.7.1: "vbam.exe" como regex casa "vbamXexe").
 * @param {string} texto
 * @returns {string}
 */
function escaparEre(texto) {
  return String(texto || '').replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PIDs que o pgrep listou, SEM o PID do próprio bot — quando o "jogo"
 * compartilha o binário com o bot (ex.: node em smoke/teste), o padrão
 * casa o bot também e daria "já está rodando" pra sempre.
 * @param {string} saida - stdout do pgrep (um PID por linha)
 * @param {number} pidExcluir - PID a ignorar
 * @returns {number[]}
 */
function pidsDoPgrep(saida, pidExcluir) {
  return String(saida || '')
    .split(/\r?\n/)
    .map((l) => parseInt(l, 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== pidExcluir);
}

// ---------------------------------------------------------------------------
// Estado do gerenciador
// ---------------------------------------------------------------------------

let cfg = {
  exe: '',
  rom: '',
  args: '',
  autoReiniciar: true,
  delayMs: 3000,
  tentativasMax: 5,
  vidaMinimaMs: 15000,
  startupGraceMs: 0,
  nomeGerenciado: '',
};

let procAtual = null;      // child process quando o bot abriu o jogo
let inicioDaVida = 0;      // quando esta rodada nasceu (p/ vida da rodada)
let timerReabrir = null;
let timerPing = null;
let pingEmVoo = false;
let geracao = 0;
let modoOperacao = 'off';  // 'spawn' | 'anexar' | 'off'
let rodando = false;
let reinicios = 0;
let tentativasRapidas = 0;
let desistiu = false;
let encerrando = false;
let aoEvento = () => {};

/**
 * Detector de "o jogo está rodando?" — injetável para os testes (em
 * produção é o jogoEstaRodando real: tasklist/pgrep).
 */
let detectorDeProcesso = null;
let lancadorCustom = null;
let aguardandoSubidaAte = 0;

function nomeGerenciado() {
  return String(cfg.nomeGerenciado || '').trim() || nomeDoProcesso(cfg.exe);
}

/** Notifica o index.js (log + overlay) do que aconteceu. */
function notificar(tipo, detalhes = {}) {
  try {
    aoEvento({
      tipo,
      rodando,
      reinicios,
      tentativas: tentativasRapidas,
      desistiu,
      modo: modoOperacao,
      ...detalhes,
    });
  } catch { /* listener do index nunca pode derrubar o watchdog */ }
}

// ---------------------------------------------------------------------------
// Detecção de processo rodando (modo anexar)
// ---------------------------------------------------------------------------

/**
 * O jogo está rodando neste PC? (best-effort por plataforma)
 * Windows: tasklist /fo csv /fi "IMAGENAME eq nome.exe" — o filtro é por
 * NOME (não caminho) porque o tasklist não aceita caminho; se o streamer
 * tem outro exe com o mesmo nome, no pior caso ele "anexa" errado e não
 * abre 2ª instância — cenário inofensivo.
 * Linux/macOS: pgrep -f caminho.
 * @returns {Promise<boolean|null>} true/false; null = não sei (plataforma
 *   sem suporte — o watchdog de anexo fica desligado)
 */
function jogoEstaRodando() {
  if (detectorDeProcesso) return Promise.resolve().then(detectorDeProcesso);
  return new Promise((resolve) => {
    const nome = nomeDoProcesso(cfg.exe);
    if (!nome) { resolve(false); return; }

    let proc;
    try {
      if (process.platform === 'win32') {
        proc = spawn('tasklist', ['/fo', 'csv', '/fi', `IMAGENAME eq ${nome}`], { stdio: ['ignore', 'pipe', 'ignore'] });
      } else if (process.platform === 'linux' || process.platform === 'darwin') {
        // v2.7.1: escape de ERE (o padrão é regex pro pgrep) + stdout captado
        // para excluir o PID do próprio bot da lista de casamentos
        proc = spawn('pgrep', ['-f', escaparEre(normalizarCaminhoJogo(cfg.exe))], { stdio: ['ignore', 'pipe', 'ignore'] });
      } else {
        resolve(null);
        return;
      }
    } catch {
      resolve(null);
      return;
    }

    let saida = '';
    let concluido = false;
    const timeout = setTimeout(() => {
      if (concluido) return;
      try { proc.kill(); } catch { /* best effort */ }
      concluir(null);
    }, 4000);
    timeout.unref?.();
    const concluir = (valor) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timeout);
      proc.removeAllListeners?.();
      resolve(valor);
    };
    proc.on('error', () => concluir(null));
    proc.stdout?.on('data', (chunk) => { saida += String(chunk); });
    proc.on('close', (code) => {
      if (process.platform === 'win32') {
        concluir(contarLinhasDeProcesso(saida) >= 2);
      } else {
        // v2.7.1: conta pelos PIDs listados (código de saída sozinho não
        // separa "achou só o bot" de "achou o jogo de verdade")
        concluir(pidsDoPgrep(saida, process.pid).length > 0);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Lançamento + watchdog
// ---------------------------------------------------------------------------

/**
 * Abre o jogo. Em fluxos normais faz spawn(exe). Com `lancadorCustom`, o
 * executável configurado é apenas o launcher e o processo real é detectado
 * separadamente (ex.: ATLauncher -> javaw.exe do Minecraft).
 */
async function lancar() {
  if (lancadorCustom) {
    const minhaGeracao = geracao;
    try {
      const ok = await Promise.resolve().then(() => lancadorCustom());
      if (!ok || minhaGeracao !== geracao || encerrando) return false;
      procAtual = null;
      rodando = false;
      inicioDaVida = 0;
      modoOperacao = 'launcher';
      aguardandoSubidaAte = Date.now() + Math.max(0, Number(cfg.startupGraceMs) || 0);
      notificar('launcher-acionado', { aguardandoSubida: true });
      iniciarPing();
      return true;
    } catch (err) {
      logger.erro(`[Jogo] Launcher falhou: ${err?.message || err}`);
      return false;
    }
  }

  const { file, args, cwd } = montarLinhaComando(cfg);
  if (!file) return false;

  try {
    const filho = spawn(file, args, {
      cwd: cwd || undefined,
      stdio: 'ignore',       // a saída do jogo não polui o terminal do bot
      detached: false,       // filho morde o mesmo console (sem flash de cmd)
    });
    procAtual = filho;
    inicioDaVida = Date.now();
    aguardandoSubidaAte = 0;
    rodando = true;
    modoOperacao = 'spawn';

    const geracaoLancamento = geracao;
    const ehAtual = () => filho === procAtual && geracaoLancamento === geracao;

    filho.on('error', (err) => {
      // spawn falhou (exe não existe etc.) — o 'exit' pode nem chegar
      logger.erro(`[Jogo] Não consegui abrir "${file}" (${err.message}).`);
      if (ehAtual()) tratarFechamento();
    });
    filho.on('exit', (codigo) => {
      if (!ehAtual()) return; // notícia de processo velho — ignora
      logger.info(`[Jogo] Processo terminou (código ${codigo}).`);
      tratarFechamento();
    });
    return true;
  } catch (err) {
    logger.erro(`[Jogo] Erro ao abrir "${file}": ${err.message}`);
    tratarFechamento();
    return false;
  }
}

/** O jogo fechou — decide reabrir / desistir / nada. */
function tratarFechamento() {
  procAtual = null;
  rodando = false;
  const viveuMs = inicioDaVida ? Date.now() - inicioDaVida : 0;
  inicioDaVida = 0;
  aguardandoSubidaAte = 0;

  const decisao = avaliarQueda({
    autoReiniciar: cfg.autoReiniciar,
    encerrando,
    desistiu,
    viveuMs,
    tentativas: tentativasRapidas,
    tentativasMax: cfg.tentativasMax,
    vidaMinimaMs: cfg.vidaMinimaMs,
  });
  tentativasRapidas = decisao.tentativas;

  if (decisao.acao === 'desistir') {
    desistiu = true;
    notificar('desistiu');
    logger.erro(
      `[Jogo] ⛔ O jogo fechou rápido ${tentativasRapidas}x seguidas — desisti de reabrir. ` +
      'Confira se a ROM existe, se o caminho do .exe está certo e se o emulador abre na mão.'
    );
    pararPing();
    return;
  }

  if (decisao.acao !== 'reabrir') {
    notificar('fechou');
    logger.info('[Jogo] Jogo fechado — reinício automático desligado (JOGO_AUTO_REINICIAR=false).');
    pararPing();
    return;
  }

  if (timerReabrir) return; // queda duplicada/evento tardio não agenda outro processo

  // v2.7.1: reinicios conta reaberturas REAIS (incrementa no relançamento,
  // não na decisão — parar() antes do delay não deixa contagem fantasma)
  notificar('reabrindo');
  logger.aviso(
    `[Jogo] 🔄 Jogo fechou (${decisao.motivo}). Reabrindo em ${Math.round(cfg.delayMs / 1000)}s` +
    `${cfg.rom ? ` com a ROM ${nomeDoProcesso(cfg.rom)}` : ''} — tentativa rápida ${tentativasRapidas}/${cfg.tentativasMax}.`
  );
  const geracaoAgendada = geracao;
  timerReabrir = setTimeout(async () => {
    timerReabrir = null;
    if (encerrando || desistiu || geracaoAgendada !== geracao) return;
    const nasceu = await lancar();
    if (nasceu && !encerrando && geracaoAgendada === geracao) {
      reinicios++;
      notificar('reaberto');
    }
  }, Math.max(0, Number(cfg.delayMs) || 0));
}

// ---------------------------------------------------------------------------
// Ping de vigilância (modo anexar — jogo aberto pelo próprio streamer)
// ---------------------------------------------------------------------------

function iniciarPing() {
  pararPing();
  const minhaGeracao = geracao;
  const reagendar = (ciclo) => {
    timerPing = setTimeout(ciclo, INTERVALO_PING_MS);
    timerPing.unref?.();
  };
  const ciclo = async () => {
    timerPing = null;
    if (minhaGeracao !== geracao || encerrando || desistiu || procAtual) return;
    if (pingEmVoo) { reagendar(ciclo); return; }
    pingEmVoo = true;
    let vivo = null;
    try { vivo = await jogoEstaRodando(); } finally { pingEmVoo = false; }
    if (minhaGeracao !== geracao || encerrando || desistiu || procAtual) return;

    if (vivo === true) {
      if (!rodando) {
        rodando = true;
        inicioDaVida = Date.now();
        aguardandoSubidaAte = 0;
        notificar('detectado');
        logger.info(`[Jogo] ✅ ${nomeGerenciado()} detectado — vigília ativa.`);
      }
      reagendar(ciclo);
      return;
    }

    if (vivo === false) {
      if (!rodando && aguardandoSubidaAte > Date.now()) {
        // Launcher já foi acionado, mas Java/Minecraft ainda está subindo.
        reagendar(ciclo);
        return;
      }
      if (!rodando && aguardandoSubidaAte) {
        logger.aviso(`[Jogo] ${nomeGerenciado()} não apareceu dentro do tempo de inicialização.`);
      } else {
        logger.info('[Jogo] Detectei que o jogo foi fechado (vigília por ping).');
      }
      inicioDaVida = inicioDaVida || (Date.now() - INTERVALO_PING_MS * 2);
      tratarFechamento();
      return;
    }

    // null = detector indisponível: nunca assume que o jogo morreu.
    reagendar(ciclo);
  };
  reagendar(ciclo);
}

function pararPing() {
  if (timerPing) { clearTimeout(timerPing); timerPing = null; }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Define os parâmetros do gerenciador.
 * @param {object} opts - { exe, rom, args, autoReiniciar, delayMs,
 *   tentativasMax, vidaMinimaMs, aoEvento, detector, lancador,
 *   startupGraceMs, nomeGerenciado }
 */
function configurar(opts = {}) {
  cfg = {
    exe: normalizarCaminhoJogo(opts.exe),
    rom: normalizarCaminhoJogo(opts.rom),
    args: String(opts.args || ''),
    autoReiniciar: opts.autoReiniciar !== false,
    delayMs: Number.isFinite(Number(opts.delayMs)) ? Number(opts.delayMs) : 3000,
    tentativasMax: Number(opts.tentativasMax) > 0 ? Number(opts.tentativasMax) : 5,
    vidaMinimaMs: Number(opts.vidaMinimaMs) >= 0 ? Number(opts.vidaMinimaMs) : 15000,
    startupGraceMs: Number(opts.startupGraceMs) >= 0 ? Number(opts.startupGraceMs) : 0,
    nomeGerenciado: String(opts.nomeGerenciado || ''),
  };
  if (typeof opts.aoEvento === 'function') aoEvento = opts.aoEvento;
  detectorDeProcesso = typeof opts.detector === 'function' ? opts.detector : null;
  lancadorCustom = typeof opts.lancador === 'function' ? opts.lancador : null;
}

/**
 * Sobe a vigilância (e abre o jogo se não estiver rodando).
 * @returns {Promise<{ok: boolean, modo: string}>}
 */
async function iniciar() {
  if (!cfg.exe) return { ok: false, modo: 'off' };
  encerrando = false;
  const minhaGeracao = ++geracao;

  const jaRodando = await jogoEstaRodando();
  if (minhaGeracao !== geracao || encerrando) return { ok: false, modo: 'off', obsoleto: true };
  if (jaRodando === true) {
    // o streamer já abriu o jogo — só vigia (não abre 2ª instância)
    modoOperacao = 'anexar';
    rodando = true;
    inicioDaVida = Date.now();
    reinicios = 0;
    tentativasRapidas = 0;
    desistiu = false;
    notificar('anexado');
    logger.info(`[Jogo] 🎮 "${nomeGerenciado()}" já está rodando — só vigiando (reabro se fechar).`);
    iniciarPing();
    return { ok: true, modo: 'anexar' };
  }

  reinicios = 0;
  tentativasRapidas = 0;
  desistiu = false;
  const nasceu = await lancar();
  if (nasceu) {
    notificar('aberto');
    const romTxt = cfg.rom ? ` com ${nomeDoProcesso(cfg.rom)}` : '';
    if (lancadorCustom) {
      logger.info(`[Jogo] 🚀 Launcher acionado para abrir ${nomeGerenciado()} — aguardando o processo real do jogo.`);
    } else {
      logger.info(`[Jogo] 🚀 Abri o jogo "${nomeGerenciado()}"${romTxt} — reabro sozinho se fechar (JOGO_AUTO_REINICIAR=${cfg.autoReiniciar ? 'on' : 'off'}).`);
    }
  }
  return { ok: nasceu, modo: nasceu ? (lancadorCustom ? 'launcher' : 'spawn') : 'off' };
}

/** Encerra a vigilância (NÃO mata o jogo — ele é do streamer). */
function parar() {
  geracao++;
  encerrando = true;
  if (timerReabrir) { clearTimeout(timerReabrir); timerReabrir = null; }
  pararPing();
  procAtual = null;
  aguardandoSubidaAte = 0;
  rodando = false;
}

/** Estado atual (overlay/log). */
function status() {
  return {
    ativo: modoOperacao !== 'off' || Boolean(cfg.exe),
    exe: cfg.exe,
    rom: cfg.rom,
    romNome: cfg.rom ? nomeDoProcesso(cfg.rom) : '',
    nome: nomeGerenciado(),
    aguardandoSubida: Boolean(aguardandoSubidaAte && aguardandoSubidaAte > Date.now()),
    modo: modoOperacao,
    rodando: rodando || Boolean(procAtual),
    reabrindo: Boolean(timerReabrir),
    reinicios,
    tentativas: tentativasRapidas,
    tentativasMax: cfg.tentativasMax,
    desistiu,
  };
}

/** Reinicia o módulo inteiro (testes). */
function __resetTeste() {
  parar();
  encerrando = false;
  modoOperacao = 'off';
  rodando = false;
  reinicios = 0;
  tentativasRapidas = 0;
  desistiu = false;
  inicioDaVida = 0;
  aoEvento = () => {};
  detectorDeProcesso = null;
  lancadorCustom = null;
  aguardandoSubidaAte = 0;
  pingEmVoo = false;
  geracao = 0;
  cfg = {
    exe: '', rom: '', args: '', autoReiniciar: true,
    delayMs: 3000, tentativasMax: 5, vidaMinimaMs: 15000,
    startupGraceMs: 0, nomeGerenciado: '',
  };
}

module.exports = {
  // puros (testes)
  normalizarCaminhoJogo,
  dividirArgs,
  montarLinhaComando,
  avaliarQueda,
  nomeDoProcesso,
  contarLinhasDeProcesso,
  escaparEre,
  pidsDoPgrep,
  // gerenciador
  configurar,
  iniciar,
  parar,
  status,
  __resetTeste,
};
