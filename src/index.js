/**
 * Pokemon Chat Plays
 * Ponto de entrada principal.
 *
 * Conecta o(s) cliente(s) (Twitch e/ou YouTube) e gerencia o ciclo de vida do bot.
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

// Trata Ctrl+C e encerramento limpo
let encerrando = false;

async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  logger.aviso(`Sinal recebido (${sinal}). Encerrando...`);
  try {
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
  logger.info('==========================================');
  logger.info(' Pokemon Chat Plays');
  logger.info(' Versao 2.0.0 - SindromeGames Edition');
  logger.info('==========================================');
  logger.info(`Plataformas ativas: ${config.geral.plataformasAtivas.join(', ') || 'nenhuma'}`);

  if (!validarConfig()) {
    process.exit(1);
  }

  const plataformas = config.geral.plataformasAtivas;
  const promessas = [];

  if (plataformas.includes('twitch')) {
    promessas.push(
      twitch.iniciar().then((ok) => {
        if (!ok) logger.erro('[Main] Nao foi possivel iniciar o cliente Twitch.');
      })
    );
  }

  if (plataformas.includes('youtube')) {
    promessas.push(
      youtube.iniciar().then((ok) => {
        if (!ok) logger.erro('[Main] Nao foi possivel iniciar o cliente YouTube.');
      })
    );
  }

  if (promessas.length === 0) {
    logger.erro('[Main] Nenhuma plataforma ativa. Configure ACTIVE_PLATFORMS no .env.');
    process.exit(1);
  }

  await Promise.allSettled(promessas);

  logger.info('Bot em execucao. Pressione Ctrl+C para parar.');
}

// Handlers de sinais
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.erro(`Excecao nao capturada: ${err.message}`);
  if (err.stack) logger.erro(err.stack);
});
process.on('unhandledRejection', (razao) => {
  logger.erro(`Promessa rejeitada sem tratamento: ${razao?.message || razao}`);
});

main();
