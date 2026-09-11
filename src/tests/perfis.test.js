'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarStore, patchEnvText, argumentoPerfil } = require('../perfis');

function pastaTeste() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatplays-perfis-'));
  fs.mkdirSync(path.join(dir, 'dados'), { recursive: true });
  return dir;
}

function escreverEnv(dir, extras = '') {
  fs.writeFileSync(path.join(dir, '.env'), [
    'TWITCH_BOT_USERNAME=meubot',
    'TWITCH_OAUTH_TOKEN=oauth:SEGREDO-QUE-NAO-PODE-IR-PRO-PERFIL',
    'YOUTUBE_API_KEY=SEGREDO-YT',
    'EMULADOR_PRESET=vbam',
    'EMULADOR_EXE=C:\\Games\\VBA-M.exe',
    'JOGO_ROM=C:\\Roms\\Pokemon Emerald.gba',
    'MODO_TECLADO=janela',
    'MODO_MOUSE=janela',
    'MOUSE_PASSO_PX=40',
    'KEY_PRESS_DURATION_MS=230',
    'CONTROLES_ARQUIVO=dados/controles.json',
    extras,
    '',
  ].join('\n'));
}

function escreverControles(dir, nome = 'Cima', alias = 'cima') {
  fs.writeFileSync(
    path.join(dir, 'dados', 'controles.json'),
    JSON.stringify({
      versao: 1,
      controles: [{
        id: 'up', label: nome, icone: '⬆', key: 'up', aliases: [alias],
        holdable: true, builtin: true, enabled: true,
      }],
    }, null, 2)
  );
}

function lerEnv(dir) {
  return fs.readFileSync(path.join(dir, '.env'), 'utf8');
}

