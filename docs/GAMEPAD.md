# Gamepad virtual (Passo 3)

O ChatPlays pode transformar comandos do Twitch/YouTube em um **controle Xbox 360 virtual** no Windows. Os comandos de gamepad usam um prefixo próprio para não colidir com os controles de teclado já existentes.

## Requisito no Windows

A implementação usa **ViGEmBus + ViGEmClient.dll**. O ChatPlays não instala driver silenciosamente e não baixa DLL de terceiros sozinho.

1. Instale o driver ViGEmBus no Windows.
2. Coloque `ViGEmClient.dll` ao lado do `ChatPlays.exe`, ou informe o caminho completo em `GAMEPAD_VIGEM_DLL`.
3. Deixe `GAMEPAD_ENABLED=auto` para criar o controle somente quando chegar o primeiro comando `pad`, ou use `on` para pré-carregar no boot.

Se o driver/DLL não estiver disponível, o bot **continua funcionando normalmente** com teclado/mouse e apenas mostra um aviso.

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

## Segurança

- `pad soltar` neutraliza botões, analógicos e gatilhos.
- O comando global `soltar` também neutraliza o gamepad antes de liberar as teclas.
- Pausar o ChatPlays neutraliza o gamepad automaticamente.
- Comandos de gamepad respeitam o cooldown normal do chat.
- No modo **democracia**, gamepad fica bloqueado por enquanto. Votação analógica precisa de agregação própria para não furar a votação existente.

## Configuração

```dotenv
# auto = tenta criar o gamepad só ao receber um comando `pad`
# on   = cria o gamepad no boot
# off  = desativa
GAMEPAD_ENABLED=auto

# Opcional. Se vazio, procura ViGEmClient.dll ao lado do app e no PATH.
GAMEPAD_VIGEM_DLL=

# Duração padrão de botões e de analógicos/gatilhos
GAMEPAD_TAP_MS=220
GAMEPAD_ANALOG_MS=320
```

Essas opções são de **hardware/PC**, não guardam credenciais e não mudam os controles personalizados de cada perfil.
