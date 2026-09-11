@echo off
REM ============================================================
REM  ChatPlays - Inicializador para Windows
REM  SindromeGames Edition
REM ============================================================
REM  Este .bat inicia o ChatPlays.exe (procure ele na pasta do
REM  release) e mantem a janela aberta para voce ver os logs.
REM  Se o .exe nao existir, ele tenta iniciar via node
REM  (npm install + npm start).
REM
REM  Perfis por jogo:
REM    iniciar.bat --perfis
REM      abre o gerenciador para criar/ativar/renomear perfis;
REM    iniciar.bat --perfil "Pokemon Emerald"
REM      ativa esse perfil e continua o boot normalmente.
REM  O perfil ativo fica lembrado em dados\perfis.json.
REM
REM  v2.9.3: no modo Node, inicia por src\boot.js para instalar as
REM  protecoes de runtime antes de conectar o chat (incluindo SaveGuard).
REM
REM  v2.9.2: o app foi renomeado de "Pokemon Chat Plays" para
REM  "ChatPlays" — o .exe antigo (PokemonChatPlays.exe) ainda e
REM  aceito como fallback para pastas portable migradas a mao.
REM
REM  v2.8: ao abrir o iniciar.bat, o bot SEMPRE abre o assistente de
REM  configuracao no navegador — e tudo que voce salvou antes ja vem
REM  preenchido (bot da Twitch, chaves mascaradas, caminhos do jogo/ROM). E so
REM  revisar e clicar em "Salvar e iniciar o bot".
REM  Argumentos sao repassados: --direto pula o assistente e inicia
REM  direto (config ja salva); --assistente abre so o assistente.
REM ============================================================

title ChatPlays - SindromeGames
cd /d "%~dp0"

echo.
echo ==========================================
echo   ChatPlays - SindromeGames
echo ==========================================
echo.

REM Verifica se o .exe existe (release baixado) — nome novo primeiro,
REM nome antigo (Pokemon Chat Plays) como fallback de migracao
if exist "ChatPlays.exe" (
    echo Iniciando ChatPlays.exe...
    echo.
    ChatPlays.exe %*
    goto fim
)

if exist "PokemonChatPlays.exe" (
    echo Iniciando PokemonChatPlays.exe ^(versao antiga — baixe o release novo para renomear^)...
    echo.
    PokemonChatPlays.exe %*
    goto fim
)

REM Verifica se existe node instalado
where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    echo.
    echo Baixe e instale o Node.js em: https://nodejs.org/
    echo Depois rode este arquivo novamente.
    echo.
    pause
    exit /b 1
)

REM Modo desenvolvimento: instala dependencias se faltar
if not exist "node_modules" (
    echo Instalando dependencias (npm install)...
    call npm install
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
)

REM Cria .env a partir do .env.example se ainda nao existir
if not exist ".env" (
    if exist ".env.example" copy .env.example .env >nul
)

REM v2.8: o assistente de configuracao abre em TODO inicio, preenchido
echo [i] O assistente de configuracao vai abrir no seu navegador.
echo [i] Revise (ou nao) e clique em "Salvar e iniciar o bot".
echo.

echo Iniciando bot...
echo.
node src/boot.js %*

:fim
echo.
echo Bot encerrado. Pressione qualquer tecla para fechar.
pause >nul