test('primeiro boot cria perfil a partir do jogo atual sem guardar segredos', () => {
  const dir = pastaTeste();
  try {
    escreverEnv(dir);
    escreverControles(dir);
    const store = criarStore({ baseDir: dir, envPath: path.join(dir, '.env') });
    const r = store.garantirInicial();
    assert.strictEqual(r.criado, true);
    const ativo = store.ativo();
    assert.ok(ativo);
    assert.match(ativo.nome, /Pokemon Emerald/i);
    assert.strictEqual(ativo.valores.EMULADOR_PRESET, 'vbam');
    assert.strictEqual(ativo.valores.MODO_MOUSE, 'janela');
    assert.strictEqual(ativo.controles[0].aliases[0], 'cima');

    const arquivo = fs.readFileSync(store.perfisPath, 'utf8');
    assert.doesNotMatch(arquivo, /SEGREDO-QUE-NAO-PODE/);
    assert.doesNotMatch(arquivo, /SEGREDO-YT/);
    assert.doesNotMatch(arquivo, /TWITCH_OAUTH_TOKEN/);
    assert.doesNotMatch(arquivo, /YOUTUBE_API_KEY/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trocar perfil aplica exe/ROM/teclado/mouse e preserva credenciais globais', () => {
  const dir = pastaTeste();
  try {
    escreverEnv(dir);
    escreverControles(dir);
    const store = criarStore({ baseDir: dir, envPath: path.join(dir, '.env') });
    store.garantirInicial();

    const snapshotMinecraft = {
      valores: {
        EMULADOR_PRESET: 'vbam',
        EMULADOR_EXE: 'C:\\Games\\MinecraftLauncher.exe',
        JOGO_ROM: null,
        JOGO_ARGS: '--demo',
        JOGO_AUTO_REINICIAR: 'true',
        JOGO_REINICIAR_DELAY_MS: '3000',
        JOGO_TENTATIVAS_MAX: '5',
        JOGO_VIDA_MINIMA_MS: '15000',
        MODO_TECLADO: 'janela',
        MODO_MOUSE: 'global',
        MOUSE_PASSO_PX: '60',
        KEY_PRESS_DURATION_MS: '120',
        COMMAND_COOLDOWN_MS: '500',
        HOLD_DEFAULT_MS: '1000',
        HOLD_MAX_MS: '10000',
        MODO_INICIAL: 'anarquia',
        VOTACAO_INTERVALO_MS: '10000',
      },
      controles: [{
        id: 'pular', label: 'Pular', icone: '🎮', key: 'space', aliases: ['pular', 'jump'],
        holdable: true, builtin: false, enabled: true,
      }],
    };
    const novo = store.criar('Minecraft', snapshotMinecraft, { ativar: false });
    assert.strictEqual(novo.ok, true);

    const r = store.ativar('minecraft');
    assert.strictEqual(r.ok, true, r.motivo);
    const env = lerEnv(dir);
    assert.match(env, /EMULADOR_EXE=C:\\Games\\MinecraftLauncher\.exe/);
    assert.match(env, /MODO_MOUSE=global/);
    assert.match(env, /MOUSE_PASSO_PX=60/);
    assert.doesNotMatch(env, /^JOGO_ROM=/m);
    assert.match(env, /TWITCH_OAUTH_TOKEN=oauth:SEGREDO-QUE-NAO-PODE-IR-PRO-PERFIL/);
    assert.match(env, /YOUTUBE_API_KEY=SEGREDO-YT/);

    const controles = JSON.parse(fs.readFileSync(path.join(dir, 'dados', 'controles.json'), 'utf8'));
    assert.strictEqual(controles.controles[0].label, 'Pular');
    assert.deepStrictEqual(controles.controles[0].aliases, ['pular', 'jump']);
    assert.strictEqual(store.ativo().nome, 'Minecraft');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('antes de trocar, alteracoes feitas no assistente sao sincronizadas no perfil ativo', () => {
  const dir = pastaTeste();
  try {
    escreverEnv(dir);
    escreverControles(dir);
    const store = criarStore({ baseDir: dir, envPath: path.join(dir, '.env') });
    const inicial = store.garantirInicial().dados;
    const pokemonId = inicial.ativoId;

    const outro = store.criar('Outro jogo', {
      valores: { EMULADOR_EXE: 'C:\\Outro\\jogo.exe', MODO_TECLADO: 'global', MODO_MOUSE: 'off' },
      controles: null,
    }, { ativar: false });
    assert.strictEqual(outro.ok, true);

    // Simula o usuario mudando a duracao no assistente enquanto Pokemon esta ativo.
    const alterado = patchEnvText(lerEnv(dir), { KEY_PRESS_DURATION_MS: '333' });
    fs.writeFileSync(path.join(dir, '.env'), alterado);

    const troca = store.ativar(outro.perfil.id);
    assert.strictEqual(troca.ok, true, troca.motivo);
    const dados = store.lerDados();
    const pokemon = dados.perfis.find((p) => p.id === pokemonId);
    assert.strictEqual(pokemon.valores.KEY_PRESS_DURATION_MS, '333');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('perfil sem controles personalizados remove controles.json e volta ao preset/.env', () => {
  const dir = pastaTeste();
  try {
    escreverEnv(dir);
    escreverControles(dir);
    const store = criarStore({ baseDir: dir, envPath: path.join(dir, '.env') });
    store.garantirInicial();
    const r = store.criar('Sem custom', {
      valores: { EMULADOR_PRESET: 'mgba', EMULADOR_EXE: 'C:\\Games\\mGBA.exe', MODO_TECLADO: 'janela' },
      controles: null,
    }, { ativar: false });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(store.ativar(r.perfil.id).ok, true);
    assert.strictEqual(fs.existsSync(path.join(dir, 'dados', 'controles.json')), false);
    assert.match(lerEnv(dir), /EMULADOR_PRESET=mgba/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('perfil ativo fica lembrado entre instancias do store', () => {
  const dir = pastaTeste();
  try {
    escreverEnv(dir);
    escreverControles(dir);
    const a = criarStore({ baseDir: dir, envPath: path.join(dir, '.env') });
    a.garantirInicial();
    const r = a.criar('Minecraft', a.snapshotAtual(), { ativar: true });
    assert.strictEqual(r.ok, true);

    const b = criarStore({ baseDir: dir, envPath: path.join(dir, '.env') });
    assert.strictEqual(b.ativo().id, r.perfil.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchEnvText altera somente chaves de perfil', () => {
  const antes = [
    '# comentario',
    'TWITCH_OAUTH_TOKEN=oauth:segredo',
    'EMULADOR_EXE=C:\\antigo.exe',
    'MODO_MOUSE=janela',
    'CUSTOM=nao-mexa',
    '',
  ].join('\n');
  const depois = patchEnvText(antes, {
    EMULADOR_EXE: 'C:\\novo.exe',
    MODO_MOUSE: null,
    MOUSE_PASSO_PX: '55',
  });
  assert.match(depois, /TWITCH_OAUTH_TOKEN=oauth:segredo/);
  assert.match(depois, /CUSTOM=nao-mexa/);
  assert.match(depois, /EMULADOR_EXE=C:\\novo\.exe/);
  assert.doesNotMatch(depois, /^MODO_MOUSE=/m);
  assert.match(depois, /MOUSE_PASSO_PX=55/);
});

test('argumentoPerfil aceita --perfil valor e --perfil=valor', () => {
  assert.strictEqual(argumentoPerfil(['--perfil', 'Pokemon Emerald']), 'Pokemon Emerald');
  assert.strictEqual(argumentoPerfil(['--perfil=Minecraft']), 'Minecraft');
  assert.strictEqual(argumentoPerfil(['--direto']), null);
});
