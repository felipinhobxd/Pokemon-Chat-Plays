@echo off
REM ============================================================
REM  Pokemon Chat Plays - Inicializador para Windows
REM  SindromeGames Edition
REM ============================================================
REM  Este .bat inicia o PokemonChatPlays.exe (procure ele na
REM  pasta do release) e mantem a janela aberta para voce ver
REM  os logs. Se o .exe nao existir, ele tenta iniciar via
REM  node (npm install + npm start).
REM
REM  v2.8: ao abrir o iniciar.bat, o bot SEMPRE abre o assistente de
REM  configuracao no navegador — e tudo que voce salvou antes ja vem
REM  preenchido (bot da Twitch, chaves, caminhos do jogo/ROM...). E so
REM  revisar e clicar em "Salvar e iniciar o bot".
REM  Argumentos sao repassados: --direto pula o assistente e inicia
REM  direto (config ja salva); --assistente abre so o assistente.
REM ============================================================

title Pokemon Chat Plays - SindromeGames
cd /d "%~dp0"

echo.
echo ==========================================
echo   Pokemon Chat Plays - SindromeGames
echo ==========================================
echo.

REM Verifica se o .exe existe (release baixado)
if exist "PokemonChatPlays.exe" (
    echo Iniciando PokemonChatPlays.exe...
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
node src/index.js %*

:fim
echo.
echo Bot encerrado. Pressione qualquer tecla para fechar.
pause >nul
