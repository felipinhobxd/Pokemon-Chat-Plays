/**
 * Assistente de configuração (v2.6) — wizard com interface no navegador.
 *
 * Por quê: editar .env no Bloco de Notas assusta quem não é dev. Este
 * assistente sobe um servidor local (só acessível em 127.0.0.1) e abre
 * uma página bonita onde o streamer:
 *   - liga/desliga Twitch e YouTube com um toggle;
 *   - cola usuário/token/canal (ou a URL da live — o ID é extraído sozinho);
 *   - TESTA a conexão de cada plataforma antes de salvar;
 *   - salva o .env pronto e o bot continua o boot sozinho.
 *
 * Dois modos:
 *   - 'primeiro-uso': o index.js chama aguardarConfiguracao() quando a
 *     config é inválida — o bot fica esperando o wizard salvar.
 *   - 'standalone': `npm run assistente` (ou node src/assistente.js)
 *     abre o wizard fora do boot, para reconfigurar quando quiser.
 *
 * Segurança: escuta apenas 127.0.0.1, segredos NUNCA voltam ao navegador
 * (apenas mascarados) e a página não usa recursos externos.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./utils/logger');
const {
  config,
  recarregar,
  errosConfig,
  caminhoEnv,
  normalizarVideoIdYoutube,
} = require('./config');
const { interpretarErroApi } = require('./controllers/youtube');
const { PAGINA } = require('./assistente-pagina');

const PORTA_PADRAO = 8124;
const LIMITE_BODY_BYTES = 64 * 1024;
const { version: VERSAO } = require('../package.json');

let servidor = null;
let portaReal = null;
let modo = 'standalone'; // 'standalone' | 'primeiro-uso'
let aoFinalizar = null; // (primeiro-uso) resolve(true) ao salvar com sucesso
let aoDesistir = null; // (primeiro-uso) resolve(false) ao sair sem salvar

// ---------------------------------------------------------------------------
// Helpers puros (testáveis sem servidor)
// ---------------------------------------------------------------------------

/**
 * Mascarar um segredo para exibição no navegador.
 * "oauth:abcdefghijk" -> "oauth:abcd••••hijk" (curtos viram só bolinhas).
 * @param {string} valor
 * @returns {string}
 */
function mascararSegredo(valor) {
  const bruto = String(valor || '').trim();
  if (!bruto) return '';
  const prefixo = bruto.toLowerCase().startsWith('oauth:') ? 'oauth:' : '';
  const limpo = prefixo ? bruto.slice(6) : bruto;
  if (limpo.length <= 8) return prefixo + '•'.repeat(Math.max(4, limpo.length));
  return `${prefixo}${limpo.slice(0, 4)}••••${limpo.slice(-4)}`;
}

/** Valores padrão das chaves não obrigatórias do .env gerado. */
const PADROES = {
  COMMAND_COOLDOWN_MS: '1500',
  KEY_PRESS_DURATION_MS: '230',
  ANNOUNCE_INTERVAL_MIN: '10',
  ENABLE_STATS: 'true',
  DEBUG: 'false',
  ADMIN_PREFIX: '!',
  HOLD_DEFAULT_MS: '1000',
  HOLD_MAX_MS: '10000',
  CONFIRM_COMMANDS: 'true',
  EMULADOR_PRESET: 'vbam',
  MODO_TECLADO: 'janela',
  JOGO_AUTO_REINICIAR: 'true',
  JOGO_REINICIAR_DELAY_MS: '3000',
  JOGO_TENTATIVAS_MAX: '5',
  JOGO_VIDA_MINIMA_MS: '15000',
  TECLA_PAUSA: 'f9',
  MODO_INICIAL: 'anarquia',
  VOTACAO_INTERVALO_MS: '10000',
  VOTACAO_TROCA_MIN_MS: '30000',
  TECLA_MODO: 'f8',
  STATS_PERSISTENTES: 'true',
  STATS_ARQUIVO: 'dados/stats.json',
  OVERLAY_ATIVA: 'true',
  OVERLAY_PORTA: '8899',
  VERIFICAR_ATUALIZACAO: 'true',
};

