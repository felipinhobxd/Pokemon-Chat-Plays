/**
 * Script auxiliar para empacotar o Pokemon Chat Plays em um .exe
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
console.log(' Build Pokemon Chat Plays - .exe');
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
  // pkg . --targets node18-win-x64 --output dist/PokemonChatPlays.exe
  execSync(
    'pkg . --targets node18-win-x64 --output dist/PokemonChatPlays.exe --compress GZip',
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('  OK');
} catch (err) {
  console.error('  Erro ao empacotar:', err.message);
  process.exit(1);
}

console.log('[3/3] Copiando arquivos auxiliares...');
const arquivosCopiar = ['.env.example', 'README.md', 'LICENSE', 'iniciar.bat'];
for (const arq of arquivosCopiar) {
  const origem = path.join(ROOT, arq);
  const destino = path.join(DIST, arq);
  if (fs.existsSync(origem)) {
    fs.copyFileSync(origem, destino);
    console.log(`  ${arq} copiado.`);
  }
}

console.log('\n[OK] Build concluido!');
console.log(`Os arquivos estao em: ${DIST}`);
console.log('Distribua o conteudo da pasta dist junto com o iniciar.bat.');
