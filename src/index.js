/**
 * Pokemon Chat Plays
 * Ponto de entrada principal.
 *
 * Conecta o(s) cliente(s) (Twitch e/ou YouTube) e gerencia o ciclo de vida
 * do bot. No encerramento (Ctrl+C), garante que TODAS as teclas presas
 * por comandos de hold sejam soltas antes de morrer.
 *
 * Uso:
 *   npm start
 *   node src/index.js
 */

const logger = require('./utils/logger');
const { config, validarConfig } = require('./config');
const twitch = require('./controllers/twitch');
const youtube = require('./controllers/youtube');
const stats = require('./utils/stats');
const teclado = require('./controllers/keyboard');
const { verificarSistema, soltarTodasSync } = teclado;

// Trata Ctrl+C e encerramento limpo
let encerrando = false;

async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  logger.aviso(`Sinal recebido (${sinal}). Encerrando...`);
  try {
    // Primeiro solta as teclas (um jogo com tecla presa é péssimo)
    soltarTodasSync();
    await twitch.parar();
    await youtube.parar();
    stats.logResumo();
  } catch (err) {
    logger.erro(`Erro no encerramento: ${err.message}`);
  }
  process.exit(0);
}

/**
 * Função principal.
 */
async function main() {
  logger.info('╔══════════════════════════════════════════╗');
  logger.info('║   🎮  POKÉMON CHAT PLAYS  v2.2.0        ║');
  logger.info('║   SindromeGames Edition                  ║');
  logger.info('╚══════════════════════════════════════════╝');
  logger.info(`Plataformas ativas: ${config.geral.plataformasAtivas.join(', ') || 'nenhuma'}`);

  if (!validarConfig()) {
    process.exit(1);
  }

  // Verifica dependências de sistema (PowerShell/xdotool/osascript)
  const sistemaOk = await verificarSistema();
  if (!sistemaOk) {
    logger.aviso('[Main] Continuando mesmo assim - o teclado pode não funcionar.');
  }

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
