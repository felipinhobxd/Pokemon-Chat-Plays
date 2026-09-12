/**
 * Script auxiliar para empacotar o ChatPlays em um .exe
 * usando o pacote "pkg".
 *
 * Uso (local, no Windows):
 *   1. npm install -g pkg
 *   2. node scripts/build.js
 *
 * Uso (CI): a GitHub Action em .github/workflows/build-release.yml
 *           ja faz isso automaticamente quando voce cria uma tag.
 *
 * Documentacao do pkg: https://github.com/vercel/pkg
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

console.log('==========================================');
console.log(' Build ChatPlays - .exe');
console.log('==========================================');

// Cria pasta dist
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

console.log('[1/3] Verificando se pkg esta instalado...');
try {
  execSync('pkg --version', { stdio: 'pipe' });
  console.log('  OK');
} catch {
  console.error('  pkg nao encontrado. Instale com: npm install -g pkg');
  process.exit(1);
}

console.log('[2/3] Empacotando em .exe (Windows x64)...');
try {
  // pkg . --targets node18-win-x64 --output dist/ChatPlays.exe
  execSync(
    'pkg . --targets node18-win-x64 --output dist/ChatPlays.exe --compress GZip',
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('  OK');
} catch (err) {
  console.error('  Erro ao empacotar:', err.message);
  process.exit(1);
}

console.log('[3/4] Copiando arquivos auxiliares...');
const arquivosCopiar = ['.env.example', 'README.md', 'LICENSE', 'iniciar.bat'];
for (const arq of arquivosCopiar) {
  const origem = path.join(ROOT, arq);
  const destino = path.join(DIST, arq);
  if (fs.existsSync(origem)) {
    fs.copyFileSync(origem, destino);
    console.log(`  ${arq} copiado.`);
  }
}
const docsDist = path.join(DIST, 'docs');
fs.mkdirSync(docsDist, { recursive: true });
// v3.3.1: todo .md de docs/ citado pelo README acompanha o pacote — a
// lista é conferida por src/tests/empacotamento.test.js (drift = build falha).
for (const arq of ['GAMEPAD.md', 'PERFIS.md', 'MINECRAFT-ATLAUNCHER.md']) {
  const origem = path.join(ROOT, 'docs', arq);
  if (fs.existsSync(origem)) fs.copyFileSync(origem, path.join(docsDist, arq));
}

// v3.1: gamepad virtual — ViGEmClient.dll ao lado do exe + driver + licenças.
// A DLL não fica no repositório: o workflow de release a compila a partir do
// código-fonte OFICIAL (nefarius/ViGEmClient) e deposita em dist/ antes do
// NSIS. Build local sem a DLL apenas avisa (teclado/mouse seguem normais).
const dllOrigem = path.join(ROOT, 'ViGEmClient.dll');
if (fs.existsSync(dllOrigem)) {
  fs.copyFileSync(dllOrigem, path.join(DIST, 'ViGEmClient.dll'));
  console.log('  ViGEmClient.dll copiado.');
} else if (fs.existsSync(path.join(DIST, 'ViGEmClient.dll'))) {
  console.log('  ViGEmClient.dll já presente em dist/ (gerado pelo CI).');
} else {
  console.log('  [AVISO] ViGEmClient.dll ausente — gamepad virtual não irá nesta build local.');
  console.log('          O release oficial gera a DLL do código-fonte oficial no CI.');
}

// Driver ViGEmBus (instalador oficial Nefarius commitado no repositório) +
// licenças dos componentes de terceiros
for (const [origemRel, destinoRel] of [
  ['drivers/ViGEmBus_1.22.0_x64_x86_arm64.exe', 'drivers/ViGEmBus_1.22.0_x64_x86_arm64.exe'],
  ['licenses/ViGEmBus-LICENSE.txt', 'licenses/ViGEmBus-LICENSE.txt'],
  ['licenses/ViGEmClient-LICENSE.txt', 'licenses/ViGEmClient-LICENSE.txt'],
]) {
  const origem = path.join(ROOT, origemRel);
  const destino = path.join(DIST, destinoRel);
  if (fs.existsSync(origem)) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origem, destino);
    console.log(`  ${origemRel} copiado.`);
  } else {
    console.error(`  [ERRO] Faltou ${origemRel} — build de release não pode seguir sem.`);
    process.exit(1);
  }
}

console.log('[4/4] Gerando instalador setup.exe (opcional — exige NSIS)...');
try {
  const { version } = require(path.join(ROOT, 'package.json'));
  execSync(
    `makensis -DVERSION=${version} -DFILESDIR=dist installer.nsi`,
    { stdio: 'inherit', cwd: ROOT }
  );
  if (fs.existsSync(path.join(ROOT, 'ChatPlays-Setup.exe'))) {
    fs.copyFileSync(path.join(ROOT, 'ChatPlays-Setup.exe'), path.join(DIST, 'ChatPlays-Setup.exe'));
    console.log('  ChatPlays-Setup.exe gerado.');
  }
} catch {
  console.log('  makensis não encontrado — pulando o instalador (o CI gera na release).');
  console.log('  Instale o NSIS em https://nsis.sourceforge.io/ se quiser gerar localmente.');
}

console.log('\n[OK] Build concluido!');
console.log(`Os arquivos estao em: ${DIST}`);
console.log('Distribua o ChatPlays-Setup.exe (instalador com atalhos e');
console.log('desinstalador) ou o conteudo da pasta dist junto com o iniciar.bat.');
