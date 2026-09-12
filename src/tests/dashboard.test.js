'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { PAGINA_DASHBOARD } = require('../dashboard-pagina');
const overlay = require('../overlay');
const teclado = require('../controllers/keyboard');
const logger = require('../utils/logger');
const { CooldownManager } = require('../utils/cooldown');

test('passo 6: página do painel é embutida, local e usa /api/estado', () => {
  assert.match(PAGINA_DASHBOARD, /ChatPlays — Painel ao vivo/);
  assert.match(PAGINA_DASHBOARD, /\/api\/estado/);
  assert.match(PAGINA_DASHBOARD, /Cooldown \/ anti-spam/);
  assert.match(PAGINA_DASHBOARD, /Fila de input/);
  assert.doesNotMatch(PAGINA_DASHBOARD, /https?:\/\//);
});

test('passo 6: snapshot aceita diagnóstico sem quebrar a overlay antiga', () => {
  overlay.configurarProvedores({
    diagnostico: () => ({ teclado: { fila: 2 }, cooldown: { bloqueios: { usuario: 3 } } }),
  });
  const s = overlay.snapshot();
  assert.strictEqual(s.diagnostico.teclado.fila, 2);
  assert.strictEqual(s.diagnostico.cooldown.bloqueios.usuario, 3);
  assert.ok(Number.isFinite(s.geradoEm));
  overlay.configurarProvedores({ diagnostico: () => ({}) });
});

test('passo 6: teclado expõe somente diagnóstico operacional', () => {
  const d = teclado.diagnostico();
  assert.ok(['global', 'janela'].includes(d.modo));
  assert.ok(Number.isInteger(d.fila));
  assert.ok(Number.isInteger(d.filaMax));
  assert.ok(Number.isInteger(d.descartados));
  assert.strictEqual(typeof d.worker.pronto, 'boolean');
});

test('passo 6: cooldown conta bloqueios sem mudar a decisão', () => {
  const c = new CooldownManager({ cooldownMs: 1000, cooldownGlobalMs: 0 });
  assert.strictEqual(c.podeExecutar('viewer', 'a').permitido, true);
  c.registrarExecucao('viewer', 'a');
  assert.strictEqual(c.podeExecutar('viewer', 'b').permitido, false);
  const d = c.diagnostico();
  assert.strictEqual(d.bloqueios.usuario, 1);
  assert.strictEqual(d.baseMs, 1000);
});

test('passo 6: avisos recentes mascaram token/key antes de chegar ao painel', () => {
  logger.aviso('teste token=segredo123 key=abc123?x=1 oauth:nao-mostrar');
  const ultimo = logger.recentes(1)[0];
  assert.ok(ultimo);
  assert.doesNotMatch(ultimo.mensagem, /segredo123|abc123|nao-mostrar/);
  assert.match(ultimo.mensagem, /\*\*\*/);
});

// ---------------------------------------------------------------------------
// v3.1.x — painel mostra o circuit breaker de quota do YouTube
// ---------------------------------------------------------------------------

test('painel: estado SUSPENSO — QUOTA do YouTube aparece com botão de reativar', () => {
  // pill de suspensão + botão (só existem no estado suspenso)
  assert.match(PAGINA_DASHBOARD, /SUSPENSO — QUOTA/);
  assert.match(PAGINA_DASHBOARD, /reativarYt/);
  assert.match(PAGINA_DASHBOARD, /\/api\/reativar-youtube/);
  // a pill/botão não pedem nem ecoam credenciais: nada de campos de input
  assert.doesNotMatch(PAGINA_DASHBOARD, /<input[^>]*type=["']?password/i);
  assert.doesNotMatch(PAGINA_DASHBOARD, /YOUTUBE_API_KEY|YOUTUBE_VIDEO_ID/i);
});
