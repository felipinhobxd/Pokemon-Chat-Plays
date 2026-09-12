'use strict';

const test = require('node:test');
const assert = require('node:assert');
const assistente = require('../assistente');
const { PAGINA } = require('../assistente-pagina');

test('assistente: script lista apps com janela e caminho executável', () => {
  const s = assistente.montarScriptAplicativosAbertos();
  assert.match(s, /MainWindowHandle -ne 0/);
  assert.match(s, /MainWindowTitle/);
  assert.match(s, /ProcessName/);
  assert.match(s, /ExecutablePath/);
  assert.match(s, /ConvertTo-Json/);
});

test('assistente: normaliza Minecraft javaw e Peggle', () => {
  const um = assistente.normalizarAplicativosAbertos(JSON.stringify({
    pid: 4242,
    titulo: 'Minecraft* 26.2',
    processo: 'javaw.exe',
    caminho: 'C:\\Java\\bin\\javaw.exe',
  }));
  assert.strictEqual(um.length, 1);
  assert.strictEqual(um[0].titulo, 'Minecraft* 26.2');
  assert.strictEqual(um[0].processo, 'javaw.exe');

  const varios = assistente.normalizarAplicativosAbertos(JSON.stringify([
    { pid: 9, titulo: 'Peggle', processo: 'Peggle', caminho: 'C:\\Games\\Peggle\\Peggle.exe' },
    { pid: 0, titulo: '', processo: '', caminho: '' },
  ]));
  assert.strictEqual(varios.length, 1);
  assert.strictEqual(varios[0].processo, 'Peggle.exe');
});

test('assistente: página expõe seletor de app aberto e mantém caminho manual', () => {
  assert.match(PAGINA, /id="btn-apps-abertos"/);
  assert.match(PAGINA, /id="f-app-aberto"/);
  assert.match(PAGINA, /\/api\/aplicativos-abertos/);
  assert.match(PAGINA, /id="f-exe"/);
  assert.match(PAGINA, /Minecraft\* 26\.2/);
  assert.match(PAGINA, /ALVO_PID: ALVO_ABERTO\.pid/);
  assert.match(PAGINA, /ALVO_TITULO: ALVO_ABERTO\.titulo/);
  assert.match(PAGINA, /value="jogo"/);
  assert.match(PAGINA, /Raw Input/);
});
