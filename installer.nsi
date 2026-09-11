; ============================================================
;  Pokemon Chat Plays — Instalador NSIS (v2.6)
;  Compila com: makensis -DVERSION=x.y.z installer.nsi
;  (o GitHub Actions faz isso automaticamente em cada release)
;
;  Decisões de design:
;   - Instalação POR USUÁRIO em %LOCALAPPDATA%\Programs\PokemonChatPlays
;     (sem pedir administrador — igual ao instalador "user" do VS Code).
;   - Atalho/lançamento via iniciar.bat: mantém a janela do terminal
;     aberta com os logs do bot (essencial numa live).
;   - Na 1ª execução sem .env, o próprio bot abre o assistente de
;     configuração no navegador — nada de Bloco de Notas.
;   - O desinstalador NÃO apaga .env nem dados/ (são do usuário).
; ============================================================

!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!ifndef FILESDIR
  !define FILESDIR "release"
!endif

Name "Pokemon Chat Plays"
OutFile "PokemonChatPlays-Setup.exe"
Unicode true
InstallDir "$LOCALAPPDATA\Programs\PokemonChatPlays"
InstallDirRegKey HKCU "Software\PokemonChatPlays" "InstallDir"
RequestExecutionLevel user

!define APP_NAME "Pokemon Chat Plays"
!define APP_BAT "iniciar.bat"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PokemonChatPlays"

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; ---------- Páginas ----------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; ---------- Idiomas (português primeiro = padrão) ----------
!insertmacro MUI_LANGUAGE "PortugueseBR"
!insertmacro MUI_LANGUAGE "English"

; ---------- Executar ao terminar ----------
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Executar o Pokemon Chat Plays agora"
!define MUI_FINISHPAGE_RUN_FUNCTION "ExecutarApp"

Function ExecutarApp
  ; via cmd para a janela dos logs não morrer junto com o instalador
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_BAT}"'
FunctionEnd

; ============================================================
;  Seções
; ============================================================
Section "Pokemon Chat Plays (obrigatório)" SEC_APP
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Arquivos do build (pkg + auxiliares)
  File "${FILESDIR}\PokemonChatPlays.exe"
  File "${FILESDIR}\.env.example"
  File "${FILESDIR}\README.md"
  File "${FILESDIR}\LICENSE"
  File "${FILESDIR}\iniciar.bat"

  ; Desinstalador
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Menu Iniciar
  CreateDirectory "$SMPROGRAMS\Pokemon Chat Plays"
  CreateShortcut "$SMPROGRAMS\Pokemon Chat Plays\Pokemon Chat Plays.lnk" "$INSTDIR\${APP_BAT}" "" "$INSTDIR\${APP_BAT}"
  CreateShortcut "$SMPROGRAMS\Pokemon Chat Plays\Assistente de configuração.lnk" "$INSTDIR\${APP_BAT}" "--assistente" "$INSTDIR\${APP_BAT}"
  CreateShortcut "$SMPROGRAMS\Pokemon Chat Plays\Desinstalar.lnk" "$INSTDIR\uninstall.exe"

  ; "Adicionar ou Remover Programas" (por usuário, sem admin)
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "SindromeGames"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/felipinhobxd/Pokemon-Chat-Plays"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\PokemonChatPlays.exe"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\PokemonChatPlays" "InstallDir" $INSTDIR
SectionEnd

Section /o "Atalho na Área de Trabalho" SEC_DESKTOP
  CreateShortcut "$DESKTOP\Pokemon Chat Plays.lnk" "$INSTDIR\${APP_BAT}" "" "$INSTDIR\${APP_BAT}"
SectionEnd

; ============================================================
;  Desinstalação — remove o app, PRESERVA .env e dados/ do usuário
; ============================================================
Section "Uninstall"
  ; Atalhos
  Delete "$SMPROGRAMS\Pokemon Chat Plays\Pokemon Chat Plays.lnk"
  Delete "$SMPROGRAMS\Pokemon Chat Plays\Assistente de configuração.lnk"
  Delete "$SMPROGRAMS\Pokemon Chat Plays\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\Pokemon Chat Plays"
  Delete "$DESKTOP\Pokemon Chat Plays.lnk"

  ; Arquivos instalados (NÃO tocar em .env, dados\, nem logs\)
  Delete "$INSTDIR\PokemonChatPlays.exe"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\${APP_BAT}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; Registro
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\PokemonChatPlays"

  IfFileExists "$INSTDIR\*.*" 0 done
    MessageBox MB_OK|MB_ICONINFORMATION "Alguns arquivos seus ficaram em:$\r$\n$INSTDIR$\r$\n$\r$\n(.env e a pasta dados/ com suas estatísticas e caminho do emulador)$\r$\nApague a pasta manualmente se não quiser mais nada."
  done:
SectionEnd
