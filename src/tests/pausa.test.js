/**
 * Testes do botão de pânico do streamer (src/utils/pausa.js) — tecla F9.
 * O watcher PowerShell só existe no Windows; aqui testamos a lógica de
 * estado/observação (multi-plataforma).
 */

const test = require('node:test');
const assert = require('node:assert');
const pausa = require('../utils/pausa');

test('estado inicial é despausado', () => {
  pausa.resetar();
  assert.strictEqual(pausa.estaPausado(), false);
});

test('alternar pausa e despausa', () => {
  pausa.resetar();
  assert.strictEqual(pausa.alternar('teste'), true, 'primeira alternada = pausado');
  assert.strictEqual(pausa.estaPausado(), true);
  assert.strictEqual(pausa.alternar('teste'), false, 'segunda alternada = liberado');
  assert.strictEqual(pausa.estaPausado(), false);
});

test('definir aplica o estado exato e notifica só quando muda', () => {
  pausa.resetar();
  let notificacoes = 0;
  const cancelar = pausa.observar(() => { notificacoes++; });

  pausa.definir(true, 'teste');   // muda -> notifica
  assert.strictEqual(pausa.estaPausado(), true);
  pausa.definir(true, 'teste');   // NÃO muda -> não notifica
  assert.strictEqual(pausa.estaPausado(), true);
  pausa.definir(false, 'teste');  // muda -> notifica
  assert.strictEqual(pausa.estaPausado(), false);

  assert.strictEqual(notificacoes, 2);
  cancelar();
});

test('observador recebe o novo estado e a origem', () => {
  pausa.resetar();
  let recebido = null;
  const cancelar = pausa.observar((pausado, origem) => { recebido = { pausado, origem }; });
  pausa.alternar('tecla F9');
  assert.deepStrictEqual(recebido, { pausado: true, origem: 'tecla F9' });
  cancelar();
  pausa.resetar();
});

test('observador cancelado deixa de receber', () => {
  pausa.resetar();
  let chamadas = 0;
  const cancelar = pausa.observar(() => { chamadas++; });
  cancelar();
  pausa.alternar('teste');
  assert.strictEqual(chamadas, 0);
  pausa.resetar();
});

test('observador com erro não derruba os demais', () => {
  pausa.resetar();
  let segundoChamou = false;
  pausa.observar(() => { throw new Error('bug do observador 1'); });
  pausa.observar(() => { segundoChamou = true; });
  pausa.alternar('teste'); // o primeiro lança — o segundo ainda roda
  assert.ok(segundoChamou, 'segundo observador deve rodar mesmo se o primeiro falhar');
  pausa.resetar();
});
