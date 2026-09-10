/**
 * Testes do overlay do OBS (src/overlay.js).
 * Sobe o servidor REAL em porta efêmera (0) e confere página + API.
 */

const test = require('node:test');
const assert = require('node:assert');
const overlay = require('../overlay');

test('feed de ações guarda no máximo 15 itens (mais recente primeiro)', () => {
  for (let i = 0; i < 20; i++) {
    overlay.registrarAcao(`user${i}`, 'up', 'tap');
  }
  const snap = overlay.snapshot();
  assert.strictEqual(snap.acoes.length, 15, 'cap de 15 ações');
  assert.strictEqual(snap.acoes[0].usuario, 'user19', 'mais recente no topo');
  assert.ok(snap.acoes[0].ts >= snap.acoes[14].ts, 'ordem cronológica decrescente');
});

test('ações trazem ícone e rótulo do botão (catálogo do commands.js)', () => {
  overlay.registrarAcao('alguem', 'a', 'tap');
  overlay.registrarAcao('alguem', 'up', 'hold', 3000);
  overlay.registrarAcao('alguem', null, 'soltar');
  const snap = overlay.snapshot();

  const toqueA = snap.acoes.find((a) => a.botao === 'a');
  assert.strictEqual(toqueA.icone, '🅰');
  assert.strictEqual(toqueA.rotulo, 'A');
  assert.strictEqual(toqueA.tipo, 'tap');

  const holdUp = snap.acoes.find((a) => a.botao === 'up' && a.tipo === 'hold');
  assert.strictEqual(holdUp.rotulo, 'CIMA');
  assert.strictEqual(holdUp.duracaoMs, 3000);

  const soltar = snap.acoes.find((a) => a.tipo === 'soltar');
  assert.strictEqual(soltar.icone, '🔓');
  assert.strictEqual(soltar.rotulo, 'SOLTAR');
});

test('snapshot reflete pausa, conexões e versão', () => {
  overlay.setVersao('9.9.9');
  overlay.setPausado(true);
  overlay.setConexao('twitch', true);
  overlay.setConexao('youtube', false);
  const snap = overlay.snapshot();
  assert.strictEqual(snap.versao, '9.9.9');
  assert.strictEqual(snap.pausado, true);
  assert.deepStrictEqual(snap.conexoes, { twitch: true, youtube: false });
  assert.ok(Number.isFinite(snap.uptimeMs));
  // limpa para o próximo teste
  overlay.setPausado(false);
  overlay.setConexao('twitch', false);
});

test('provedores alimentam seguradas e stats do snapshot', () => {
  overlay.configurarProvedores({
    seguradas: () => [{ tecla: 'up', dono: 'joao', restanteMs: 4200 }],
    resumoStats: () => ({ total: 77, holds: 5, topUsuarios: [{ nome: 'joao', comandos: 30 }] }),
  });
  const snap = overlay.snapshot();
  assert.deepStrictEqual(snap.seguradas, [{ tecla: 'up', dono: 'joao', restanteMs: 4200 }]);
  assert.strictEqual(snap.stats.total, 77);
  assert.strictEqual(snap.stats.topUsuarios.length, 1);
  // volta ao padrão para não vazar estado
  overlay.configurarProvedores({
    seguradas: () => [],
    resumoStats: () => ({}),
  });
});

test('servidor HTTP serve a página e a API de estado', async () => {
  const porta = await overlay.iniciar(0);
  assert.ok(Number.isInteger(porta) && porta > 0, 'porta efêmera atribuída');
  assert.strictEqual(overlay.url(), `http://localhost:${porta}`);

  const raiz = await fetch(`http://127.0.0.1:${porta}/`);
  assert.strictEqual(raiz.status, 200);
  assert.match(raiz.headers.get('content-type') || '', /text\/html/);
  const html = await raiz.text();
  assert.ok(html.includes('POKÉMON'), 'página com o título do projeto');
  assert.ok(html.includes('Últimas ações'), 'página em português');
  assert.ok(html.includes('/api/estado'), 'página consulta a API');

  overlay.registrarAcao('tester', 'b', 'tap');
  const api = await fetch(`http://127.0.0.1:${porta}/api/estado`);
  assert.strictEqual(api.status, 200);
  assert.match(api.headers.get('content-type') || '', /application\/json/);
  const dados = await api.json();
  assert.ok(Array.isArray(dados.acoes));
  assert.strictEqual(dados.acoes[0].usuario, 'tester');
  assert.strictEqual(dados.acoes[0].botao, 'b');

  const naoExiste = await fetch(`http://127.0.0.1:${porta}/qualquer-coisa`);
  assert.strictEqual(naoExiste.status, 404);

  await overlay.parar();
  assert.strictEqual(overlay.url(), null);
  // depois de parar, pode subir de novo
  const porta2 = await overlay.iniciar(0);
  assert.ok(Number.isInteger(porta2) && porta2 > 0);
  await overlay.parar();
});

// ---------------------------------------------------------------------------
// Regressão v2.5.1: ícones da votação astral (🅰 💾 🔵...) não podem quebrar
// ---------------------------------------------------------------------------

test('overlay: ícone do candidato usa code point (não charAt, que quebra emojis astrais)', () => {
  // charAt(0) num surrogate pair devolve MEIO emoji (🅰 -> "\uD83C")
  const iconeA = Array.from('🅰 A')[0];
  assert.strictEqual(iconeA, '🅰');
  assert.notStrictEqual('🅰 A'.charAt(0), '🅰', 'sanidade: charAt realmente quebra');
  // a página embarcada usa a forma correta
  assert.ok(overlay.PAGINA.includes('Array.from(ICONES_BOTAO'), 'página extrai ícone por code point');
  assert.ok(!overlay.PAGINA.includes('.charAt(0)'), 'charAt(0) removido da página');
  // o rótulo também é code-point safe (split por espaço, não slice(2))
  assert.ok(overlay.PAGINA.includes('.split(/\\s+/).slice(1)'), 'rótulo do candidato divide no espaço');
});
