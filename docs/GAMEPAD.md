# Gamepad virtual (Passo 3)

O ChatPlays pode transformar comandos do Twitch/YouTube em um **controle Xbox 360 virtual** no Windows. Os comandos de gamepad usam um prefixo próprio para não colidir com os controles de teclado já existentes.

## Requisito no Windows

A implementação usa **ViGEmBus + ViGEmClient.dll** (projetos oficiais do Nefarius, hoje arquivados/aposentados — funcionam perfeitamente para este fim).

**No instalador e no ZIP portátil** (v3.1+) já vem tudo:

- `ViGEmClient.dll` (x64) ao lado do `ChatPlays.exe`, compilado pelo nosso CI a partir do código-fonte oficial `nefarius/ViGEmClient` (tag `v1.16.18.0`, MIT);
- `drivers\ViGEmBus_1.22.0_x64_x86_arm64.exe` — instalador oficial do driver, verificado por SHA-256 e assinatura Authenticode (Nefarius Software Solutions e.U.);
- `licenses\` com as licenças (MIT do ViGEmClient, BSD-3 do ViGEmBus).

O instalador do ChatPlays **detecta** se o ViGEmBus já está presente (serviço do Windows):

1. já instalado → não faz nada;
2. ausente → pergunta se quer instalar agora (o Windows pede administrador; em instalação silenciosa `/S` o driver NÃO é instalado — fica a critério do usuário);
3. falha → avisa claramente e segue o resto da instalação normalmente.

O driver **nunca é desinstalado** junto com o ChatPlays (outros softwares podem usá-lo). O ZIP portátil NÃO instala driver nenhum automaticamente: quem quiser o gamepad executa `drivers\ViGEmBus_1.22.0_x64_x86_arm64.exe` na mão (uma vez só).

Instalação manual (fonte oficial): repositório `nefarius/ViGEmBus` → Releases → `ViGEmBus_1.22.0_x64_x86_arm64.exe`. **Nunca baixe DLLs de sites de "DLL download".**

Se o driver/DLL não estiver disponível, o bot **continua funcionando normalmente** com teclado/mouse e o painel de diagnóstico (`http://localhost:8899/dashboard`) mostra a situação exata (ver abaixo).

## Comandos do chat

Não usam `!`.

```text
pad a
pad b
pad x
pad y
pad lb
pad rb
pad start
pad select
pad l3
pad r3

pad cima
pad baixo
pad esquerda
pad direita
pad dpad cima

pad ls cima
pad ls baixo
pad ls esquerda
pad ls direita
pad rs cima
pad rs 50 -25

pad lt
pad rt
pad lt 40
pad rt 75

pad soltar
```

`ls`/`rs` são os analógicos esquerdo/direito. Coordenadas usam `-100..100`. Gatilhos usam `0..100%`.

A duração padrão é curta, própria para comandos de chat. Também é possível informar uma duração:

```text
pad a 500ms
pad ls direita 2s
pad rt 100 1s
```

O limite é 10 segundos.

## HOLD de gamepad (v3.1)

Os mesmos verbos de hold do teclado funcionam no namespace `pad`, com a **mesma faixa de 1ms a 10s** (segundos decimais incluídos):

```text
hold pad a 250ms         hold pad x 2s
hold pad rb 500ms        hold pad a 3          (número puro = segundos)
hold pad rt 75 500ms     hold pad lt 100 2s    (gatilho: intensidade + tempo)
hold pad ls direita 250ms
hold pad rs -50 80 1.5s  (coordenadas + tempo)
segurar pad a 1ms
```

- **Botão**: pressionado → duração → solto.
- **Gatilho**: intensidade pedida → duração → volta a 0.
- **Analógico**: posição pedida → duração → **centro exato**.

Em gatilho/analógico, um número puro no fim é intensidade/coordenada — a duração nesses casos pede sufixo explícito (`ms`/`s`). `hold pad a 3` (botão) continua significando 3 segundos, igual ao teclado.

## Segurança

- `pad soltar` neutraliza botões, analógicos e gatilhos.
- O comando global `soltar` também neutraliza o gamepad antes de liberar as teclas e os botões do mouse.
- Pausar o ChatPlays (F9) neutraliza o gamepad automaticamente.
- Comandos de gamepad respeitam o cooldown normal do chat (holds usam as chaves `hold:pad:a`, `hold:pad:rt`, `hold:pad:ls`... — o grupo `hold` do `COMMAND_COOLDOWNS` continua valendo).
- No modo **democracia**, gamepad (incluindo hold) fica bloqueado por enquanto. Votação analógica precisa de agregação própria para não furar a votação existente.
- Trocar de hold no mesmo botão substitui o timer antigo — um `hold pad a 10s` seguido de `hold pad a 2s` nunca é solto "na hora errada" pelo timer velho.

## Diagnóstico

O painel `http://localhost:8899/dashboard` mostra a **situação exata** do gamepad — nunca um "indisponível" genérico:

| Situação | Significado |
|---|---|
| DESATIVADO | `GAMEPAD_ENABLED=off` |
| AGUARDANDO COMANDO | modo `auto`: cria no primeiro comando `pad` |
| CONTROLE CRIADO | pronto — Xbox virtual funcionando |
| DLL AUSENTE | `ViGEmClient.dll` não está ao lado do exe |
| DLL NÃO É x64 | a DLL encontrada é de outra arquitetura |
| DLL NÃO CARREGA | encontrada, mas o Windows recusou o carregamento |
| DRIVER ViGEmBus AUSENTE | instale `drivers\ViGEmBus_1.22.0_x64_x86_arm64.exe` |

Teclado e mouse continuam normais em qualquer uma dessas situações.

## Configuração

```dotenv
# auto = tenta criar o gamepad só ao receber um comando `pad`
# on   = cria o gamepad no boot
# off  = desativa
GAMEPAD_ENABLED=auto

# Opcional. Se vazio, procura ViGEmClient.dll ao lado do app.
GAMEPAD_VIGEM_DLL=

# Duração padrão de botões e de analógicos/gatilhos
GAMEPAD_TAP_MS=220
GAMEPAD_ANALOG_MS=320
```

`GAMEPAD_ENABLED`, `GAMEPAD_TAP_MS` e `GAMEPAD_ANALOG_MS` fazem parte do perfil do jogo. `GAMEPAD_VIGEM_DLL` fica global, pois aponta para uma DLL instalada neste PC. Nenhuma dessas opções contém credenciais.
