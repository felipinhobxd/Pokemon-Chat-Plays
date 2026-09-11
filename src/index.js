/**
 * Pokemon Chat Plays
 * Ponto de entrada principal.
 *
 * Conecta o(s) cliente(s) (Twitch e/ou YouTube) e gerencia o ciclo de vida
 * do bot. No encerramento (Ctrl+C), garante que TODAS as teclas presas
 * por comandos de hold sejam soltas antes de morrer.
 *
 * Novidades v2.3:
 *  - Teclas configuráveis via .env (EMULADOR_PRESET + TECLA_*)
 *  - Stats persistentes (dados/stats.json) — ranking sobrevive a restarts
 *  - Overlay do OBS (http://localhost:8899) com ações/top/seguradas ao vivo
 *  - Tecla F9: o streamer pausa/libera o chat a qualquer momento
 *    (Enter no terminal também funciona)
 *  - Aviso automático quando sai versão nova no GitHub
 *
 * Novidade v2.4 (MODO JANELA — o chat controla SÓ o jogo):
 *  - No boot o bot pergunta o .exe do emulador (ou lê EMULADOR_EXE do .env)
 *    e passa a mandar as teclas DIRETO para a janela dele (PostMessage):
 *    o streamer pode ficar no OBS sem as teclas do chat vazarem para lá.
 *  - O caminho fica salvo em dados/emulador.json (Enter mantém o salvo).
 *  - MODO_TECLADO=global devolve o comportamento antigo.
 *
 * Novidades v2.5 (DEMOCRACIA + SAVES):
 *  - Modo DEMOCRACIA/anarquia: em democracia o chat VOTA e o comando mais
 *    votado de cada janela é executado; !democracia / !anarquia / !votacao
 *    trocam o modo (tecla F8 do streamer também — MODO_TECLADO=off desliga)
 *  - Savestates: salvar/carregar viraram botões (padrão Shift+F5/F5)
 *  - TECLA_PAUSA configurável (padrão F9) e tecla de savestate no !comandos
 *
 * Uso:
 *   npm start
 *   node src/index.js
 */

const path = require('path');
const readline = require('readline');
const logger = require('./utils/logger');
const { config, validarConfig } = require('./config');
const twitch = require('./controllers/twitch');
const youtube = require('./controllers/youtube');
const stats = require('./utils/stats');
const teclado = require('./controllers/keyboard');
const pausa = require('./utils/pausa');
const overlay = require('./overlay');
const atualizacao = require('./utils/atualizacao');
const emulador = require('./utils/emulador');
const jogo = require('./utils/jogo');
const votacao = require('./utils/votacao');
const { montarMapeamento } = require('./presets');
const { msgChatPausado, msgChatLiberado, msgVencedor, msgModoDemocracia, msgModoAnarquia } = require('./messages');
const { verificarSistema, soltarTodasSync } = teclado;
const assistente = require('./assistente');

// Silencia avisos experimentais (ex.: "Fetch API is an experimental feature"
// no Node 18 do .exe) para não poluir o terminal durante a live.
process.on('warning', (aviso) => {
  if (aviso && String(aviso.name).includes('ExperimentalWarning')) return;
  console.error(aviso && aviso.stack ? aviso.stack : aviso);
});

// Versão lida do package.json (mantém o banner sempre em dia)
const { version: VERSAO } = require('../package.json');

/**
 * Espera uma promessa com TETO de tempo — o Ctrl+C nunca pode ficar
 * refém de um cliente de chat que não responde (v2.4.1).
 * @param {Promise|null} promessa
 * @param {number} limiteMs
 */
