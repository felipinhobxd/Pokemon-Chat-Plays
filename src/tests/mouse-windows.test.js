'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const mouse = require('../controllers/mouse');

test('worker do mouse compila e inicia no Windows PowerShell 5.1', {
  skip: process.platform !== 'win32',
  timeout: 30000,
}, async () => {
  const fonte = mouse.__test.fonteWorker();
  const encoded = Buffer.from(fonte, 'utf16le').toString('base64');

  const resultado = await new Promise((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
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

  assert.strictEqual(
    resultado.codigo,
    0,
    `worker não compilou/iniciou:\n${resultado.stderr || resultado.stdout}`
  );
  assert.doesNotMatch(resultado.stderr, /Add-Type|error CS\d+|Unable to find type/i);
});