/**
 * Monta o conteúdo COMPLETO do .env a partir dos valores do wizard.
 * Toda chave conhecida entra (com comentários curtos em PT); chaves
 * desconhecidas do .env atual são preservadas no fim (custom do usuário).
 * @param {Record<string,string>} v - valores finais (segredos já resolvidos)
 * @param {string} [envAtual=''] - conteúdo do .env atual (preserva o que não conhecemos)
 * @returns {string}
 */
function montarConteudoEnv(v, envAtual = '') {
  const val = (chave) => {
    const digitado = String(v[chave] ?? '').trim();
    return digitado !== '' ? digitado : PADROES[chave] || '';
  };

  const linhas = [
    '# ============================================================',
    '# Pokemon Chat Plays — .env gerado pelo assistente de configuração',
    `# Gerado em ${new Date().toLocaleString('pt-BR')}`,
    '# ============================================================',
    '# Dica: rode "npm run assistente" para reabrir a interface gráfica.',
    '',
    '# ----- TWITCH -----',
    '# Conta do bot + token OAuth (gere em https://twitchtokengenerator.com,',
    '# logado com a conta DO BOT, botão "Bot Chat Token")',
    `TWITCH_BOT_USERNAME=${val('TWITCH_BOT_USERNAME')}`,
    `TWITCH_OAUTH_TOKEN=${val('TWITCH_OAUTH_TOKEN')}`,
    '# Canal monitorado (sem o #)',
    `TWITCH_CHANNEL=${val('TWITCH_CHANNEL')}`,
    '',
    '# ----- YOUTUBE -----',
    `YOUTUBE_ENABLED=${val('YOUTUBE_ENABLED') || 'false'}`,
    '# Chave de API: https://console.cloud.google.com/ (ative a YouTube Data API v3)',
    `YOUTUBE_API_KEY=${val('YOUTUBE_API_KEY')}`,
    '# ID da live OU a URL completa (o bot extrai o ID sozinho)',
    `YOUTUBE_VIDEO_ID=${val('YOUTUBE_VIDEO_ID')}`,
    '',
    '# ----- GERAL -----',
    '# Plataformas ativas, separadas por vírgula',
    `ACTIVE_PLATFORMS=${val('ACTIVE_PLATFORMS') || 'twitch'}`,
    '# Cooldown por usuário entre comandos (ms)',
    `COMMAND_COOLDOWN_MS=${val('COMMAND_COOLDOWN_MS')}`,
    '# Tempo que cada tecla fica pressionada (ms)',
    `KEY_PRESS_DURATION_MS=${val('KEY_PRESS_DURATION_MS')}`,
    '# Anúncio automático dos comandos a cada N minutos (0 = desligado)',
    `ANNOUNCE_INTERVAL_MIN=${val('ANNOUNCE_INTERVAL_MIN')}`,
    `ENABLE_STATS=${val('ENABLE_STATS')}`,
    `DEBUG=${val('DEBUG')}`,
    `ADMIN_PREFIX=${val('ADMIN_PREFIX')}`,
    '',
    '# ----- SEGURAR TECLAS (hold) -----',
    `HOLD_DEFAULT_MS=${val('HOLD_DEFAULT_MS')}`,
    `HOLD_MAX_MS=${val('HOLD_MAX_MS')}`,
    `CONFIRM_COMMANDS=${val('CONFIRM_COMMANDS')}`,
    '',
    '# ----- EMULADOR / JOGO (v2.7) -----',
    '# Presets: vbam, mgba, desmume, retroarch',
    `EMULADOR_PRESET=${val('EMULADOR_PRESET')}`,
    '# Caminho completo do .exe do jogo/emulador (qualquer programa serve:',
    '# VBA-M, mGBA, RetroArch, Minecraft...). Vazio = o bot pergunta no terminal.',
    `EMULADOR_EXE=${val('EMULADOR_EXE')}`,
    '# ROM aberta junto com o emulador (vazio para jogos sem ROM)',
    `JOGO_ROM=${val('JOGO_ROM')}`,
    '# Reabrir o jogo sozinho se ele fechar/cair no meio da live',
    `JOGO_AUTO_REINICIAR=${val('JOGO_AUTO_REINICIAR') || 'true'}`,
    '# Espera antes de reabrir (ms) e limites anti crash-loop',
    `JOGO_REINICIAR_DELAY_MS=${val('JOGO_REINICIAR_DELAY_MS')}`,
    `JOGO_TENTATIVAS_MAX=${val('JOGO_TENTATIVAS_MAX')}`,
    `JOGO_VIDA_MINIMA_MS=${val('JOGO_VIDA_MINIMA_MS')}`,
    '# Argumentos extras ao abrir (ex.: retroarch: -L core.dll)',
    `JOGO_ARGS=${val('JOGO_ARGS')}`,
    '# janela = teclas só no emulador | global = janela em foco',
    `MODO_TECLADO=${val('MODO_TECLADO')}`,
    '# Tecla do streamer que pausa/libera o chat',
    `TECLA_PAUSA=${val('TECLA_PAUSA')}`,
    '',
    '# ----- VOTAÇÃO (democracia/anarquia) -----',
    '# anarquia = tudo executa na hora | democracia = o mais votado executa',
    `MODO_INICIAL=${val('MODO_INICIAL')}`,
    `VOTACAO_INTERVALO_MS=${val('VOTACAO_INTERVALO_MS')}`,
    `VOTACAO_TROCA_MIN_MS=${val('VOTACAO_TROCA_MIN_MS')}`,
    "# Tecla do streamer que alterna o modo ('off' desativa)",
    `TECLA_MODO=${val('TECLA_MODO')}`,
    '',
    '# ----- STATS / OVERLAY / ATUALIZAÇÃO -----',
    `STATS_PERSISTENTES=${val('STATS_PERSISTENTES')}`,
    `STATS_ARQUIVO=${val('STATS_ARQUIVO')}`,
    `OVERLAY_ATIVA=${val('OVERLAY_ATIVA')}`,
    `OVERLAY_PORTA=${val('OVERLAY_PORTA')}`,
    `VERIFICAR_ATUALIZACAO=${val('VERIFICAR_ATUALIZACAO')}`,
    '',
  ];

  // Preserva customizações avançadas do usuário (chaves que não geramos)
  const conhecidas = new Set([
    ...Object.keys(PADROES),
    'TWITCH_BOT_USERNAME', 'TWITCH_OAUTH_TOKEN', 'TWITCH_CHANNEL',
    'YOUTUBE_ENABLED', 'YOUTUBE_API_KEY', 'YOUTUBE_VIDEO_ID',
    'ACTIVE_PLATFORMS', 'EMULADOR_EXE', 'JOGO_ROM', 'JOGO_ARGS',
  ]);
  const custom = [];
  for (const linha of String(envAtual || '').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !conhecidas.has(m[1])) custom.push(linha);
  }
  if (custom.length) {
    linhas.push('# ----- Suas chaves customizadas (preservadas) -----', ...custom, '');
  }

  return linhas.join('\n');
}

