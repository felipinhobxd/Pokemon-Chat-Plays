/**
 * Verificador de atualização (v2.3).
 *
 * No startup o app consulta a API pública do GitHub e compara a tag da
 * última release com a versão em execução. Se houver uma versão mais nova,
 * o bot mostra um aviso chamativo no terminal com o link do download.
 *
 * Motivo: usuários rodando .exe antigo com bugs já corrigidos era o
 * problema de suporte nº 1 (ex.: v2.2.0 com o bug das teclas que não
 * apertavam, enquanto a v2.2.1 já tinha a correção).
 *
 * Silencioso por design: sem internet / API fora do ar / timeout —
 * simplesmente não mostra nada.
 */

const logger = require('./logger');

// Renomeado de Pokemon-Chat-Plays para ChatPlays (a API do GitHub segue
// redirecionando o nome antigo, mas consultamos o novo direto).
const REPO = 'felipinhobxd/ChatPlays';
const URL_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 6000;

/**
 * Remove o prefixo "v" de uma tag/versão.
 * @param {string} versao
 * @returns {string}
 */
function normalizarVersao(versao) {
  return String(versao || '').trim().replace(/^v/i, '');
}

/**
 * Compara duas versões semânticas (X.Y.Z).
 * @param {string} a - ex.: '2.3.0' ou 'v2.3.0'
 * @param {string} b - ex.: '2.2.9'
 * @returns {number} >0 se a>b, 0 se iguais, <0 se a<b
 */
function compararVersoes(a, b) {
  const pa = normalizarVersao(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = normalizarVersao(b).split('.').map((n) => parseInt(n, 10) || 0);
  const tamanho = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < tamanho; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Consulta a última release do GitHub.
 * @returns {Promise<{novaVersao: string, url: string, notas: string}|null>}
 *   Dados da versão mais nova, ou null se está atualizado/indisponível.
 */
async function verificarAtualizacao(versaoAtual) {
  try {
    const resposta = await fetch(URL_API, {
      headers: {
        'User-Agent': 'ChatPlays',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resposta.ok) return null;

    const dados = await resposta.json();
    const tag = dados && dados.tag_name;
    if (!tag) return null;

    if (compararVersoes(tag, versaoAtual) > 0) {
      return {
        novaVersao: normalizarVersao(tag),
        url: dados.html_url || `https://github.com/${REPO}/releases/latest`,
        notas: String(dados.name || '').trim(),
      };
    }
    return null;
  } catch {
    // offline / DNS / timeout — silêncio total
    return null;
  }
}

/**
 * Verifica E loga o aviso se houver versão nova (fire-and-forget).
 * @param {string} versaoAtual - Versão em execução (do package.json)
 * @returns {Promise<boolean>} true se avisou sobre versão nova
 */
async function avisarSeDesatualizado(versaoAtual) {
  const info = await verificarAtualizacao(versaoAtual);
  if (!info) return false;
  logger.aviso('┌──────────────────────────────────────────────────┐');
  logger.aviso('│  📦 ATUALIZAÇÃO DISPONÍVEL!                       │');
  logger.aviso(`│  Sua versão: v${normalizarVersao(versaoAtual).padEnd(37)}│`);
  logger.aviso(`│  Nova versão: v${info.novaVersao.padEnd(36)}│`);
  logger.aviso('│                                                  │');
  logger.aviso(`│  Baixe em: ${info.url.slice(0, 38).padEnd(39)}│`);
  logger.aviso('│  (substitua o .exe antigo pelo novo zip)         │');
  logger.aviso('└──────────────────────────────────────────────────┘');
  return true;
}

module.exports = {
  verificarAtualizacao,
  avisarSeDesatualizado,
  compararVersoes,
  normalizarVersao,
};
