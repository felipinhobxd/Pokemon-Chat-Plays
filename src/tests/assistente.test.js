/**
 * Testes do assistente de configuração (v2.6) — helpers puros:
 * mascaramento de segredos e geração do .env completo.
 * v2.7: campos do jogo (exe + ROM + reabrir) e verificação de caminhos.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { montarConteudoEnv, mascararSegredo, verificarCaminhosJogo } = require('../assistente');

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

// ---------------------------------------------------------------------------
// v2.7: jogo genérico — exe + ROM + reabrir no .env gerado
// ---------------------------------------------------------------------------

test('montarConteudoEnv: jogo configurado entra completo no .env', () => {
  const conteudo = montarConteudoEnv({
    EMULADOR_EXE: 'C:\\Users\\Admin\\Downloads\\visualboyadvance-m-Win-x86_64\\visualboyadvance-m.exe',
    JOGO_ROM: 'C:\\Users\\Admin\\Downloads\\Pokemon - Esmeralda.gba',
    JOGO_AUTO_REINICIAR: 'true',
  });
  assert.ok(conteudo.includes('EMULADOR_EXE=C:\\Users\\Admin\\Downloads\\visualboyadvance-m-Win-x86_64\\visualboyadvance-m.exe'));
  assert.ok(conteudo.includes('JOGO_ROM=C:\\Users\\Admin\\Downloads\\Pokemon - Esmeralda.gba'));
  assert.ok(conteudo.includes('JOGO_AUTO_REINICIAR=true'));
  // limites do watchdog também entram (defaults válidos)
  assert.ok(conteudo.includes('JOGO_REINICIAR_DELAY_MS=3000'));
  assert.ok(conteudo.includes('JOGO_TENTATIVAS_MAX=5'));
  assert.ok(conteudo.includes('JOGO_ARGS='));
});

test('montarConteudoEnv: reabrir desligado vira false (toggle do wizard)', () => {
  const conteudo = montarConteudoEnv({ JOGO_AUTO_REINICIAR: 'false' });
  assert.ok(conteudo.includes('JOGO_AUTO_REINICIAR=false'));
});

test('montarConteudoEnv: EMULADOR_EXE do .env VELHO não vira custom duplicada', () => {
  const envVelho = 'EMULADOR_EXE=C:\\velho\\vbam.exe\nJOGO_ROM=C:\\velha\\rom.gba\nMINHA_CUSTOM=1\n';
  const conteudo = montarConteudoEnv({ EMULADOR_EXE: 'C:\\novo\\vbam.exe' }, envVelho);
  assert.ok(conteudo.includes('EMULADOR_EXE=C:\\novo\\vbam.exe'), 'novo valor ganha');
  assert.ok(!conteudo.includes('C:\\velho'), 'velho não duplica');
  assert.ok(!conteudo.includes('C:\\velha'), 'rom velha não duplica');
  assert.ok(conteudo.includes('MINHA_CUSTOM=1'), 'custom de verdade preservada');
});

// ---------------------------------------------------------------------------
// verificarCaminhosJogo — o "🔍 Verificar caminhos" do wizard
// ---------------------------------------------------------------------------

test('verificarCaminhosJogo: exe e ROM existentes → ok com tamanhos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-assist-'));
  const exe = path.join(dir, 'vbam.exe');
  const rom = path.join(dir, 'Pokemon - Esmeralda.gba');
  fs.writeFileSync(exe, 'x'.repeat(2048));
  fs.writeFileSync(rom, 'y'.repeat(16 * 1024 * 1024));

  const r = verificarCaminhosJogo({ exe, rom });
  assert.ok(r.ok, r.mensagem);
  assert.ok(r.exe.ok && r.exe.tamanho === 2048);
  assert.ok(r.rom.ok && r.rom.tamanho === 16 * 1024 * 1024);
  assert.ok(r.mensagem.includes('vbam.exe'));
  assert.ok(r.mensagem.includes('Pokemon - Esmeralda.gba'));
});

test('verificarCaminhosJogo: caminho inexistente → não ok e mensagem diz qual', () => {
  const r = verificarCaminhosJogo({ exe: 'C:\\nao\\existe.exe', rom: '' });
  assert.ok(!r.ok);
  assert.ok(r.mensagem.includes('não achei o executável'));
});

test('verificarCaminhosJogo: ROM inexistente também é erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-assist2-'));
  const exe = path.join(dir, 'mgba.exe');
  fs.writeFileSync(exe, 'z');
  const r = verificarCaminhosJogo({ exe, rom: 'C:\\sumiu\\rom.gba' });
  assert.ok(!r.ok);
  assert.ok(r.mensagem.includes('não achei a ROM'));
});

test('verificarCaminhosJogo: nada configurado é OK (jogo é opcional)', () => {
  const r = verificarCaminhosJogo({ exe: '', rom: '' });
  assert.ok(r.ok);
  assert.strictEqual(r.exe, null);
  assert.strictEqual(r.rom, null);
  assert.ok(r.mensagem.includes('Sem jogo configurado'));
});

test('verificarCaminhosJogo: aspas e sujeira da colagem são limpas antes', () => {
  const r = verificarCaminhosJogo({ exe: '  "C:\\definitivo\\nao.txt"\r\n', rom: '' });
  assert.ok(!r.ok);
  assert.ok(r.mensagem.includes('C:\\definitivo\\nao.txt'), 'mensagem usa o caminho limpo');
});

test('verificarCaminhosJogo: exe sem extensão de programa vira aviso, não erro', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-assist3-'));
  const exe = path.join(dir, 'meujogo'); // sem .exe
  fs.writeFileSync(exe, 'w');
  const r = verificarCaminhosJogo({ exe, rom: '' });
  assert.ok(r.ok, 'sem extensão continua OK');
  assert.ok(r.mensagem.includes('atenção'), 'mas chama atenção');
});
