; ============================================================
;  ChatPlays — Instalador NSIS (v2.6)
;  Compila com: makensis -DVERSION=x.y.z installer.nsi
;  (o GitHub Actions faz isso automaticamente em cada release)
;
;  Decisões de design:
;   - Instalação POR USUÁRIO em %LOCALAPPDATA%\Programs\ChatPlays
;     (sem pedir administrador — igual ao instalador "user" do VS Code).
;   - Atalho/lançamento via iniciar.bat: mantém a janela do terminal
;     aberta com os logs do bot (essencial numa live).
;   - Ao abrir o iniciar.bat, o assistente de configuração abre no
;     navegador SEMPRE, preenchido com tudo que foi salvo antes
;     (bot, chaves mascaradas, caminhos do jogo) — nada de Bloco de Notas.
;   - O desinstalador NÃO apaga .env nem dados/ (são do usuário).
;
;  RENOME (v2.9.2 — era "Pokemon Chat Plays" / PokemonChatPlays):
;   - As CHAVES DE REGISTRO mantêm o nome antigo DE PROPÓSITO: o
;     InstallDirRegKey lê a instalação antiga e o upgrade acontece
;     NO MESMO diretório (sem instalação duplicada), e a chave do
;     "Adicionar ou Remover Programas" é atualizada in-place em vez
;     de criar uma segunda entrada. Só o que o usuário VÊ muda
;     (DisplayName, atalhos, nomes de arquivo).
;   - A instalação LIMPA os atalhos antigos e o .exe antigo
;     (PokemonChatPlays.exe) que sobrariam de upgrades in-place.
; ============================================================

!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!ifndef FILESDIR
  !define FILESDIR "release"
!endif

Name "ChatPlays"
OutFile "ChatPlays-Setup.exe"
Unicode true
InstallDir "$LOCALAPPDATA\Programs\ChatPlays"
; chave LEGADA (v2.9.2): instalações antigas do Pokemon Chat Plays
; apontam para cá — upgrades entram no MESMO diretório, sem duplicar
InstallDirRegKey HKCU "Software\PokemonChatPlays" "InstallDir"
RequestExecutionLevel user

!define APP_NAME "ChatPlays"
!define APP_BAT "iniciar.bat"
; chaves LEGADAS de propósito (ver comentário no topo): upgrade in-place
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PokemonChatPlays"
!define DIR_LEGADO "PokemonChatPlays"
!define ATALHOS_LEGADO "Pokemon Chat Plays"

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
!define MUI_FINISHPAGE_RUN_TEXT "Executar o ChatPlays agora"
!define MUI_FINISHPAGE_RUN_FUNCTION "ExecutarApp"

Function ExecutarApp
  ; via cmd para a janela dos logs não morrer junto com o instalador
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_BAT}"'
FunctionEnd

; ============================================================
;  Migração: limpa restos da instalação antiga (Pokemon Chat Plays)
;  — atalhos com o nome velho e o .exe velho no diretório de destino
; ============================================================
Function LimparLegado
  ; atalhos antigos do Menu Iniciar (agora vivem em ...\ChatPlays)
  Delete "$SMPROGRAMS\${ATALHOS_LEGADO}\Pokemon Chat Plays.lnk"
  Delete "$SMPROGRAMS\${ATALHOS_LEGADO}\Assistente de configuração.lnk"
  Delete "$SMPROGRAMS\${ATALHOS_LEGADO}\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\${ATALHOS_LEGADO}"
  ; atalho antigo da Área de Trabalho
  Delete "$DESKTOP\${ATALHOS_LEGADO}.lnk"
  ; .exe antigo em upgrades in-place (mesmo $INSTDIR da instalação velha)
  Delete "$INSTDIR\PokemonChatPlays.exe"
FunctionEnd

; ============================================================
;  Seções
; ============================================================
Section "ChatPlays (obrigatório)" SEC_APP
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; limpeza da instalação antiga ANTES de gravar os arquivos novos
  Call LimparLegado

  ; Arquivos do build (pkg + auxiliares)
  File "${FILESDIR}\ChatPlays.exe"
  File "${FILESDIR}\.env.example"
  File "${FILESDIR}\README.md"
  File "${FILESDIR}\LICENSE"
  File "${FILESDIR}\iniciar.bat"

  ; Desinstalador
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Menu Iniciar
  CreateDirectory "$SMPROGRAMS\ChatPlays"
  CreateShortcut "$SMPROGRAMS\ChatPlays\ChatPlays.lnk" "$INSTDIR\${APP_BAT}" "" "$INSTDIR\${APP_BAT}"
  CreateShortcut "$SMPROGRAMS\ChatPlays\Assistente de configuração.lnk" "$INSTDIR\${APP_BAT}" "--assistente" "$INSTDIR\${APP_BAT}"
  CreateShortcut "$SMPROGRAMS\ChatPlays\Desinstalar.lnk" "$INSTDIR\uninstall.exe"

  ; "Adicionar ou Remover Programas" (por usuário, sem admin)
  ; (chave LEGADA de propósito — ver comentário no topo: upgrade in-place,
  ;  sem criar uma segunda entrada no Painel de Controle)
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "SindromeGames"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/felipinhobxd/ChatPlays"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\ChatPlays.exe"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\PokemonChatPlays" "InstallDir" $INSTDIR
SectionEnd

Section /o "Atalho na Área de Trabalho" SEC_DESKTOP
  CreateShortcut "$DESKTOP\ChatPlays.lnk" "$INSTDIR\${APP_BAT}" "" "$INSTDIR\${APP_BAT}"
SectionEnd

; ============================================================
;  Desinstalação — remove o app, PRESERVA .env e dados/ do usuário
; ============================================================
Section "Uninstall"
  ; Atalhos atuais + legados (instalação antiga sem upgrade)
  Delete "$SMPROGRAMS\ChatPlays\ChatPlays.lnk"
  Delete "$SMPROGRAMS\ChatPlays\Assistente de configuração.lnk"
  Delete "$SMPROGRAMS\ChatPlays\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\ChatPlays"
  Delete "$SMPROGRAMS\${ATALHOS_LEGADO}\Pokemon Chat Plays.lnk"
  Delete "$SMPROGRAMS\${ATALHOS_LEGADO}\Assistente de configuração.lnk"
  Delete "$SMPROGRAMS\${ATALHOS_LEGADO}\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\${ATALHOS_LEGADO}"
  Delete "$DESKTOP\ChatPlays.lnk"
  Delete "$DESKTOP\${ATALHOS_LEGADO}.lnk"

  ; Arquivos instalados (NÃO tocar em .env, dados\, nem logs\)
  Delete "$INSTDIR\ChatPlays.exe"
  Delete "$INSTDIR\PokemonChatPlays.exe"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\${APP_BAT}"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; Registro (chave LEGADA de propósito — ver comentário no topo)
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\PokemonChatPlays"

  IfFileExists "$INSTDIR\*.*" 0 done
    MessageBox MB_OK|MB_ICONINFORMATION "Alguns arquivos seus ficaram em:$\r$\n$INSTDIR$\r$\n$\r$\n(.env e a pasta dados/ com suas estatísticas e caminho do emulador)$\r$\nApague a pasta manualmente se não quiser mais nada."
  done:
SectionEnd
