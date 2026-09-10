/**
 * Testes do modo DEMOCRACIA/ANARQUIA (v2.5).
 *
 * Cobre: contagem de votos, troca de voto, empate (primeiro voto vence),
 * janela de votação (executor chamado com o vencedor + reagenda), anti
 * flip-flop do chat, isenção do streamer, status() para o overlay e o
 * contrato do ouvinte de mudança de modo.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const votacao = require('../utils/votacao');

/** Espera ms (para as janelas fecharem sozinhas). */
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reseta o módulo e acerta janelas curtas (50ms) para os testes. */
function preparar() {
  votacao.resetar();
  votacao.configurar({ intervaloMs: 50, trocaMinMs: 30000 });
}

test('padrão é anarquia e voto não é aceito fora da democracia', () => {
  preparar();
  assert.strictEqual(votacao.modoAtual(), 'anarquia');
  assert.strictEqual(votacao.votar('up', 'fulano'), false);
});

test('definirModo rejeita modo desconhecido e modo repetido', () => {
  preparar();
  assert.deepStrictEqual(votacao.definirModo('caos'), { mudou: false, motivo: 'modo desconhecido' });
  assert.deepStrictEqual(votacao.definirModo('anarquia', 'api'), { mudou: false, motivo: 'já está neste modo' });
});

test('em democracia: voto é aceito, contado e aparece no status', () => {
  preparar();
  votacao.definirModo('democracia', 'api');
  assert.strictEqual(votacao.votar('up', 'a'), true);
  assert.strictEqual(votacao.votar('up', 'b'), true);
  assert.strictEqual(votacao.votar('down', 'c'), true);
  const st = votacao.status();
  assert.strictEqual(st.modo, 'democracia');
  assert.strictEqual(st.totalVotantes, 3);
  const up = st.candidatos.find((c) => c.botao === 'up');
  const down = st.candidatos.find((c) => c.botao === 'down');
  assert.strictEqual(up.votos, 2);
  assert.strictEqual(down.votos, 1);
});

test('trocar de voto: o ÚLTIMO vale (voto anterior sai da contagem)', () => {
  preparar();
  votacao.definirModo('democracia', 'api');
  votacao.votar('up', 'a');
  votacao.votar('up', 'b');
  votacao.votar('down', 'a'); // 'a' trocou de up para down
  const st = votacao.status();
  const up = st.candidatos.find((c) => c.botao === 'up');
  const down = st.candidatos.find((c) => c.botao === 'down');
  assert.strictEqual(up.votos, 1, 'up deve ter só o voto de b');
  assert.strictEqual(down.votos, 1);
  assert.strictEqual(st.totalVotantes, 2);
});

test('voto repetido no mesmo botão é idempotente (não infla)', () => {
  preparar();
  votacao.definirModo('democracia', 'api');
  votacao.votar('up', 'a');
  votacao.votar('up', 'a');
  votacao.votar('up', 'a');
  const st = votacao.status();
  assert.strictEqual(st.candidatos[0].votos, 1);
  assert.strictEqual(st.totalVotantes, 1);
});

test('janela fecha: executor recebe o MAIS VOTADO e a próxima janela abre', async () => {
  preparar();
  let chamadas = 0;
  let recebido = null;
  votacao.configurarExecutor((v) => {
    chamadas += 1;
    recebido = v;
  });
  votacao.definirModo('democracia', 'api');
  votacao.votar('a', 'x');
  votacao.votar('a', 'y');
  votacao.votar('b', 'z');
  await esperar(120); // janela de 50ms fecha
  assert.strictEqual(chamadas, 1, 'executor chamado 1x');
  assert.strictEqual(recebido.botao, 'a');
  assert.strictEqual(recebido.votos, 2);
  assert.strictEqual(recebido.eleitores, 2);
  // votos zerados para a próxima janela
  assert.strictEqual(votacao.status().totalVotantes, 0);
  // janela seguinte aberta (restante > 0)
  assert.ok(votacao.status().restanteMs > 0);
});

test('empate: ganha quem RECEBEU O PRIMEIRO VOTO', async () => {
  preparar();
  let recebido = null;
  votacao.configurarExecutor((v) => { recebido = v; });
  votacao.definirModo('democracia', 'api');
  votacao.votar('up', 'a'); // primeiro voto é em up
  votacao.votar('down', 'b');
  votacao.votar('down', 'c');
  votacao.votar('up', 'd'); // empate 2x2 — up chegou primeiro
  await esperar(120);
  assert.strictEqual(recebido.botao, 'up');
});

test('executor ausente ou com erro não derruba a janela seguinte', async () => {
  preparar();
  votacao.configurarExecutor(() => { throw new Error('boom'); });
  votacao.definirModo('democracia', 'api');
  votacao.votar('start', 'a');
  await esperar(120); // janela explode no executor e segue
  const st = votacao.status();
  assert.strictEqual(st.modo, 'democracia');
  assert.ok(st.restanteMs > 0, 'próxima janela agendada mesmo com executor falhando');
});

