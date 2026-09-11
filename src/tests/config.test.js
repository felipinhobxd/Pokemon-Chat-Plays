/**
 * Testes do config.js (v2.6) — normalização do YOUTUBE_VIDEO_ID,
 * recarregamento in-place e erros silenciosos para o assistente.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  config,
  errosConfig,
  recarregar,
  normalizarVideoIdYoutube,
} = require('../config');

test('normalizarVideoIdYoutube: ID puro passa direto', () => {
  assert.strictEqual(normalizarVideoIdYoutube('jfKfPfyJRdk'), 'jfKfPfyJRdk');
  assert.strictEqual(normalizarVideoIdYoutube('  jfKfPfyJRdk  '), 'jfKfPfyJRdk');
});

test('normalizarVideoIdYoutube: extrai ID da URL watch (com parâmetros extras)', () => {
  assert.strictEqual(
    normalizarVideoIdYoutube('https://www.youtube.com/watch?v=jfKfPfyJRdk'),
    'jfKfPfyJRdk'
  );
  assert.strictEqual(
    normalizarVideoIdYoutube('https://www.youtube.com/watch?v=jfKfPfyJRdk&t=30s&feature=live'),
    'jfKfPfyJRdk'
  );
  assert.strictEqual(
    normalizarVideoIdYoutube('youtube.com/watch?v=abc123XYZ_-'),
    'abc123XYZ_-'
  );
});

test('normalizarVideoIdYoutube: extrai ID de youtu.be, /live/, /shorts/ e /embed/', () => {
  assert.strictEqual(normalizarVideoIdYoutube('https://youtu.be/jfKfPfyJRdk'), 'jfKfPfyJRdk');
  assert.strictEqual(normalizarVideoIdYoutube('https://www.youtube.com/live/jfKfPfyJRdk'), 'jfKfPfyJRdk');
  assert.strictEqual(normalizarVideoIdYoutube('https://www.youtube.com/shorts/abc123XYZ12'), 'abc123XYZ12');
  assert.strictEqual(normalizarVideoIdYoutube('https://www.youtube.com/embed/jfKfPfyJRdk'), 'jfKfPfyJRdk');
});

test('normalizarVideoIdYoutube: vazio/lixo não explode', () => {
  assert.strictEqual(normalizarVideoIdYoutube(''), '');
  assert.strictEqual(normalizarVideoIdYoutube(null), '');
  assert.strictEqual(normalizarVideoIdYoutube(undefined), '');
});

test('errosConfig: lista erros das plataformas ativas sem imprimir nada', () => {
  const ativasOriginal = config.geral.plataformasAtivas;
  config.geral.plataformasAtivas = ['twitch', 'youtube'];
  try {
    const erros = errosConfig();
    assert.ok(erros.some((e) => e.includes('TWITCH_BOT_USERNAME')), 'falta username');
    assert.ok(erros.some((e) => e.includes('TWITCH_OAUTH_TOKEN')), 'falta token');
    assert.ok(erros.some((e) => e.includes('YOUTUBE_API_KEY')), 'falta api key');
    assert.ok(erros.some((e) => e.includes('YOUTUBE_VIDEO_ID')), 'falta video id');
  } finally {
    config.geral.plataformasAtivas = ativasOriginal;
  }
});

test('recarregar: muta o MESMO objeto config (referências internas vivas) + lê env novo', () => {
  const refTwitch = config.twitch;
  const refYoutube = config.youtube;

  process.env.TWITCH_BOT_USERNAME = 'bot_teste';
  process.env.YOUTUBE_VIDEO_ID = 'https://www.youtube.com/watch?v=jfKfPfyJRdk';
  recarregar();

  // mesma referência (módulos que guardaram config.twitch continuam válidos)
  assert.strictEqual(config.twitch, refTwitch);
  assert.strictEqual(config.youtube, refYoutube);
  assert.strictEqual(config.twitch.username, 'bot_teste');
  assert.strictEqual(config.youtube.videoId, 'jfKfPfyJRdk', 'URL virou ID no recarregar');

  // limpa e volta ao estado inicial
  delete process.env.TWITCH_BOT_USERNAME;
  delete process.env.YOUTUBE_VIDEO_ID;
  recarregar();
  assert.strictEqual(config.twitch.username, '');
  assert.strictEqual(config.youtube.videoId, '');
  assert.strictEqual(config.twitch, refTwitch);
});