/** Lê o .env atual (se existir) para preservar chaves customizadas. */
function lerEnvAtual() {
  try {
    return fs.readFileSync(caminhoEnv(), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Verifica os caminhos do jogo preenchidos no wizard (PURO — testável com
 * arquivos temporários). Não executa nada, só checa existência/tamanho.
 * @param {object} p - { exe, rom }
 * @returns {{ok: boolean, exe: object|null, rom: object|null, mensagem: string}}
 */
function verificarCaminhosJogo({ exe, rom } = {}) {
  const { normalizarCaminhoJogo, nomeDoProcesso } = require('./utils/jogo');
  const exeLimpo = normalizarCaminhoJogo(exe);
  const romLimpa = normalizarCaminhoJogo(rom);

  if (!exeLimpo && !romLimpa) {
    return {
      ok: true,
      exe: null,
      rom: null,
      mensagem: 'Sem jogo configurado — o bot não vai abrir nem monitorar nenhum programa (também funciona assim).',
    };
  }

  const info = (caminho) => {
    try {
      const st = fs.statSync(caminho);
      return { ok: st.isFile(), tamanho: st.size };
    } catch {
      return { ok: false, tamanho: 0 };
    }
  };

  const exeInfo = exeLimpo ? { caminho: exeLimpo, ...info(exeLimpo) } : null;
  const romInfo = romLimpa ? { caminho: romLimpa, ...info(romLimpa) } : null;

  const problemas = [];
  const avisos = [];
  if (exeInfo && !exeInfo.ok) problemas.push(`não achei o executável "${exeLimpo}"`);
  if (romInfo && !romInfo.ok) problemas.push(`não achei a ROM "${romLimpa}"`);
  if (exeInfo && exeInfo.ok && !/\.(exe|bat|cmd|lnk|app|sh|jar)$/i.test(exeLimpo)) {
    // aviso, não erro — pode ser um executável sem extensão conhecida
    avisos.push(`"${nomeDoProcesso(exeLimpo)}" não tem extensão de programa — confira se é mesmo o executável`);
  }

  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const partes = [];
  if (exeInfo?.ok) partes.push(`executável "${nomeDoProcesso(exeLimpo)}" encontrado (${kb(exeInfo.tamanho)})`);
  if (romInfo?.ok) partes.push(`ROM "${nomeDoProcesso(romLimpa)}" encontrada (${kb(romInfo.tamanho)})`);

  const criticos = [];
  if (exeInfo && !exeInfo.ok) criticos.push('exe');
  if (romInfo && !romInfo.ok) criticos.push('rom');

  let mensagem;
  if (criticos.length > 0) {
    mensagem = `✖ ${problemas.join(' · ')}`;
  } else {
    mensagem = `✔ ${partes.join(' · ')}`;
    if (avisos.length) mensagem += ` — atenção: ${avisos.join(' · ')}`;
  }

  return {
    ok: criticos.length === 0,
    exe: exeInfo,
    rom: romInfo,
    mensagem,
  };
}

/** Valores atuais (SEM segredos em claro) para pré-preencher o wizard. */
function estadoAtual() {
  const plataformas = config.geral.plataformasAtivas;
  return {
    versao: VERSAO,
    modo,
    configurado: errosConfig().length === 0,
    twitchAtivo: plataformas.includes('twitch'),
    youtubeAtivo: plataformas.includes('youtube'),
    valores: {
      TWITCH_BOT_USERNAME: config.twitch.username,
      TWITCH_CHANNEL: config.twitch.channel,
      YOUTUBE_VIDEO_ID: config.youtube.videoId,
      COMMAND_COOLDOWN_MS: String(config.geral.cooldownMs),
      KEY_PRESS_DURATION_MS: String(config.geral.tempoPressionarTeclaMs),
      EMULADOR_PRESET: config.teclado.preset,
      MODO_TECLADO: config.teclado.modo,
      // v2.7: jogo genérico (path do .exe + ROM + reabrir sozinho)
      EMULADOR_EXE: config.teclado.emuladorExe,
      JOGO_ROM: config.jogo.rom,
      JOGO_AUTO_REINICIAR: String(config.jogo.autoReiniciar),
      TECLA_PAUSA: config.pausa.tecla,
      MODO_INICIAL: config.votacao.modoInicial,
      OVERLAY_PORTA: String(config.overlay.porta),
      OVERLAY_ATIVA: String(config.overlay.ativa),
    },
    mascaras: {
      TWITCH_OAUTH_TOKEN: mascararSegredo(config.twitch.oauthToken),
      YOUTUBE_API_KEY: mascararSegredo(config.youtube.apiKey),
    },
  };
}

// ---------------------------------------------------------------------------
// Testes de conexão (usados pelos botões do wizard)
// ---------------------------------------------------------------------------

/**
 * Testa credenciais Twitch com um cliente tmi.js descartável.
 * @returns {Promise<{ok: boolean, mensagem: string}>}
 */
function testarTwitch({ username, oauth, channel }) {
  return new Promise((resolve) => {
    const tmi = require('tmi.js');
    const usuario = String(username || '').trim();
    const canal = String(channel || '').trim().replace(/^#/, '');
    let token = String(oauth || '').trim();
    if (token && !token.toLowerCase().startsWith('oauth:')) token = 'oauth:' + token;

    if (!usuario || !token || !canal) {
      resolve({ ok: false, mensagem: 'Preencha usuário, token e canal antes de testar.' });
      return;
    }

    let cliente = null;
    let resolvido = false;
    const concluir = (ok, mensagem) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      try { cliente?.disconnect?.().catch(() => {}); } catch { /* ignora */ }
      resolve({ ok, mensagem });
    };
    const timer = setTimeout(() => {
      concluir(false, 'A Twitch não respondeu em 12s. Verifique sua internet e tente de novo.');
    }, 12000);

    try {
      cliente = new tmi.Client({
        connection: { secure: true, reconnect: false, timeout: 8000 },
        identity: { username: usuario, password: token },
        channels: [canal],
      });
      cliente.on('connected', () => {
        concluir(true, `Conectado como "${usuario}" no canal #${canal}! Pode salvar.`);
      });
      cliente.on('disconnected', (motivo) => {
        const m = String(motivo || '');
        if (/login authentication failed|improper|invalid/i.test(m)) {
          concluir(false, 'A Twitch recusou o login: usuário ou token errados. Gere o token em twitchtokengenerator.com LOGADO COM A CONTA DO BOT.');
        } else {
          concluir(false, `Desconectado pela Twitch: ${m || 'sem motivo informado'}`);
        }
      });
      cliente.on('error', (err) => {
        concluir(false, `Erro de conexão: ${err?.message || err}`);
      });
      cliente.connect().catch((err) => {
        concluir(false, `Não foi possível conectar: ${err?.message || err}`);
      });
    } catch (err) {
      concluir(false, `Erro ao montar o cliente: ${err?.message || err}`);
    }
  });
}

/**
 * Testa a chave de API + vídeo/live do YouTube (videos.list).
 * @returns {Promise<{ok: boolean, mensagem: string, aguardando?: boolean}>}
 */
async function testarYoutube({ apiKey, videoId }) {
  const { google } = require('googleapis');
  const chave = String(apiKey || '').trim();
  const id = normalizarVideoIdYoutube(String(videoId || ''));

  if (!chave) return { ok: false, mensagem: 'Preencha a YOUTUBE_API_KEY antes de testar.' };
  if (!id) return { ok: false, mensagem: 'Preencha o ID (ou a URL) da live antes de testar.' };

  try {
    const yt = google.youtube({ version: 'v3', auth: chave });
    const resp = await yt.videos.list({ part: 'liveStreamingDetails,snippet', id });
    if (!resp.data.items || resp.data.items.length === 0) {
      return { ok: false, mensagem: `Vídeo "${id}" não encontrado — confira o ID ou a URL da live.` };
    }
    const v = resp.data.items[0];
    const titulo = v.snippet?.title || '(sem título)';
    const canal = v.snippet?.channelTitle || '';
    const detalhes = v.liveStreamingDetails || {};

    if (detalhes.actualEndTime) {
      return { ok: false, mensagem: `A live "${titulo}" já foi encerrada. Cada live nova tem um ID novo — cole o da live atual.` };
    }
    if (!detalhes.activeLiveChatId) {
      const agendada = Boolean(detalhes.scheduledStartTime);
      return {
        ok: false,
        aguardando: true,
        mensagem: agendada
          ? `A live "${titulo}" está agendada e ainda não começou. O bot fica tentando sozinho a cada 60s — tudo bem salvar assim.`
          : `Encontrei o vídeo "${titulo}"${canal ? ` (${canal})` : ''}, mas não há chat ao vivo ativo — não parece uma live em andamento.`,
      };
    }
    return {
      ok: true,
      mensagem: `Conectado ao chat da live "${titulo}"${canal ? ` no canal ${canal}` : ''}! Pode salvar.`,
    };
  } catch (err) {
    return { ok: false, mensagem: interpretarErroApi(err).mensagem };
  }
}

// ---------------------------------------------------------------------------
// Servidor HTTP (só 127.0.0.1)
// ---------------------------------------------------------------------------

/** Lê o corpo JSON com limite de tamanho. */
function lerBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > LIMITE_BODY_BYTES) {
        reject(new Error('corpo da requisição grande demais'));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/** Resposta JSON padronizada. */
function responderJson(res, codigo, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

/** Grava o .env com os valores do wizard e recarrega a config. */
function salvarConfiguracao(v) {
  const finais = { ...v };

  // v2.7: caminhos do jogo — tira aspas coladas e quebras de linha (a
  // colagem do Windows e do chat às vezes traz sujeira)
  const { normalizarCaminhoJogo, dividirArgs } = require('./utils/jogo');
  for (const chave of ['EMULADOR_EXE', 'JOGO_ROM']) {
    finais[chave] = normalizarCaminhoJogo(finais[chave]);
  }
  finais.JOGO_ARGS = dividirArgs(finais.JOGO_ARGS).join(' ');
  finais.JOGO_AUTO_REINICIAR = finais.jogoAutoReiniciar === false ? 'false' : 'true';

  // Segredo vazio = manter o atual (o navegador nunca recebe o valor real)
  if (!String(finais.TWITCH_OAUTH_TOKEN || '').trim()) {
    finais.TWITCH_OAUTH_TOKEN = config.twitch.oauthToken;
  } else if (!String(finais.TWITCH_OAUTH_TOKEN).toLowerCase().startsWith('oauth:')) {
    finais.TWITCH_OAUTH_TOKEN = 'oauth:' + String(finais.TWITCH_OAUTH_TOKEN).trim();
  }
  if (!String(finais.YOUTUBE_API_KEY || '').trim()) {
    finais.YOUTUBE_API_KEY = config.youtube.apiKey;
  }

  // Plataformas ativas vêm dos toggles
  const plataformas = [];
  if (finais.twitchAtivo) plataformas.push('twitch');
  if (finais.youtubeAtivo) plataformas.push('youtube');
  finais.ACTIVE_PLATFORMS = plataformas.join(',');
  finais.YOUTUBE_ENABLED = plataformas.includes('youtube') ? 'true' : 'false';
  finais.YOUTUBE_VIDEO_ID = normalizarVideoIdYoutube(finais.YOUTUBE_VIDEO_ID);

  try {
    fs.writeFileSync(caminhoEnv(), montarConteudoEnv(finais, lerEnvAtual()), 'utf8');
  } catch (err) {
    return { ok: false, erros: [`Não consegui gravar o .env (${err.message}). Verifique permissões na pasta do app.`] };
  }

  recarregar();
  const erros = errosConfig();
  const { nomeDoProcesso } = require('./utils/jogo');
  return {
    ok: erros.length === 0,
    erros,
    arquivo: caminhoEnv(),
    overlay: config.overlay.ativa ? `http://localhost:${config.overlay.porta}` : null,
    // v2.7: info do jogo p/ a tela de sucesso ("o bot abre sozinho...")
    jogo: finais.EMULADOR_EXE
      ? {
          exe: finais.EMULADOR_EXE,
          nome: nomeDoProcesso(finais.EMULADOR_EXE),
          rom: finais.JOGO_ROM ? nomeDoProcesso(finais.JOGO_ROM) : '',
          autoReiniciar: finais.JOGO_AUTO_REINICIAR !== 'false',
        }
      : null,
  };
}

/**
 * Blindagem anti-CSRF (v2.6): requisições cross-origin de OUTROS sites
 * (um site malicioso aberto no navegador do streamer não pode reescrever
 * o .env via fetch pra localhost). O navegador SEMPRE manda Origin em POST
 * cross-site; ferramentas locais (curl/node) não mandam e passam.
 */
function origemPermitida(req) {
  const origem = req.headers.origin;
  if (!origem) return true; // curl / node / mesmo servidor
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/$|$)/i.test(origem);
}

/**
 * Abre o jogo na hora (botão "abrir agora" do wizard) — lançamento
 * best-effort, sem vigilância: serve para o usuário VER o jogo abrir.
 * @param {object} p - { exe, rom, args }
 * @returns {{ok: boolean, mensagem: string}}
 */
function abrirJogoAgora({ exe, rom, args } = {}) {
  const jogo = require('./utils/jogo');
  const { file, args: lista, cwd } = jogo.montarLinhaComando({ exe, rom, args });
  if (!file) return { ok: false, mensagem: 'Preencha o caminho do executável antes de abrir.' };

  const checado = verificarCaminhosJogo({ exe: file, rom });
  if (checado.exe && !checado.exe.ok) {
    return { ok: false, mensagem: checado.mensagem };
  }

  try {
    const filho = spawn(file, lista, {
      cwd: cwd || undefined,
      stdio: 'ignore',
      detached: true, // sobrevive ao assistente fechar
    });
    // ENOENT tardio (arquivo sumido entre o check e o spawn) não pode
    // virar uncaughtException — engole e deixa o usuário tentar de novo
    filho.on('error', () => {});
    filho.unref();
    return {
      ok: true,
      mensagem: `Abri "${jogo.nomeDoProcesso(file)}"${rom ? ` com ${jogo.nomeDoProcesso(rom)}` : ''} — olha aí na tela! 🎮`,
    };
  } catch (err) {
    return { ok: false, mensagem: `Não consegui abrir (${err.message}).` };
  }
}

/** Roteamento do assistente. */
async function tratarRequisicao(req, res) {
  const url = (req.url || '/').split('?')[0];

  try {
    if (req.method === 'POST' && !origemPermitida(req)) {
      responderJson(res, 403, { ok: false, mensagem: 'origem não permitida' });
      return;
    }
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(PAGINA);
      return;
    }

    if (req.method === 'GET' && url === '/api/estado') {
      responderJson(res, 200, estadoAtual());
      return;
    }

    if (req.method === 'POST' && url === '/api/testar-twitch') {
      const body = await lerBody(req);
      const resultado = await testarTwitch({
        username: body.TWITCH_BOT_USERNAME || config.twitch.username,
        oauth: body.TWITCH_OAUTH_TOKEN || config.twitch.oauthToken,
        channel: body.TWITCH_CHANNEL || config.twitch.channel,
      });
      responderJson(res, 200, resultado);
      return;
    }

    if (req.method === 'POST' && url === '/api/testar-youtube') {
      const body = await lerBody(req);
      const resultado = await testarYoutube({
        apiKey: body.YOUTUBE_API_KEY || config.youtube.apiKey,
        videoId: body.YOUTUBE_VIDEO_ID || config.youtube.videoId,
      });
      responderJson(res, 200, resultado);
      return;
    }

    // v2.7: confere se os caminhos do jogo existem neste PC
    if (req.method === 'POST' && url === '/api/verificar-jogo') {
      const body = await lerBody(req);
      const resultado = verificarCaminhosJogo({
        exe: body.EMULADOR_EXE ?? config.teclado.emuladorExe,
        rom: body.JOGO_ROM ?? config.jogo.rom,
      });
      responderJson(res, 200, resultado);
      return;
    }

    // v2.7: abre o jogo AGORA (exe + ROM) — teste prático do lançamento
    if (req.method === 'POST' && url === '/api/abrir-jogo') {
      const body = await lerBody(req);
      const resultado = abrirJogoAgora({
        exe: body.EMULADOR_EXE ?? config.teclado.emuladorExe,
        rom: body.JOGO_ROM ?? config.jogo.rom,
        args: body.JOGO_ARGS ?? config.jogo.args,
      });
      responderJson(res, 200, resultado);
      return;
    }

    if (req.method === 'POST' && url === '/api/salvar') {
      const body = await lerBody(req);
      const resultado = salvarConfiguracao(body);

      if (resultado.ok) {
        logger.info(`[Assistente] ✅ Configuração salva em ${resultado.arquivo}`);
        if (modo === 'primeiro-uso' && aoFinalizar) {
          const avisar = aoFinalizar;
          aoFinalizar = null;
          // Responde primeiro, fecha o servidor logo depois
          responderJson(res, 200, { ...resultado, continuara: true });
          avisar();
          setTimeout(() => { parar(); }, 400);
          return;
        }
        responderJson(res, 200, { ...resultado, continuara: false });
        return;
      }
      responderJson(res, 200, resultado);
      return;
    }

    if (req.method === 'POST' && url === '/api/encerrar') {
      responderJson(res, 200, { ok: true });
      if (modo === 'primeiro-uso' && aoDesistir) {
        const avisar = aoDesistir;
        aoDesistir = null;
        avisar();
      }
      setTimeout(() => {
        parar();
        if (modo === 'standalone') process.exit(0);
      }, 200);
      return;
    }

    responderJson(res, 404, { ok: false, mensagem: 'rota desconhecida' });
  } catch (err) {
    responderJson(res, 400, { ok: false, mensagem: err?.message || 'requisição inválida' });
  }
}

/**
 * Sobe o servidor do assistente (só 127.0.0.1; porta ocupada tenta +1..+5).
 * @param {number} [porta=PORTA_PADRAO]
 * @returns {Promise<number|null>} porta real
 */
function iniciar(porta = PORTA_PADRAO) {
  if (servidor) return Promise.resolve(portaReal);

  return new Promise((resolve) => {
    const tentar = (candidata, restantes) => {
      const srv = http.createServer(tratarRequisicao);
      srv.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && restantes > 0) {
          logger.aviso(`[Assistente] Porta ${candidata} ocupada — tentando ${candidata + 1}...`);
          tentar(candidata + 1, restantes - 1);
        } else {
          logger.aviso(`[Assistente] Não foi possível subir o servidor (${err.code || err.message}).`);
          resolve(null);
        }
      });
      srv.listen(candidata, '127.0.0.1', () => {
        servidor = srv;
        portaReal = srv.address().port || candidata;
        resolve(portaReal);
      });
    };
    tentar(Number.isInteger(porta) ? porta : PORTA_PADRAO, 5);
  });
}

