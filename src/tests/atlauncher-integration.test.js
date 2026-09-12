'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function fonte(nome) {
  return fs.readFileSync(path.join(__dirname, '..', nome), 'utf8');
}

test('ATLauncher: integração não depende do preset Minecraft', () => {
  const src = fonte('index.js');
  assert.match(src, /const usarLauncherMinecraft = minecraftLauncher\.ehAtLauncher\(exeDoJogo\);/);
  assert.match(src, /const launcherMinecraftAtivo = minecraftLauncher\.ehAtLauncher\(exeDoJogo\);/);
  assert.doesNotMatch(src, /const usarLauncherMinecraft =[\s\S]{0,180}teclado\.preset[\s\S]{0,180}ehAtLauncher/);
  assert.match(src, /launcherMinecraftAtivo \? 'jogo' : config\.mouse\.modo/);
});

test('boot entrega PID, título e processo salvos ao mouse', () => {
  const src = fonte('index.js');
  assert.match(src, /emulador\.carregarAlvo\(emulador\.caminhoArquivoAlvo\(\), exeDoJogo\)/);
  assert.match(src, /alvoPid: alvoAberto\?\.pid \|\| 0/);
  assert.match(src, /alvoTitulo: alvoAberto\?\.titulo \|\| \(presetMinecraftAtivo \? 'Minecraft' : ''\)/);
  assert.match(src, /alvoProcesso: alvoAberto\?\.processo \|\| ''/);
});

test('Assistente: ATLauncher usa teclado global e mouse relativo de jogo', () => {
  const src = fonte('assistente.js');
  assert.match(src, /ehAtLauncher\(finais\.EMULADOR_EXE\)/);
  assert.match(src, /finais\.EMULADOR_PRESET = 'minecraft'/);
  assert.match(src, /finais\.MODO_TECLADO = 'global'/);
  assert.match(src, /finais\.MODO_MOUSE = 'jogo'/);
});

test('Assistente: erro de backend com mensagem nunca fica vazio na tela', () => {
  const src = fonte('assistente-pagina.js');
  assert.match(src, /if \(!detalhes\.length && r\.mensagem\) detalhes\.push\(r\.mensagem\)/);
});
