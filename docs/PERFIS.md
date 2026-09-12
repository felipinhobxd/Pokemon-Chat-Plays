# Perfis por jogo

O ChatPlays pode guardar configuracoes diferentes para cada jogo sem misturar credenciais da Twitch/YouTube.

Cada perfil lembra executavel/ROM, argumentos, modo de teclado, modo e passo do mouse, tempos de tecla/cooldown/hold, configuracao basica da votacao e a lista completa de controles/aliases do chat.

As credenciais da Twitch e do YouTube, overlay e outras configuracoes globais continuam fora dos perfis.

## Primeiro uso

Na primeira inicializacao desta versao, o ChatPlays cria automaticamente um perfil usando a configuracao atual. Se houver uma ROM configurada, o nome inicial tenta usar o nome dela; caso contrario usa o executavel do jogo.

O perfil ativo fica salvo em `dados/perfis.json`.

## Gerenciar perfis

No Windows:

```bat
iniciar.bat --perfis
```

Em desenvolvimento:

```bash
npm run perfis
```

No menu voce pode:

- ativar um perfil;
- criar um novo perfil a partir da configuracao atual;
- duplicar o perfil ativo;
- renomear;
- excluir perfis inativos.

Depois de ativar um perfil uma vez, ele fica lembrado para os proximos boots.

Tambem e possivel iniciar diretamente com um perfil especifico:

```bat
iniciar.bat --perfil "Pokemon Emerald"
```

ou:

```bash
node src/boot.js --perfil "Minecraft"
```

## Como as alteracoes sao preservadas

O `.env` e `dados/controles.json` continuam sendo a configuracao de trabalho do ChatPlays. Portanto o assistente existente continua funcionando normalmente.

Antes de trocar para outro perfil, o ChatPlays sincroniza automaticamente o perfil atual com as alteracoes feitas no assistente. Assim voce pode editar os controles de Pokemon, depois trocar para Minecraft, e ao voltar para Pokemon os controles anteriores continuam la.

A troca preserva chaves e configuracoes globais que nao pertencem ao jogo, inclusive tokens da Twitch e a chave da API do YouTube.

## Exemplo

**Pokemon Emerald**

- VBA-M ou mGBA;
- ROM do Pokemon Emerald;
- teclado em modo janela;
- mouse desligado/janela conforme preferencia;
- comandos `cima`, `baixo`, `a`, `b`, `salvar`, etc.

**Minecraft**

- executavel do Minecraft/launcher escolhido;
- sem ROM;
- teclado + mouse;
- controles personalizados como `pular`, `agachar`, `inventario`, `andar`.

O gamepad virtual já é suportado. `GAMEPAD_ENABLED`, `GAMEPAD_TAP_MS` e `GAMEPAD_ANALOG_MS` acompanham cada perfil; `GAMEPAD_VIGEM_DLL` continua global porque é um caminho específico deste PC.
