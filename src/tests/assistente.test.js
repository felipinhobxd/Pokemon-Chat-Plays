/**
 * Testes do assistente de configuração (v2.6) — helpers puros:
 * geração do .env completo e verificação de caminhos.
 * v2.7: campos do jogo (exe + ROM + reabrir).
 * v2.8.1: segredos mascarados no prefill — máscara intacta = manter.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  montarConteudoEnv,
  resolverSegredos,
  mascararSegredo,
  resolverSegredoCampo,
  estadoAtual,
  avaliarSalvamento,
  salvarConfiguracao,
  verificarCaminhosJogo,
  hostPermitido,
  origemPermitida,
} = require('../assistente');
const { errosConfig, caminhoEnv } = require('../config');

// ---------------------------------------------------------------------------
// mascararSegredo — o prefill mostra que HÁ valor sem entregar o valor (v2.8.1)
// ---------------------------------------------------------------------------

test('mascararSegredo: segredo longo vira bolinhas + 4 últimos caracteres', () => {
  assert.strictEqual(mascararSegredo('oauth:abcdefgh1234'), '••••••••1234');
  assert.strictEqual(mascararSegredo('AIzaSyD-1234567890xyz'), '••••••••0xyz');
});

test('mascararSegredo: segredo curto vira SÓ bolinhas (nada é revelado)', () => {
  assert.strictEqual(mascararSegredo('curto'), '••••••••');
  assert.strictEqual(mascararSegredo('12345678901'), '••••••••');
});

test('mascararSegredo: vazio fica vazio (não inventa valor onde não há)', () => {
  assert.strictEqual(mascararSegredo(''), '');
  assert.strictEqual(mascararSegredo(null), '');
  assert.strictEqual(mascararSegredo('   '), '');
});

// ---------------------------------------------------------------------------
// resolverSegredos — a máscara do prefill intacta = MANTER o salvo (v2.8.1)
// ---------------------------------------------------------------------------

test('resolverSegredos: token sem oauth: ganha o prefixo sozinho', () => {
  assert.strictEqual(resolverSegredos({ TWITCH_OAUTH_TOKEN: 'abc123' }).TWITCH_OAUTH_TOKEN, 'oauth:abc123');
  assert.strictEqual(resolverSegredos({ TWITCH_OAUTH_TOKEN: 'OAUTH:abc' }).TWITCH_OAUTH_TOKEN, 'OAUTH:abc');
  assert.strictEqual(resolverSegredos({ TWITCH_OAUTH_TOKEN: 'oauth:xyz' }).TWITCH_OAUTH_TOKEN, 'oauth:xyz');
});

test('resolverSegredos: vazio agora significa apagar de verdade (prefill)', () => {
  const r = resolverSegredos({ TWITCH_OAUTH_TOKEN: '  ', YOUTUBE_API_KEY: '' });
  assert.strictEqual(r.TWITCH_OAUTH_TOKEN, '');
  assert.strictEqual(r.YOUTUBE_API_KEY, '');
});

test('resolverSegredos: espaços nas pontas são limpos, chave mantida intacta', () => {
  const r = resolverSegredos({ TWITCH_OAUTH_TOKEN: '  tok  ', YOUTUBE_API_KEY: ' AIza... ' });
  assert.strictEqual(r.TWITCH_OAUTH_TOKEN, 'oauth:tok');
  assert.strictEqual(r.YOUTUBE_API_KEY, 'AIza...');
});

test('resolverSegredos: máscara do prefill intacta = manter o valor salvo (v2.8.1)', () => {
  const atuais = { token: 'oauth:segredao1234', apiKey: 'AIzaSyD-chave-9876' };
  const r = resolverSegredos(
    {
      TWITCH_OAUTH_TOKEN: mascararSegredo(atuais.token), // o que a página manda sem mexer
      YOUTUBE_API_KEY: mascararSegredo(atuais.apiKey),
    },
    atuais
  );
  assert.strictEqual(r.TWITCH_OAUTH_TOKEN, 'oauth:segredao1234', 'token mantido');
  assert.strictEqual(r.YOUTUBE_API_KEY, 'AIzaSyD-chave-9876', 'chave mantida');
});

test('resolverSegredos: valor NOVO substitui o salvo', () => {
  const atuais = { token: 'oauth:aaaaaaaaaaaa', apiKey: 'AIzaSyD-bbbbbbbb-9999' };
  const r = resolverSegredos({ TWITCH_OAUTH_TOKEN: 'novotoken9876' }, atuais);
  assert.strictEqual(r.TWITCH_OAUTH_TOKEN, 'oauth:novotoken9876');
});

test('resolverSegredoCampo: máscara resolve para o atual; vazio fica vazio', () => {
  const atual = 'oauth:tokensecreto123';
  assert.strictEqual(resolverSegredoCampo(mascararSegredo(atual), atual), atual);
  assert.strictEqual(resolverSegredoCampo('outrovalor', atual), 'outrovalor');
  assert.strictEqual(resolverSegredoCampo('', atual), '');
  assert.strictEqual(resolverSegredoCampo(null, atual), '');
});

// ---------------------------------------------------------------------------
// estadoAtual — TUDO que foi salvo antes volta para o wizard (v2.8)
// ---------------------------------------------------------------------------

function cfgFake(extras = {}) {
  return {
    geral: { plataformasAtivas: ['twitch', 'youtube'], cooldownMs: 1500, tempoPressionarTeclaMs: 230 },
    twitch: { username: 'meubot', oauthToken: 'oauth:toksupersecret99', channel: 'sindrome' },
    youtube: { apiKey: 'AIza123supersecret', videoId: 'jfKfPfyJRdk' },
    teclado: { preset: 'vbam', modo: 'janela', emuladorExe: 'C:\\jogo\\vbam.exe' },
    jogo: { rom: 'C:\\roms\\Emeralda.gba', autoReiniciar: true },
    pausa: { tecla: 'f9' },
    votacao: { modoInicial: 'anarquia' },
    overlay: { porta: 8899, ativa: true },
    ...extras,
  };
}

test('estadoAtual: segredos voltam MASCARADOS — nada em claro vai ao navegador (v2.8.1)', () => {
  const d = estadoAtual(cfgFake());
  assert.strictEqual(d.valores.TWITCH_OAUTH_TOKEN, '••••••••et99');
  assert.strictEqual(d.valores.YOUTUBE_API_KEY, '••••••••cret');
  // flags para a página avisar "há um valor salvo — deixe como está"
  assert.strictEqual(d.temTokenTwitch, true);
  assert.strictEqual(d.temChaveYoutube, true);
  // o JSON inteiro não pode conter os segredos em claro
  assert.ok(!JSON.stringify(d).includes('oauth:tok'), 'token em claro vazou');
  assert.ok(!JSON.stringify(d).includes('AIza123'), 'chave em claro vazou');
  assert.strictEqual(d.valores.TWITCH_BOT_USERNAME, 'meubot');
  assert.strictEqual(d.valores.TWITCH_CHANNEL, 'sindrome');
  assert.strictEqual(d.valores.YOUTUBE_VIDEO_ID, 'jfKfPfyJRdk');
  // jogo/ROM também voltam (v2.7)
  assert.strictEqual(d.valores.EMULADOR_EXE, 'C:\\jogo\\vbam.exe');
  assert.strictEqual(d.valores.JOGO_ROM, 'C:\\roms\\Emeralda.gba');
});

test('estadoAtual: sem segredo salvo → máscara vazia e flags falsas', () => {
  const cfg = cfgFake();
  cfg.twitch = { username: 'meubot', oauthToken: '', channel: 'sindrome' };
  cfg.youtube = { apiKey: '', videoId: 'abc' };
  const d = estadoAtual(cfg);
  assert.strictEqual(d.valores.TWITCH_OAUTH_TOKEN, '');
  assert.strictEqual(d.valores.YOUTUBE_API_KEY, '');
  assert.strictEqual(d.temTokenTwitch, false);
  assert.strictEqual(d.temChaveYoutube, false);
});

test('estadoAtual: configurado reflete errosConfig da cfg recebida', () => {
  const ok = estadoAtual(cfgFake());
  assert.strictEqual(ok.configurado, true);

  const semToken = cfgFake();
  semToken.twitch = { username: 'meubot', oauthToken: '', channel: 'sindrome' };
  const ruim = estadoAtual(semToken);
  assert.strictEqual(ruim.configurado, false);
});

// ---------------------------------------------------------------------------
// errosConfig(cfg) — validação de valores que ainda não estão no config global
// ---------------------------------------------------------------------------

test('errosConfig: aceita cfg explícita (sem tocar no .env do processo)', () => {
  const cfg = {
    geral: { plataformasAtivas: ['youtube'] },
    twitch: { username: '', oauthToken: '', channel: '' },
    youtube: { apiKey: '', videoId: '' },
  };
  // twitch inativa → credenciais vazias não são erro; youtube ativo → são
  assert.deepStrictEqual(errosConfig(cfg), [
    'YOUTUBE_API_KEY não definido',
    'YOUTUBE_VIDEO_ID não definido',
  ]);
});

test('montarConteudoEnv: segredo vazio agora APAGA de verdade (v2.8 — prefill)', () => {
  const conteudo = montarConteudoEnv({
    TWITCH_BOT_USERNAME: 'b',
    TWITCH_OAUTH_TOKEN: '',
    TWITCH_CHANNEL: 'c',
  });
  assert.ok(conteudo.includes('TWITCH_OAUTH_TOKEN='));
  assert.ok(!conteudo.includes('TWITCH_OAUTH_TOKEN=oauth:'));
});

// ---------------------------------------------------------------------------
// avaliarSalvamento/salvarConfiguracao — valida ANTES de gravar (v2.8)
// ---------------------------------------------------------------------------

test('avaliarSalvamento: body completo vira finais normalizados e ok', () => {
  const r = avaliarSalvamento({
    twitchAtivo: true,
    youtubeAtivo: true,
    jogoAutoReiniciar: true,
    TWITCH_BOT_USERNAME: 'bot',
    TWITCH_OAUTH_TOKEN: 'sem-prefixo',
    TWITCH_CHANNEL: '#canal',
    YOUTUBE_API_KEY: 'AIza1',
    YOUTUBE_VIDEO_ID: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.erros, []);
  assert.strictEqual(r.finais.TWITCH_OAUTH_TOKEN, 'oauth:sem-prefixo');
  assert.strictEqual(r.finais.YOUTUBE_VIDEO_ID, 'jfKfPfyJRdk');
  assert.strictEqual(r.finais.ACTIVE_PLATFORMS, 'twitch,youtube');
  assert.strictEqual(r.finais.YOUTUBE_ENABLED, 'true');
});

test('salvarConfiguracao: twitch ativo com token VAZIO NÃO grava o .env (v2.8)', () => {
  const caminho = caminhoEnv();
  const antes = fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : null;

  const r = salvarConfiguracao({
    twitchAtivo: true,
    youtubeAtivo: false,
    TWITCH_BOT_USERNAME: 'bot',
    TWITCH_OAUTH_TOKEN: '   ',
    TWITCH_CHANNEL: 'canal',
  });

  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('TWITCH_OAUTH_TOKEN')), r.erros);

  // o .env anterior (com os segredos intactos) não pode ter sido tocado
  const depois = fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : null;
  assert.strictEqual(depois, antes, '.env foi gravado/apagado com config inválida!');
});

test('salvarConfiguracao: página sem prefill NÃO apaga chaves salvas (regressão v2.8)', () => {
  const caminho = caminhoEnv();
  const antes = fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : null;

  // simula o body de uma página que NUNCA carregou o prefill: tudo vazio
  const r = salvarConfiguracao({ twitchAtivo: true, youtubeAtivo: false });

  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.length >= 3, 'deveria listar os campos faltando');
  const depois = fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : null;
  assert.strictEqual(depois, antes, '.env destruído por body vazio!');
});

test('avaliarSalvamento: body com as MÁSCARAS intactas mantém os segredos atuais (v2.8.1)', () => {
  const atuais = { token: 'oauth:salvo1234', apiKey: 'AIzaSyD-salva-5678' };
  const r = avaliarSalvamento(
    {
      twitchAtivo: true,
      youtubeAtivo: true,
      TWITCH_BOT_USERNAME: 'bot',
      TWITCH_CHANNEL: 'canal',
      TWITCH_OAUTH_TOKEN: mascararSegredo(atuais.token), // não mexeu no campo
      YOUTUBE_API_KEY: mascararSegredo(atuais.apiKey),
      YOUTUBE_VIDEO_ID: 'jfKfPfyJRdk',
    },
    atuais
  );
  assert.strictEqual(r.ok, true, r.erros);
  assert.strictEqual(r.finais.TWITCH_OAUTH_TOKEN, 'oauth:salvo1234');
  assert.strictEqual(r.finais.YOUTUBE_API_KEY, 'AIzaSyD-salva-5678');
});

test('avaliarSalvamento: twitch DESATIVADO permite segredo vazio (remoção consciente)', () => {
  const r = avaliarSalvamento({
    twitchAtivo: false,
    youtubeAtivo: true,
    TWITCH_OAUTH_TOKEN: '',
    YOUTUBE_API_KEY: 'AIza1',
    YOUTUBE_VIDEO_ID: 'jfKfPfyJRdk',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.finais.ACTIVE_PLATFORMS, 'youtube');
  assert.strictEqual(r.finais.TWITCH_OAUTH_TOKEN, '');
});

test('avaliarSalvamento: nenhuma plataforma ligada é bloqueado com erro claro', () => {
  const r = avaliarSalvamento({ twitchAtivo: false, youtubeAtivo: false });
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.some((e) => e.includes('Nenhuma plataforma')), r.erros);
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

test('montarConteudoEnv: JOGO_ARGS preserva aspas — args com espaço não corrompem (bug v2.7.0)', () => {
  const { dividirArgs } = require('../utils/jogo');
  const args = '-L "C:\\cores com espaço\\mgba.dll" --fullscreen';
  const conteudo = montarConteudoEnv({ JOGO_ARGS: args });
  const linha = conteudo.split('\n').find((l) => l.startsWith('JOGO_ARGS='));
  assert.ok(linha, 'linha JOGO_ARGS sumiu');
  assert.strictEqual(linha.slice('JOGO_ARGS='.length), args, 'args gravados verbatim (aspas intactas)');
  // e o lado do lançamento continua parseando certo o valor salvo:
  assert.deepStrictEqual(
    dividirArgs(linha.slice('JOGO_ARGS='.length)),
    ['-L', 'C:\\cores com espaço\\mgba.dll', '--fullscreen']
  );
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
