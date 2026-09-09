/**
 * Script de configuracao inicial (opcional).
 * Ajuda o usuario a preencher o arquivo .env de forma interativa.
 *
 * Uso: npm run setup
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_EXAMPLE = path.join(process.cwd(), '.env.example');
const ENV_FILE = path.join(process.cwd(), '.env');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Pergunta ao usuario com valor padrao.
 */
function perguntar(pergunta, padrao = '') {
  return new Promise((resolve) => {
    const sufixo = padrao ? ` [${padrao}]` : '';
    rl.question(`${pergunta}${sufixo}: `, (res) => {
      resolve(res.trim() || padrao);
    });
  });
}

async function main() {
  console.log('\n==========================================');
  console.log(' Configuracao do Pokemon Chat Plays');
  console.log('==========================================\n');

  if (fs.existsSync(ENV_FILE)) {
    const resp = await perguntar('Ja existe um arquivo .env. Deseja sobrescreve-lo? (s/N)', 'n');
    if (resp.toLowerCase() !== 's' && resp.toLowerCase() !== 'sim') {
      console.log('Operacao cancelada.');
      rl.close();
      return;
    }
  }

  let conteudo = '';
  try {
    conteudo = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  } catch {
    console.log('Aviso: .env.example nao encontrado. Criando do zero.');
  }

  console.log('\nPreencha os valores (deixe em branco para manter o padrao):\n');

  const botUser = await perguntar('Nome de usuario do bot Twitch', 'seu_bot_aqui');
  console.log('\n  [Para gerar o token OAuth abaixo]');
  console.log('  1. Acesse: https://twitchtokengenerator.com/');
  console.log('  2. Marque a opcao "Chat Token"');
  console.log('  3. Clique em "Generate Token!" e autorize.');
  console.log('  4. Copie o token no formato oauth:xxxx...\n');
  const oauth = await perguntar('Token OAuth do bot (gerar em twitchtokengenerator.com)');
  const canal = await perguntar('Canal Twitch a monitorar', 'sindromegames');

  console.log('\n--- YouTube (opcional) ---');
  const ytAtivo = await perguntar('Ativar YouTube? (s/N)', 'n');
  const ytAtivoBool = ['s', 'sim', 'true', '1'].includes(ytAtivo.toLowerCase());

  let ytKey = '';
  let ytVideo = '';
  if (ytAtivoBool) {
    ytKey = await perguntar('Chave de API do YouTube');
    ytVideo = await perguntar('ID do video da live');
  }

  // Substitui valores no conteudo
  conteudo = conteudo
    .replace(/TWITCH_BOT_USERNAME=.*/, `TWITCH_BOT_USERNAME=${botUser}`)
    .replace(/TWITCH_OAUTH_TOKEN=.*/, `TWITCH_OAUTH_TOKEN=${oauth}`)
    .replace(/TWITCH_CHANNEL=.*/, `TWITCH_CHANNEL=${canal}`)
    .replace(/YOUTUBE_ENABLED=.*/, `YOUTUBE_ENABLED=${ytAtivoBool}`)
    .replace(/YOUTUBE_API_KEY=.*/, `YOUTUBE_API_KEY=${ytKey}`)
    .replace(/YOUTUBE_VIDEO_ID=.*/, `YOUTUBE_VIDEO_ID=${ytVideo}`)
    .replace(/ACTIVE_PLATFORMS=.*/, `ACTIVE_PLATFORMS=${ytAtivoBool ? 'twitch,youtube' : 'twitch'}`);

  fs.writeFileSync(ENV_FILE, conteudo, 'utf8');
  console.log('\n[OK] Arquivo .env criado com sucesso!');
  console.log('Agora voce pode rodar: npm start\n');
  rl.close();
}

main();