function aguardarComLimite(promessa, limiteMs) {
  let timer = null;
  const limite = new Promise((resolve) => {
    timer = setTimeout(resolve, limiteMs);
    timer.unref?.();
  });
  return Promise.race([
    Promise.resolve(promessa).catch(() => { /* já logado em cada módulo */ }),
    limite,
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

// Trata Ctrl+C e encerramento limpo
let encerrando = false;
let interfaceTerminal = null;

async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  logger.aviso(`Sinal recebido (${sinal}). Encerrando...`);
  try {
    // Primeiro solta as teclas (um jogo com tecla presa é péssimo)
    soltarTodasSync();
    // Para a vigilância do jogo (NÃO fecha o jogo — ele é do streamer)
    jogo.parar();
    // Depois salva o histórico de stats na hora (autosave é de 30s)
    stats.salvar();
    pausa.pararWatcher();
    if (interfaceTerminal) interfaceTerminal.close();
    // cada etapa com teto: nenhuma pode travar o Ctrl+C
    await aguardarComLimite(overlay.parar(), 2000);
    await aguardarComLimite(twitch.parar(), 3000);
    await aguardarComLimite(youtube.parar(), 1000);
    await aguardarComLimite(assistente.parar(), 1000);
    stats.logResumo();
  } catch (err) {
    logger.erro(`Erro no encerramento: ${err.message}`);
  }
  process.exit(0);
}

/**
 * Pergunta/decide o emulador alvo ANTES de conectar o chat (v2.4).
 * Ordem: MODO_TECLADO=global (força antigo) > EMULADOR_EXE do .env >
 * prompt no terminal (com Enter mantendo o último salvo).
 * Define o modo no controlador de teclado e reflete na overlay.
 * v2.7: além do alvo das teclas, devolve o exe resolvido para o
 * gerenciador de jogo (abrir/vigiar/reabrir) — os papéis são separados:
 * teclado global não impede o bot de abrir o jogo.
 * @returns {string|null} caminho do exe resolvido (null = sem alvo)
 */
let exeDoJogo = null;

async function configurarAlvoDoEmulador() {
  const arquivoSalvo = path.resolve(process.cwd(), 'dados', 'emulador.json');

  // 1) .env força o comportamento antigo — nem pergunta (o jogo ainda
  //    pode ser gerenciado: teclado global ≠ não abrir o jogo)
  if (config.teclado.modo === 'global') {
    exeDoJogo = emulador.normalizarCaminhoExe(config.teclado.emuladorExe) || null;
    teclado.configurarAlvoJanela(null);
    overlay.setAlvo(null);
    logger.aviso('[Teclado] MODO_TECLADO=global no .env — teclas vão para a janela EM FOCO (comportamento antigo).');
    return exeDoJogo;
  }

  // 2) .env já define o caminho — usa direto
  const doEnv = emulador.normalizarCaminhoExe(config.teclado.emuladorExe);
  if (doEnv) {
    exeDoJogo = doEnv;
    teclado.configurarAlvoJanela(doEnv);
    overlay.setAlvo(doEnv);
    logger.info(`[Teclado] 🎯 EMULADOR_EXE do .env: ${doEnv}`);
    if (!emulador.arquivoExiste(doEnv)) {
      logger.aviso('[Teclado] ⚠️ Esse arquivo não existe agora — o bot avisa se não achar o emulador rodando.');
    }
    return exeDoJogo;
  }

  const salvo = emulador.carregarSalvo(arquivoSalvo);

  // 3) sem terminal interativo (serviço/CI): usa o salvo ou cai no global
  if (!process.stdin.isTTY) {
    if (salvo) {
      exeDoJogo = salvo;
      teclado.configurarAlvoJanela(salvo);
      overlay.setAlvo(salvo);
      logger.info(`[Teclado] 🎯 Emulador salvo: ${salvo} — teclas do chat vão DIRETO para a janela dele.`);
    } else {
      exeDoJogo = null;
      teclado.configurarAlvoJanela(null);
      overlay.setAlvo(null);
      logger.aviso('[Teclado] Sem terminal interativo e sem emulador salvo — modo global (janela em foco).');
    }
    return exeDoJogo;
  }

  // 4) pergunta o .exe (pedido do streamer: "antes de iniciar pede o .exe")
  const pergunta = [
    '🎮 Para o chat controlar SÓ O JOGO (você fica livre mexendo no OBS),',
    '   cole o caminho do .exe do jogo. Ex.: C:\\Emuladores\\visualboyadvance-m.exe',
    salvo
      ? `   Enter = manter "${salvo}" · ou cole outro caminho · "global" = modo antigo:`
      : '   Enter = modo global (teclas vão para a janela em foco) · ou cole um caminho:',
    '> ',
  ].join('\n');
  const resposta = await emulador.perguntar(pergunta);
  const decisao = emulador.decidirAlvo({ salvo, resposta });

  if (decisao.salvar) {
    emulador.salvarAlvo(arquivoSalvo, decisao.exe);
  }

  exeDoJogo = decisao.exe;
  teclado.configurarAlvoJanela(decisao.exe);
  overlay.setAlvo(decisao.exe);

  if (decisao.exe) {
    logger.info(`[Teclado] 🎯 Alvo definido (${decisao.origem}): ${decisao.exe}`);
    logger.info('[Teclado] As teclas do chat vão DIRETO para a janela do emulador — pode clicar no OBS sem medo.');
    if (!emulador.arquivoExiste(decisao.exe)) {
      logger.aviso(`[Teclado] ⚠️ "${decisao.exe}" não existe agora. Se o caminho estiver errado, o bot avisa quando o emulador não for encontrado (reinicie para redigitar).`);
    }
  } else {
    logger.info('[Teclado] Modo GLOBAL: as teclas do chat vão para a janela EM FOCO (igual às versões antigas).');
    logger.info('[Teclado] Dica: reinicie e cole o caminho do .exe do emulador para ativar o modo janela.');
  }
  return exeDoJogo;
}

/**
 * Gerenciador de jogo (v2.7): abre o jogo com a ROM, vigia e REABRE se
 * fechar. Sem exe configurado, não faz nada (o streamer abre o jogo na mão,
 * como sempre funcionou).
 */
function iniciarGerenciadorJogo() {
  if (!exeDoJogo) return;

  jogo.configurar({
    exe: exeDoJogo,
    rom: config.jogo.rom,
    args: config.jogo.args,
    autoReiniciar: config.jogo.autoReiniciar,
    delayMs: config.jogo.reiniciarDelayMs,
    tentativasMax: config.jogo.tentativasMax,
    vidaMinimaMs: config.jogo.vidaMinimaMs,
    aoEvento: (ev) => {
      // reflete na overlay (rodapé: 🎮 rodando / 🔄 reabrindo)
      overlay.setJogo(jogo.status());
      if (ev.tipo === 'reaberto') {
        logger.info('[Jogo] ✅ Jogo reaberto — a live continua!');
      }
    },
  });

  overlay.setJogo({ ...jogo.status(), rodando: false, reabrindo: false });

  jogo
    .iniciar()
    .then((r) => {
      overlay.setJogo(jogo.status());
      if (!r.ok && r.modo === 'off') {
        logger.aviso('[Jogo] ⚠️ Não consegui abrir o jogo — confira o caminho do .exe (o bot segue funcionando normalmente).');
      }
    })
    .catch((err) => {
      logger.aviso(`[Jogo] ⚠️ Vigília do jogo não subiu (${err?.message || err}).`);
    });
}

/**
 * Aplica o mapeamento de teclas do .env (preset + TECLA_*).
 * Tecla inválida não derruba o app: avisa e usa o padrão.
 */
function aplicarMapeamentoTeclas() {
  const { mapa, preset, presetDesconhecido, sobrescritas } = montarMapeamento(
    config.teclado.preset,
    config.teclado.teclas
  );

  if (presetDesconhecido) {
    logger.aviso(`[Teclado] EMULADOR_PRESET="${config.teclado.preset}" desconhecido — usando VBA-M.`);
  }

  // Valida cada tecla configurada (padrões do preset também são válidos)
  let invalidas = 0;
  for (const [botao, tecla] of Object.entries(mapa)) {
    if (!teclado.teclaSuportada(tecla)) {
      logger.erro(`[Teclado] TECLA para "${botao}" inválida: "${tecla}" — valores aceitos: setas, enter, backspace, space, tab, esc, shift, ctrl, alt, f1-f12, a-z, 0-9 e combos como shift+f5`);
      invalidas++;
    }
  }

  teclado.configurarMapeamento(mapa);
  const nomesPreset = { vbam: 'VBA-M', mgba: 'mGBA', desmume: 'DeSmuME', retroarch: 'RetroArch' };
  logger.info(`[Teclado] Preset do emulador: ${nomesPreset[preset] || preset}${sobrescritas > 0 ? ` + ${sobrescritas} tecla(s) customizada(s) do .env` : ''}${invalidas > 0 ? ` (${invalidas} tecla(s) inválida(s) usará o padrão)` : ''}`);
}

/**
 * Configura as stats persistentes (carrega histórico + autosave).
 */
function configurarStatsPersistentes() {
  if (!config.geral.statsAtivadas || !config.stats.persistente) return;
  const caminho = path.resolve(process.cwd(), config.stats.arquivo);
  const carregou = stats.configurarArquivo(caminho);
  const resumo = stats.resumo();
  if (carregou) {
    logger.info(`[Stats] 📊 Histórico carregado: ${resumo.total} comandos de ${resumo.jogadores} jogador(es) — uptime acumulado ${resumo.uptimeMin}min`);
    logger.info(`[Stats] Arquivo: ${caminho}`);
  } else {
    logger.info(`[Stats] 📊 Novo histórico — vai ser salvo em ${caminho}`);
  }
}

/**
 * Sobe a overlay do OBS (se ativada).
 */
async function iniciarOverlay() {
  if (!config.overlay.ativa) return;
  overlay.setVersao(VERSAO);
  overlay.configurarProvedores({
    seguradas: () => teclado.listarSeguradas(),
    resumoStats: () => stats.resumo(),
    votacao: () => votacao.status(),
  });
  overlay.setTeclaPausa(config.pausa.tecla);
  await overlay.iniciar(config.overlay.porta);
}

/**
 * Configura o modo DEMOCRACIA/ANARQUIA (v2.5):
 *  - executor: aperta a tecla vencedora, registra stats/overlay e avisa o chat
 *  - observador: anuncia trocas de modo vindas de fora do chat (F8/terminal)
 *  - MODO_INICIAL do .env, F8 do streamer (via watcher de teclas do pausa.js)
 */
function configurarVotacao() {
  votacao.configurar({
    intervaloMs: config.votacao.intervaloMs,
    trocaMinMs: config.votacao.trocaMinMs,
  });

  // O que acontece quando uma janela fecha e há um vencedor
  votacao.configurarExecutor(({ botao, votos, eleitores }) => {
    // A pausa do streamer (F9) bloqueia TODOS os comandos de jogo no
    // pipeline (handlers.js) — o vencedor da votação não pode ser exceção:
    // senão o jogo continuaria recebendo teclas com o chat "pausado".
    if (pausa.estaPausado()) {
      logger.aviso(`[Votação] Vencedor ${botao} (${votos} voto(s)) IGNORADO — o chat está pausado.`);
      return;
    }
    const ok = teclado.executarBotao(botao);
    if (!ok) return;
    stats.registrar(botao, 'democracia', `chat(${eleitores})`);
    overlay.registrarAcao('chat', botao, 'voto', votos);
    logger.comando(`[Votação] Vencedor: ${botao} (${votos} voto(s) de ${eleitores} pessoa(s))`);
    twitch.enviarMensagem(msgVencedor(botao, votos, eleitores));
  });

  // Anuncia trocas que NÃO vieram de comando do chat (o handlers já responde
  // no chat quando veio de lá — evita mensagem dupla)
  votacao.observar((novoModo, origem) => {
    if (String(origem || '').startsWith('chat') || String(origem || '').startsWith('streamer-cmd')) return;
    const texto = novoModo === 'democracia' ? msgModoDemocracia() : msgModoAnarquia();
    twitch.enviarMensagem(texto);
  });

  // MODO_INICIAL do .env (anarquia é o padrão — não anuncia nada)
  if (config.votacao.modoInicial === 'democracia') {
    votacao.definirModo('democracia', 'config MODO_INICIAL');
    logger.info(`[Votação] 🗳️ MODO_INICIAL=democracia — janelas de ${Math.round(config.votacao.intervaloMs / 1000)}s.`);
  }

  // Tecla do streamer (F8 por padrão) alterna o modo NA HORA
  if (config.votacao.tecla !== 'off') {
    const registrada = pausa.registrarTecla(config.votacao.tecla, () => {
      const r = votacao.alternarModo('tecla streamer');
      if (!r.mudou && r.motivo === 'troca recente') {
        logger.info(`[Votação] Troca ignorada (mudou há pouco) — aguarde ${Math.ceil((r.esperaMs || 0) / 1000)}s.`);
      }
    });
    if (!registrada && process.platform === 'win32') {
      logger.aviso(`[Votação] TECLA_MODO="${config.votacao.tecla}" inválida — use f1-f12, a-z... (ou 'off' para desligar).`);
    }
  }
}

/**
 * Configura o botão de pânico do streamer:
 *  - watcher PowerShell (Windows) para a tecla F9 global
 *  - ENTER no terminal como alternativa multi-plataforma
 *  - ao pausar: solta teclas presas + avisa o chat + reflete na overlay
 */
function configurarBotaoPanico() {
  pausa.observar((pausado, origem) => {
    overlay.setPausado(pausado);
    if (pausado) {
      logger.aviso(`[Pausa] ⛔ CHAT PAUSADO (${origem}) — comandos do chat serão ignorados.`);
      // solta tudo: hold pausado deixaria o personagem andando sozinho
      teclado.soltarTodas();
      twitch.enviarMensagem(msgChatPausado());
    } else {
      logger.aviso(`[Pausa] ✅ CHAT LIBERADO (${origem}) — o chat volta a controlar o jogo.`);
      twitch.enviarMensagem(msgChatLiberado());
    }
  });

  // TECLA_PAUSA do .env (v2.5 — padrão F9)
  pausa.configurarTecla(config.pausa.tecla);

  pausa.iniciarWatcherF9();

  // Alternativa universal: ENTER vazio (ou "p"/"pausa") no terminal alterna;
  // "modo"/"votacao"/"f8" alternam anarquia/democracia (multi-plataforma)
  interfaceTerminal = readline.createInterface({ input: process.stdin, terminal: false });
  interfaceTerminal.on('line', (linha) => {
    const texto = String(linha || '').trim().toLowerCase();
    if (texto === '' || texto === 'p' || texto === 'pausa' || texto === pausa.teclaAtual()) {
      pausa.alternar('terminal');
    } else if (texto === 'modo' || texto === 'votacao' || texto === 'f8' || texto === 'democracia' || texto === 'anarquia') {
      const r = votacao.alternarModo('terminal');
      if (r.motivo === 'troca recente') {
        logger.info(`[Votação] Troca ignorada — aguarde ${Math.ceil((r.esperaMs || 0) / 1000)}s.`);
      }
    }
  });
}

/**
 * Checa se saiu versão nova no GitHub (silencioso se offline).
 */
function verificarAtualizacao() {
  if (!config.atualizacao.verificar) return;
  atualizacao
    .avisarSeDesatualizado(VERSAO)
    .then((avisou) => {
      if (avisou) {
        logger.aviso('[Atualização] Você pode continuar usando esta versão — mas a nova corrige bugs.');
      }
    })
    .catch(() => { /* nunca derruba o app por causa disso */ });
}

/**
 * Função principal.
 */
async function main() {
  const versaoEspacada = `v${VERSAO}`.padEnd(10);
  logger.info('╔══════════════════════════════════════════╗');
  logger.info(`║   🎮  POKÉMON CHAT PLAYS  ${versaoEspacada.padEnd(11)}  ║`);
  logger.info('║   SindromeGames Edition                  ║');
  logger.info('╚══════════════════════════════════════════╝');
  logger.info(`Plataformas ativas: ${config.geral.plataformasAtivas.join(', ') || 'nenhuma'}`);

  if (!validarConfig()) {
    // v2.6: primeiro uso — em vez de morrer com erro, abre o assistente
    // no navegador; o boot continua sozinho depois de salvar.
    logger.aviso('[Main] Configuração incompleta — abrindo o assistente de configuração...');
    const configurado = await assistente.aguardarConfiguracao();
    if (!configurado) {
      logger.erro('[Main] Configuração cancelada. Rode o bot de novo quando quiser.');
      process.exit(1);
    }
    // o assistente já recarregou o config; valida de novo por garantia
    if (!validarConfig()) {
      logger.erro('[Main] Configuração ainda incompleta após o assistente. Verifique o .env.');
      process.exit(1);
    }
    logger.info('[Main] ✅ Configuração recebida do assistente — continuando o boot...');
  }

  // Emulador alvo (v2.4): pergunta o .exe ANTES de mexer em qualquer tecla
  await configurarAlvoDoEmulador();

  // Teclas customizáveis (v2.3) — antes de qualquer coisa tocar no teclado
  aplicarMapeamentoTeclas();

  // Jogo (v2.7): abre com a ROM + watchdog que reabre se fechar
  iniciarGerenciadorJogo();

  // Histórico de estatísticas (v2.3)
  configurarStatsPersistentes();

  // Verifica dependências de sistema (PowerShell/xdotool/osascript)
  const sistemaOk = await verificarSistema();
  if (!sistemaOk) {
    logger.aviso('[Main] Continuando mesmo assim - o teclado pode não funcionar.');
  }

  // Overlay do OBS (v2.3)
  await iniciarOverlay();

  // Modo democracia/anarquia (v2.5) — ANTES do watcher (registra a tecla F8)
  configurarVotacao();

  // Botão de pânico F9 (v2.3)
  configurarBotaoPanico();

  // Aviso de versão nova (v2.3) — não bloqueia o boot
  verificarAtualizacao();

  const plataformas = config.geral.plataformasAtivas;
  const promessas = [];

  if (plataformas.includes('twitch')) {
    promessas.push(
      twitch.iniciar().then((ok) => {
        if (!ok) logger.erro('[Main] Não foi possível iniciar o cliente Twitch.');
      })
    );
  }

  if (plataformas.includes('youtube')) {
    promessas.push(
      youtube.iniciar().then((ok) => {
        overlay.setConexao('youtube', Boolean(ok));
        if (!ok) logger.erro('[Main] Não foi possível iniciar o cliente YouTube.');
      })
    );
  }

  if (promessas.length === 0) {
    logger.erro('[Main] Nenhuma plataforma ativa. Configure ACTIVE_PLATFORMS no .env.');
    process.exit(1);
  }

  await Promise.allSettled(promessas);

  logger.info('Bot em execução. Pressione Ctrl+C para parar.');
  logger.info(`Streamer: ${pausa.teclaAtual().toUpperCase()} pausa/libera o chat · ENTER no terminal também · ${config.votacao.tecla === 'off' ? 'tecla de modo desligada' : `${config.votacao.tecla.toUpperCase()} alterna anarquia/democracia`}.`);
  logger.info(`Comandos de hold ativos: hold <direção/botão> [tempo] · "soltar" libera tudo.`);
}

// Handlers de sinais
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('uncaughtException', (err) => {
  // EPIPE no stdout (o processo pai fechou o pipe: terminal morto/harness):
  // logar via console lançaria EPIPE de novo — loop infinito de exceção →
  // log (foi assim que um log de 1,2 GB nasceu). Sai em silêncio salvando o que der.
  if (err && (err.code === 'EPIPE' || String(err.message || '').includes('EPIPE'))) {
    try { stats.salvar(); } catch { /* nada mais a fazer */ }
    process.exit(0);
  }
  logger.erro(`Exceção não capturada: ${err.message}`);
  if (err.stack) logger.erro(err.stack);
});
process.on('unhandledRejection', (razao) => {
  logger.erro(`Promessa rejeitada sem tratamento: ${razao?.message || razao}`);
});

// --assistente: abre SÓ o assistente de configuração no navegador e sai
// (v2.6 — atalho do menu Iniciar / iniciar.bat --assistente)
if (process.argv.includes('--assistente')) {
  rodarAssistente().catch((err) => {
    logger.erro(`[Assistente] ${err?.message || err}`);
    process.exit(1);
  });
} else {
  main();
}

async function rodarAssistente() {
  const subiu = await assistente.rodarStandalone();
  if (!subiu) process.exit(1);
  // o Ctrl+C já é tratado pelo encerrar() padrão (que para o assistente);
  // o processo fica vivo até o usuário encerrar pelo navegador.
}
