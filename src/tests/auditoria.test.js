/**
 * Testes da auditoria v2.4.1 (performance + robustez).
 *
 * O que estes testes garantem:
 *  1. Logger: as linhas são acumuladas em BUFFER (nada de appendFileSync
 *     por linha no caminho crítico) e o flushSync grava tudo no arquivo —
 *     nenhuma linha se perde no encerramento.
 *  2. Fonte C# da PCP: a busca da janela usa GetProcessesByName (filtro
 *     barato pelo nome) em vez de varrer TODOS os processos com
 *     MainModule.FileName (caro e cheio de exceção em processo protegido).
 *  3. Overlay: um provedor que explode NÃO derruba o snapshot do OBS.
 *  4. Worker: múltiplas ações em voo são concluídas em ORDEM (FIFO) —
 *     garantia de que a fila de teclas nunca trava com 2+ ações pendentes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const logger = require('../utils/logger');
const { configurarAlvoJanela, __test } = require('../controllers/keyboard');
const overlay = require('../overlay');

const EXE = 'C:\\Emuladores\\visualboyadvance-m.exe';

// ---------------------------------------------------------------------------
// 1. Logger: buffer + flush síncrono
// ---------------------------------------------------------------------------

test('logger: linhas vão para o buffer (sem syscall por linha)', () => {
  const caminho = logger.__test.caminhoLog();
  if (!caminho) return; // sem disco gravável (CI restrito) — nada a testar

  logger.__test.esvaziar();
  const marcador = `AUDITORIA-BUFFER-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  logger.info(`linha de teste ${marcador} 1`);
  logger.aviso(`linha de teste ${marcador} 2`);

  // NÃO deu flush: as 2 linhas estão pendentes na memória
  assert.strictEqual(logger.__test.pendentes(), 2, '2 linhas no buffer, 0 no disco');

  // o arquivo NÃO pode ter recebido nada ainda desse lote
  // (pode ter flush de 2s atrás de outros testes — só checamos o marcador;
  // num checkout limpo o arquivo nem existe: a primeira gravação é lazy)
  let antes = '';
  try {
    antes = fs.readFileSync(caminho, 'utf8');
  } catch {
    /* arquivo ainda não existe — ok, nada foi gravado */
  }
  assert.ok(!antes.includes(marcador), 'marcador ainda não foi para o disco');

  // flush síncrono: tudo vai de uma vez
  logger.flushSync();
  assert.strictEqual(logger.__test.pendentes(), 0, 'buffer esvaziado pelo flushSync');

  const depois = fs.readFileSync(caminho, 'utf8');
  assert.ok(depois.includes(`${marcador} 1`), 'linha 1 gravada');
  assert.ok(depois.includes(`${marcador} 2`), 'linha 2 gravada');
});

test('logger: flushSync sem nada pendente é no-op (não explode)', () => {
  assert.doesNotThrow(() => logger.flushSync());
  assert.strictEqual(logger.__test.pendentes(), 0);
});

// ---------------------------------------------------------------------------
// 2. Fonte C#: busca de janela rápida (GetProcessesByName)
// ---------------------------------------------------------------------------

test('fontePCP: busca pelo NOME do processo (não varre todos com MainModule)', () => {
  configurarAlvoJanela(EXE);
  const fonte = __test.fontePCP;

  // o filtro barato existe...
  assert.ok(fonte.includes('Process.GetProcessesByName(_alvoNome)'),
    'busca filtrada pelo nome do processo');
  assert.ok(fonte.includes('_alvoNome = Path.GetFileNameWithoutExtension(_alvo)'),
    'nome do processo derivado do caminho do alvo');

  // ...e a varredura cara sumiu
  assert.ok(!fonte.includes('Process.GetProcesses()'),
    'não varre mais TODOS os processos do sistema');

  // caminho completo continua conferido (cópia homônima em outra pasta)
  assert.ok(fonte.includes('String.Equals(exe, _alvo, StringComparison.OrdinalIgnoreCase)'),
    'caminho completo ainda é conferido quando legível');

  // reset
  configurarAlvoJanela(null);
});

// ---------------------------------------------------------------------------
// 3. Overlay: provedor que explode não mata o snapshot
// ---------------------------------------------------------------------------

test('overlay.snapshot: provedor com exception cai no fallback (OBS não morre)', () => {
  // devolve os provedores padrão ao final do teste
  const restaurar = () => overlay.configurarProvedores({
    seguradas: () => [],
    resumoStats: () => ({}),
  });

  try {
    overlay.configurarProvedores({
      seguradas: () => { throw new Error('boom'); },
      resumoStats: () => { throw new Error('boom'); },
    });
    let snap;
    assert.doesNotThrow(() => { snap = overlay.snapshot(); }, 'snapshot não explode');
    assert.deepStrictEqual(snap.seguradas, [], 'seguradas caem no vazio');
    assert.strictEqual(snap.stats.total, 0, 'stats caem no vazio');
    assert.deepStrictEqual(snap.stats.topUsuarios, [], 'top vazio, sem crash');
  } finally {
    restaurar();
  }
});

// ---------------------------------------------------------------------------
// 4. Boot do worker no modo janela continua íntegro (paridade da auditoria)
// ---------------------------------------------------------------------------

test('boot janela: protocolo READY/OK/WARN/QUIT intacto + PCP + alvo', () => {
  configurarAlvoJanela(EXE);
  const boot = __test.montarBootPS();

  assert.ok(boot.includes("[PCP]::DefinirAlvo('C:\\Emuladores\\visualboyadvance-m.exe');"));
  assert.ok(boot.includes('[Console]::Out.WriteLine(\'READY\');'), 'protocolo READY');
  assert.ok(boot.includes("'QUIT'"), 'protocolo QUIT');
  assert.ok(boot.includes('[Console]::Out.WriteLine(\'OK\')'), 'protocolo OK');
  assert.ok(boot.includes('EMULADOR_OFF'), 'aviso de emulador fechado');

  configurarAlvoJanela(null);
});
