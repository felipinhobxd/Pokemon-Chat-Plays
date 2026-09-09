@echo off
REM ============================================================
REM  Pokemon Chat Plays - Inicializador para Windows
REM  SindromeGames Edition
REM ============================================================
REM  Este .bat inicia o PokemonChatPlays.exe (procure ele na
REM  pasta do release) e mantem a janela aberta para voce ver
REM  os logs. Se o .exe nao existir, ele tenta iniciar via
REM  node (npm install + npm start).
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
    PokemonChatPlays.exe
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
    echo Criando .env a partir de .env.example...
    copy .env.example .env >nul
    echo.
    echo [!] Edite o arquivo .env com suas credenciais da Twitch/YouTube.
    echo [!] Depois rode este arquivo novamente.
    echo.
    notepad .env
    pause
    exit /b 0
)

echo Iniciando bot...
echo.
node src/index.js

:fim
echo.
echo Bot encerrado. Pressione qualquer tecla para fechar.
pause >nul
