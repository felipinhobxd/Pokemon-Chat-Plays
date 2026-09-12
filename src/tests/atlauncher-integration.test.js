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
});

test('Assistente: ATLauncher normaliza preset e input para Minecraft global', () => {
  const src = fonte('assistente.js');
  assert.match(src, /ehAtLauncher\(finais\.EMULADOR_EXE\)/);
  assert.match(src, /finais\.EMULADOR_PRESET = 'minecraft'/);
  assert.match(src, /finais\.MODO_TECLADO = 'global'/);
  assert.match(src, /finais\.MODO_MOUSE = 'global'/);
});

test('Assistente: erro de backend com mensagem nunca fica vazio na tela', () => {
  const src = fonte('assistente-pagina.js');
  assert.match(src, /if \(!detalhes\.length && r\.mensagem\) detalhes\.push\(r\.mensagem\)/);
});