test('anti flip-flop: chat não troca duas vezes seguidas rápido', () => {
  preparar();
  const r1 = votacao.definirModo('democracia', 'chat @a');
  assert.strictEqual(r1.mudou, true);
  const r2 = votacao.definirModo('anarquia', 'chat @b');
  assert.strictEqual(r2.mudou, false, 'chat deve ser bloqueado');
  assert.strictEqual(r2.motivo, 'troca recente');
  assert.ok(r2.esperaMs > 0);
  // o streamer (tecla/terminal) passa direto
  const r3 = votacao.definirModo('anarquia', 'tecla streamer');
  assert.strictEqual(r3.mudou, true);
});

test('comando do dono do canal (streamer-cmd) ignora o anti flip-flop', () => {
  preparar();
  votacao.definirModo('democracia', 'chat @a');
  const r = votacao.definirModo('anarquia', 'streamer-cmd @dono');
  assert.strictEqual(r.mudou, true);
});

test('alternarModo alterna entre os dois modos', () => {
  preparar();
  assert.strictEqual(votacao.modoAtual(), 'anarquia');
  votacao.alternarModo('api');
  assert.strictEqual(votacao.modoAtual(), 'democracia');
  votacao.alternarModo('api');
  assert.strictEqual(votacao.modoAtual(), 'anarquia');
});

test('ouvinte de mudança recebe (modo, origem) e pode ser cancelado', () => {
  preparar();
  const eventos = [];
  const cancelar = votacao.observar((modo, origem) => eventos.push(`${modo}|${origem}`));
  votacao.definirModo('democracia', 'tecla streamer');
  cancelar();
  votacao.definirModo('anarquia', 'tecla streamer');
  assert.deepStrictEqual(eventos, ['democracia|tecla streamer']);
});

test('ouvinte com erro não quebra a troca de modo', () => {
  preparar();
  votacao.observar(() => { throw new Error('ouvinte ruim'); });
  const r = votacao.definirModo('democracia', 'api');
  assert.strictEqual(r.mudou, true);
  assert.strictEqual(votacao.modoAtual(), 'democracia');
});

test('voltar para anarquia zera os votos e para a janela', async () => {
  preparar();
  votacao.definirModo('democracia', 'api');
  votacao.votar('up', 'a');
  votacao.definirModo('anarquia', 'tecla streamer');
  const st = votacao.status();
  assert.strictEqual(st.modo, 'anarquia');
  assert.strictEqual(st.candidatos.length, 0);
  assert.strictEqual(st.restanteMs, 0);
  await esperar(120); // nenhum executor dispara depois de sair da democracia
});

test('status() corta a lista em 4 candidatos (layout do overlay)', () => {
  preparar();
  votacao.definirModo('democracia', 'api');
  for (let i = 0; i < 8; i++) {
    votacao.votar('up', `u${i}`);
    votacao.votar(`botao${i}`, `v${i}`); // 8 candidatos extras
  }
  assert.strictEqual(votacao.status().candidatos.length, 4);
});

test('configurar aplica pisos (intervalo >= 50ms, troca >= 0)', () => {
  preparar();
  votacao.configurar({ intervaloMs: 1, trocaMinMs: -5 });
  const st = votacao.status();
  assert.strictEqual(st.intervaloMs, 50);
});

test('janela curta: 2 janelas seguidas executam 2 vencedores', async () => {
  preparar();
  const vencedores = [];
  votacao.configurarExecutor((v) => vencedores.push(v.botao));
  votacao.definirModo('democracia', 'api');
  votacao.votar('left', 'a');
  await esperar(120); // janela 1
  votacao.votar('right', 'b');
  await esperar(120); // janela 2
  assert.deepStrictEqual(vencedores, ['left', 'right']);
});

// ---------------------------------------------------------------------------
// Regressão v2.5.1: o vencedor da votação NÃO executa com o chat pausado
// (o mesmo guarda-corpo que o index.js instala no executor de verdade)
// ---------------------------------------------------------------------------

const pausa = require('../utils/pausa');

test('regressão pausa: vencedor da democracia é IGNORADO com o chat pausado', async () => {
  preparar();
  pausa.resetar();
  const executados = [];
  // executor com o MESMO guarda-corpo do index.js (configurarVotacao)
  votacao.configurarExecutor((v) => {
    if (pausa.estaPausado()) return; // chat pausado: não toca no jogo
    executados.push(v.botao);
  });

  pausa.definir(true, 'teste'); // streamer pausou (F9)
  votacao.definirModo('democracia', 'api');
  votacao.votar('up', 'alguem');
  await esperar(120); // janela fechou com o chat pausado
  assert.strictEqual(executados.length, 0, 'vencedor NÃO pode executar pausado');

  pausa.definir(false, 'teste'); // streamer liberou
  votacao.votar('down', 'alguem');
  votacao.votar('down', 'outra');
  await esperar(120); // próxima janela, chat liberado
  assert.deepStrictEqual(executados, ['down'], 'com o chat livre o vencedor executa');
  pausa.resetar();
});
