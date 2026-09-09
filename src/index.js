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
const { montarMapeamento } = require('./presets');
const { msgChatPausado, msgChatLiberado } = require('./messages');
const { verificarSistema, soltarTodasSync } = teclado;

// Silencia avisos experimentais (ex.: "Fetch API is an experimental feature"
// no Node 18 do .exe) para não poluir o terminal durante a live.
process.on('warning', (aviso) => {
  if (aviso && String(aviso.name).includes('ExperimentalWarning')) return;
  console.error(aviso && aviso.stack ? aviso.stack : aviso);
});

// Versão lida do package.json (mantém o banner sempre em dia)
const { version: VERSAO } = require('../package.json');

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
    // Depois salva o histórico de stats na hora (autosave é de 30s)
    stats.salvar();
    pausa.pararWatcher();
    if (interfaceTerminal) interfaceTerminal.close();
    await overlay.parar();
    await twitch.parar();
    await youtube.parar();
    stats.logResumo();
  } catch (err) {
    logger.erro(`Erro no encerramento: ${err.message}`);
  }
  process.exit(0);
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
      logger.erro(`[Teclado] TECLA para "${botao}" inválida: "${tecla}" — valores aceitos: setas, enter, backspace, space, tab, esc, shift, a-z, 0-9`);
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
  });
  await overlay.iniciar(config.overlay.porta);
}

/**
 * Configura o botão de pânico (F9) do streamer:
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

  pausa.iniciarWatcherF9();

  // Alternativa universal: ENTER vazio (ou "p"/"pausa") no terminal alterna
  interfaceTerminal = readline.createInterface({ input: process.stdin, terminal: false });
  interfaceTerminal.on('line', (linha) => {
    const texto = String(linha || '').trim().toLowerCase();
    if (texto === '' || texto === 'p' || texto === 'pausa' || texto === 'f9') {
      pausa.alternar('terminal');
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
    process.exit(1);
  }

  // Teclas customizáveis (v2.3) — antes de qualquer coisa tocar no teclado
  aplicarMapeamentoTeclas();

  // Histórico de estatísticas (v2.3)
  configurarStatsPersistentes();

  // Verifica dependências de sistema (PowerShell/xdotool/osascript)
  const sistemaOk = await verificarSistema();
  if (!sistemaOk) {
    logger.aviso('[Main] Continuando mesmo assim - o teclado pode não funcionar.');
  }

  // Overlay do OBS (v2.3)
  await iniciarOverlay();

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
  logger.info('Streamer: F9 pausa/libera o chat · ENTER no terminal também funciona.');
  logger.info(`Comandos de hold ativos: hold <direção/botão> [tempo] · "soltar" libera tudo.`);
}

// Handlers de sinais
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.erro(`Exceção não capturada: ${err.message}`);
  if (err.stack) logger.erro(err.stack);
});
process.on('unhandledRejection', (razao) => {
  logger.erro(`Promessa rejeitada sem tratamento: ${razao?.message || razao}`);
});

main();
