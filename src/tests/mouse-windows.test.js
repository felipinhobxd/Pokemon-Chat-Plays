'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const mouse = require('../controllers/mouse');

test('worker do mouse compila e inicia no Windows PowerShell 5.1', {
  skip: process.platform !== 'win32',
  timeout: 30000,
}, async () => {
  const arquivo = mouse.__test.criarArquivoWorker();
  let resultado;
  try {
    resultado = await new Promise((resolve, reject) => {
      const proc = spawn(
        'powershell.exe',
        mouse.__test.argumentosPowerShellWorker(arquivo),
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
      let stdout = '';
      let stderr = '';
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (d) => { stdout += String(d); });
      proc.stderr.on('data', (d) => { stderr += String(d); });
      proc.on('error', reject);
      proc.on('close', (codigo) => resolve({ codigo, stdout, stderr }));

      // EOF encerra o loop residente logo depois de o Add-Type compilar o C#.
      proc.stdin.end();
    });
  } finally {
    mouse.__test.limparArquivoWorker(arquivo);
  }

  assert.strictEqual(
    resultado.codigo,
    0,
    `worker não compilou/iniciou:\n${resultado.stderr || resultado.stdout}`
  );
  assert.match(resultado.stdout, /READY/);
  assert.doesNotMatch(resultado.stderr, /Add-Type|error CS\d+|Unable to find type/i);
});