/** Fecha o servidor (encerramento / testes). */
function parar() {
  return new Promise((resolve) => {
    if (!servidor) { resolve(); return; }
    const srv = servidor;
    servidor = null;
    portaReal = null;
    srv.close(() => resolve());
    // conexões keep-alive pendentes não podem segurar o processo
    srv.closeAllConnections?.();
  });
}

/**
 * Abre o navegador padrão com a URL (best-effort multi-plataforma).
 * @returns {boolean} true se o comando foi disparado (não garante sucesso)
 */
function abrirNavegador(endereco) {
  try {
    let proc;
    if (process.platform === 'win32') {
      proc = spawn('cmd', ['/c', 'start', '', endereco], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      proc = spawn('open', [endereco], { detached: true, stdio: 'ignore' });
    } else {
      proc = spawn('xdg-open', [endereco], { detached: true, stdio: 'ignore' });
    }
    proc.on('error', () => { /* sem navegador: o usuário copia a URL */ });
    proc.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fluxo de primeiro uso: sobe o wizard, abre o navegador e espera o
 * usuário salvar (resolve true) ou desistir (resolve false).
 * @returns {Promise<boolean>}
 */
async function aguardarConfiguracao() {
  modo = 'primeiro-uso';
  const porta = await iniciar(PORTA_PADRAO);
  if (!porta) {
    logger.erro('[Assistente] Sem o assistente não dá para configurar automaticamente.');
    return false;
  }

  const endereco = `http://localhost:${porta}`;
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════════╗');
  logger.info('║  🛠  ASSISTENTE DE CONFIGURAÇÃO                      ║');
  logger.info(`║  ${endereco}                    ║`);
  logger.info('║  (Ctrl+C sai sem configurar)                         ║');
  logger.info('╚══════════════════════════════════════════════════════╝');
  const abriu = abrirNavegador(endereco);
  if (!abriu) {
    logger.info('Abra o endereço acima no seu navegador para configurar o bot.');
  }
  logger.info('Aguardando você salvar... (a janela do terminal pode ficar minimizada)');

  return new Promise((resolve) => {
    aoFinalizar = () => resolve(true);
    aoDesistir = () => resolve(false);
  });
}

/**
 * Modo standalone: abre o wizard fora do boot (npm run assistente,
 * iniciar.bat --assistente ou atalho do menu Iniciar).
 * @returns {Promise<boolean>} true se o servidor subiu
 */
async function rodarStandalone() {
  modo = 'standalone';
  const porta = await iniciar(PORTA_PADRAO);
  if (!porta) {
    logger.erro('[Assistente] Não foi possível subir o servidor.');
    return false;
  }
  const endereco = `http://localhost:${porta}`;
  logger.info('');
  logger.info(`🛠  Assistente de configuração: ${endereco}`);
  const abriu = abrirNavegador(endereco);
  if (!abriu) logger.info('Abra o endereço acima no seu navegador.');
  logger.info('Salve a configuração e feche o assistente — depois é só rodar o bot.');
  return true;
}

// ---------------------------------------------------------------------------
// Entry point direto: `npm run assistente` / `node src/assistente.js`
// ---------------------------------------------------------------------------
if (require.main === module) {
  rodarStandalone().catch((err) => {
    logger.erro(`[Assistente] ${err?.message || err}`);
    process.exit(1);
  });
}

module.exports = {
  iniciar,
  parar,
  url: () => (portaReal ? `http://localhost:${portaReal}` : null),
  aguardarConfiguracao,
  rodarStandalone,
  // puros — testáveis sem servidor
  montarConteudoEnv,
  mascararSegredo,
  salvarConfiguracao,
  verificarCaminhosJogo,
  abrirJogoAgora,
};
