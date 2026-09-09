/**
 * Carregador de configuração
 * Lê variáveis de ambiente via dotenv e valida os parâmetros obrigatórios.
 */

const path = require('path');
const fs = require('fs');

/**
 * Encontra o caminho do arquivo .env.
 * Procura em:
 *  1. Diretorio atual (cwd)
 *  2. Diretorio do executavel (process.execPath, para o .exe empacotado)
 *  3. Diretorio do __dirname (para node src/index.js)
 * @returns {string|null}
 */
function encontrarEnv() {
  const candidatos = [
    path.join(process.cwd(), '.env'),
    path.join(path.dirname(process.execPath), '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const c of candidatos) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      // ignora erros de permissão
    }
  }
  return null;
}

const envEncontrado = encontrarEnv();

// Carrega o arquivo .env se existir
try {
  const dotenv = require('dotenv');
  if (envEncontrado) {
    dotenv.config({ path: envEncontrado });
  } else {
    dotenv.config(); // fallback: procura no cwd
  }
} catch (err) {
  // dotenv é opcional caso as variáveis já estejam no ambiente
  if (err.code !== 'MODULE_NOT_FOUND') {
    console.warn('[AVISO] Falha ao carregar dotenv:', err.message);
  }
}

/**
 * Lê uma variável de ambiente com valor padrão.
 * @param {string} key - Nome da variável
 * @param {string} [defaultValue=''] - Valor padrão
 * @returns {string}
 */
function getEnv(key, defaultValue = '') {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.trim();
}

/**
 * Lê uma variável de ambiente como booleano.
 * Aceita: true, 1, yes, sim, on (case-insensitive)
 */
function getEnvBool(key, defaultValue = false) {
  const value = getEnv(key, '').toLowerCase();
  if (!value) return defaultValue;
  return ['true', '1', 'yes', 'sim', 'on'].includes(value);
}

/**
 * Lê uma variável de ambiente como número inteiro.
 */
function getEnvInt(key, defaultValue) {
  const value = getEnv(key, '');
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

// Verifica se o arquivo .env existe; se não, avisa o usuário
if (!envEncontrado) {
  console.warn('[AVISO] Arquivo .env nao encontrado.');
  console.warn('[AVISO] Copie o arquivo .env.example para .env e preencha suas credenciais.');
  console.warn('[AVISO] Procurei em:');
  console.warn('[AVISO]   - ' + path.join(process.cwd(), '.env'));
  console.warn('[AVISO]   - ' + path.join(path.dirname(process.execPath), '.env'));
  console.warn('[AVISO]   - ' + path.join(__dirname, '..', '.env'));
}

const config = {
  twitch: {
    username: getEnv('TWITCH_BOT_USERNAME'),
    oauthToken: getEnv('TWITCH_OAUTH_TOKEN'),
    channel: getEnv('TWITCH_CHANNEL', 'sindromegames'),
  },
  youtube: {
    enabled: getEnvBool('YOUTUBE_ENABLED', false),
    apiKey: getEnv('YOUTUBE_API_KEY'),
    videoId: getEnv('YOUTUBE_VIDEO_ID'),
  },
  geral: {
    plataformasAtivas: getEnv('ACTIVE_PLATFORMS', 'twitch')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
    cooldownMs: getEnvInt('COMMAND_COOLDOWN_MS', 1500),
    tempoPressionarTeclaMs: getEnvInt('KEY_PRESS_DURATION_MS', 230),
    intervaloAnuncioMin: getEnvInt('ANNOUNCE_INTERVAL_MIN', 10),
    statsAtivadas: getEnvBool('ENABLE_STATS', true),
    debug: getEnvBool('DEBUG', false),
    prefixoAdmin: getEnv('ADMIN_PREFIX', '!'),
    // --- Novidades v2.2: segurar teclas (hold) ---
    holdPadraoMs: getEnvInt('HOLD_DEFAULT_MS', 1000),
    holdMaxMs: getEnvInt('HOLD_MAX_MS', 10000),
    confirmarComandos: getEnvBool('CONFIRM_COMMANDS', true),
  },
};

/**
 * Valida a configuração de cada plataforma ativa e exibe erros claros.
 * @returns {boolean} true se a configuração estiver OK
 */
function validarConfig() {
  const erros = [];
  const plataformas = config.geral.plataformasAtivas;

  if (plataformas.includes('twitch')) {
    if (!config.twitch.username) erros.push('• TWITCH_BOT_USERNAME não definido');
    if (!config.twitch.oauthToken) erros.push('• TWITCH_OAUTH_TOKEN não definido');
    if (!config.twitch.channel) erros.push('• TWITCH_CHANNEL não definido');
  }

  if (plataformas.includes('youtube')) {
    if (!config.youtube.apiKey) erros.push('• YOUTUBE_API_KEY não definido');
    if (!config.youtube.videoId) erros.push('• YOUTUBE_VIDEO_ID não definido');
  }

  if (erros.length > 0) {
    console.error('\n========================================');
    console.error('ERRO DE CONFIGURAÇÃO:');
    console.error('========================================');
    erros.forEach((e) => console.error(e));
    console.error('\nVerifique seu arquivo .env e tente novamente.\n');
    return false;
  }
  return true;
}

module.exports = {
  config,
  validarConfig,
};
