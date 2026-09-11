/**
 * Testes do assistente de configuração (v2.6) — helpers puros:
 * mascaramento de segredos e geração do .env completo.
 */

const test = require('node:test');
const assert = require('node:assert');

const { montarConteudoEnv, mascararSegredo } = require('../assistente');

// ---------------------------------------------------------------------------
// mascararSegredo — segredos NUNCA voltam inteiros ao navegador
// ---------------------------------------------------------------------------

test('mascararSegredo: vazio vazio, curto vira bolinhas', () => {
  assert.strictEqual(mascararSegredo(''), '');
  assert.strictEqual(mascararSegredo(null), '');
  assert.strictEqual(mascararSegredo('abc'), '••••');
  assert.strictEqual(mascararSegredo('12345678'), '••••••••');
});

test('mascararSegredo: longo mostra 4+4 com prefixo oauth: preservado', () => {
  assert.strictEqual(mascararSegredo('abcdefghijk'), 'abcd••••hijk');
  assert.strictEqual(mascararSegredo('oauth:abcdefghijk'), 'oauth:abcd••••hijk');
  assert.strictEqual(mascararSegredo('OAUTH:abcdefghijk'), 'oauth:abcd••••hijk');
});

test('mascararSegredo: nunca devolve o segredo inteiro', () => {
  const segredo = 'AIzaSyA-very-secret-key-9876543210';
  const mascara = mascararSegredo(segredo);
  assert.ok(!mascara.includes('very-secret'), 'meio do segredo não pode vazar');
  assert.notStrictEqual(mascara, segredo);
});

// ---------------------------------------------------------------------------
// montarConteudoEnv — .env completo, comentado e sem perder custom do usuário
// ---------------------------------------------------------------------------

test('montarConteudoEnv: gera TODAS as chaves essenciais com valores do wizard', () => {
  const conteudo = montarConteudoEnv({
    TWITCH_BOT_USERNAME: 'meubot',
    TWITCH_OAUTH_TOKEN: 'oauth:token123',
    TWITCH_CHANNEL: 'sindromegames',
    YOUTUBE_ENABLED: 'true',
    YOUTUBE_API_KEY: 'AIza123',
    YOUTUBE_VIDEO_ID: 'jfKfPfyJRdk',
    ACTIVE_PLATFORMS: 'twitch,youtube',
  });

  const linhas = conteudo.split('\n');
  const valor = (chave) => {
    const l = linhas.find((x) => x.startsWith(chave + '='));
    return l ? l.slice(chave.length + 1) : null;
  };

  assert.strictEqual(valor('TWITCH_BOT_USERNAME'), 'meubot');
  assert.strictEqual(valor('TWITCH_OAUTH_TOKEN'), 'oauth:token123');
  assert.strictEqual(valor('TWITCH_CHANNEL'), 'sindromegames');
  assert.strictEqual(valor('YOUTUBE_ENABLED'), 'true');
  assert.strictEqual(valor('YOUTUBE_API_KEY'), 'AIza123');
  assert.strictEqual(valor('YOUTUBE_VIDEO_ID'), 'jfKfPfyJRdk');
  assert.strictEqual(valor('ACTIVE_PLATFORMS'), 'twitch,youtube');

  // chaves não obrigatórias entram com defaults válidos
  assert.strictEqual(valor('COMMAND_COOLDOWN_MS'), '1500');
  assert.strictEqual(valor('MODO_INICIAL'), 'anarquia');
  assert.strictEqual(valor('TECLA_PAUSA'), 'f9');
  assert.strictEqual(valor('OVERLAY_PORTA'), '8899');
  assert.ok(valor('HOLD_MAX_MS'), 'hold max presente');
});

test('montarConteudoEnv: YouTube desligado fica false e plataformas só twitch', () => {
  const conteudo = montarConteudoEnv({
    twitchAtivo: true,
    youtubeAtivo: false,
    TWITCH_BOT_USERNAME: 'b',
    TWITCH_OAUTH_TOKEN: 't',
    TWITCH_CHANNEL: 'c',
  });
  assert.ok(conteudo.includes('YOUTUBE_ENABLED=false'));
  assert.ok(conteudo.includes('ACTIVE_PLATFORMS=twitch'));
});

test('montarConteudoEnv: preserva chaves customizadas do usuário, ignora conhecidas do .env velho', () => {
  const envVelho = [
    '# meu .env antigo',
    'TWITCH_CHANNEL=canal_antigo',
    'MINHA_CHAVE_CUSTOM=yes',
    'OUTRA_CUSTOM=42',
  ].join('\n');

  const conteudo = montarConteudoEnv(
    { TWITCH_CHANNEL: 'canal_novo' },
    envVelho
  );

  assert.ok(conteudo.includes('TWITCH_CHANNEL=canal_novo'), 'valor novo ganha');
  assert.ok(!conteudo.includes('canal_antigo'), 'valor velho não duplica');
  assert.ok(conteudo.includes('MINHA_CHAVE_CUSTOM=yes'), 'custom preservada');
  assert.ok(conteudo.includes('OUTRA_CUSTOM=42'), 'custom preservada (2)');
});

test('montarConteudoEnv: é .env válido (sem valores com quebra de linha)', () => {
  const conteudo = montarConteudoEnv({ TWITCH_CHANNEL: 'canal' });
  for (const linha of conteudo.split('\n')) {
    if (/^[A-Z_]+=/.test(linha)) {
      assert.ok(!/\r|\n/.test(linha.slice(linha.indexOf('=') + 1)), 'valor multilinha?!');
    }
  }
});
