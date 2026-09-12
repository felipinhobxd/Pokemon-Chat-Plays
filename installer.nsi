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
!include "LogicLib.nsh"

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
; v3.1: driver do gamepad virtual (oficial Nefarius, verificado por
; SHA-256 + assinatura Authenticode no workflow de release)
!define VIGEM_SETUP "ViGEmBus_1.22.0_x64_x86_arm64.exe"

Var ViGEmInstalado

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
;  ViGEmBus (driver do gamepad virtual) — detecta e instala se faltar
;
;  Regras (v3.1):
;   - já instalado (serviço ViGEmBus no registro) => NÃO faz nada;
;   - ausente => PERGUNTA antes (silencioso /S => não instala);
;   - instalador do driver precisa de administrador: tentamos ExecWait
;     (funciona se o nosso setup já estiver elevado e devolve o código de
;     saída); se o Windows recusar (erro de elevação), caímos para Exec
;     (UAC pelo shell) + espera pelo serviço aparecer;
;   - JAMAIS desinstalamos o driver na desinstalação do ChatPlays —
;     outros softwares podem usá-lo.
; ============================================================
Function DetectViGEmBus
  StrCpy $ViGEmInstalado 0
  ClearErrors
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\ViGEmBus" "ImagePath"
  ${IfNot} ${Errors}
    StrCpy $ViGEmInstalado 1
  ${EndIf}
FunctionEnd

Function InstalarViGEmBus
  Call DetectViGEmBus
  ${If} $ViGEmInstalado == 1
    DetailPrint "ViGEmBus já instalado — nada a fazer."
    Return
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION "O gamepad virtual usa o driver gratuito ViGEmBus (Nefarius).$\r$\n$\r$\nInstalar agora? O Windows vai pedir permissão de administrador.$\r$\n(O driver NÃO é removido ao desinstalar o ChatPlays; teclado e mouse funcionam mesmo sem ele)" /SD IDNO IDYES vigem_sim
  Return

vigem_sim:
  ClearErrors
  DetailPrint "Executando o instalador do ViGEmBus..."
  ExecWait '"$INSTDIR\drivers\${VIGEM_SETUP}" /S' $R0
  ${If} ${Errors}
    ; sem elevação o CreateProcess recusa (ERROR_ELEVATION_REQUIRED):
    ; abre pelo shell (mostra o UAC) e espera o serviço aparecer
    DetailPrint "Aguardando a instalação do ViGEmBus (UAC)..."
    Exec '"$INSTDIR\drivers\${VIGEM_SETUP}" /S'
    StrCpy $1 0
    ${Do}
      Sleep 2000
      Call DetectViGEmBus
      ${If} $ViGEmInstalado == 1
        ${ExitDo}
      ${EndIf}
      IntOp $1 $1 + 1
    ${LoopUntil} $1 >= 90
  ${Else}
    ${If} $R0 == 0
      DetailPrint "ViGEmBus instalado com sucesso."
    ${ElseIf} $R0 == 3010
      DetailPrint "ViGEmBus instalado — reinicialização pendente."
    ${Else}
      DetailPrint "Instalador do ViGEmBus devolveu código $R0."
    ${EndIf}
  ${EndIf}

  Call DetectViGEmBus
  ${If} $ViGEmInstalado == 0
    MessageBox MB_ICONINFORMATION "O driver ViGEmBus não foi instalado.$\r$\n$\r$\nSem ele o gamepad virtual fica desativado (teclado e mouse funcionam normalmente).$\r$\nPara ativar depois, execute como administrador:$\r$\n$INSTDIR\drivers\${VIGEM_SETUP}" /SD IDOK
  ${Else}
    DetailPrint "ViGEmBus presente."
  ${EndIf}
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
  File "${FILESDIR}\ViGEmClient.dll"
  File "${FILESDIR}\.env.example"
  File "${FILESDIR}\README.md"
  File "${FILESDIR}\LICENSE"
  File "${FILESDIR}\iniciar.bat"
  SetOutPath "$INSTDIR\docs"
  File "${FILESDIR}\docs\GAMEPAD.md"
  File "${FILESDIR}\docs\PERFIS.md"
  File "${FILESDIR}\docs\MINECRAFT-ATLAUNCHER.md"
  SetOutPath "$INSTDIR\drivers"
  File "${FILESDIR}\drivers\${VIGEM_SETUP}"
  SetOutPath "$INSTDIR\licenses"
  File "${FILESDIR}\licenses\ViGEmBus-LICENSE.txt"
  File "${FILESDIR}\licenses\ViGEmClient-LICENSE.txt"
  SetOutPath "$INSTDIR"

  ; Desinstalador
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Driver do gamepad virtual (detecta / pergunta / instala)
  Call InstalarViGEmBus

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
  Delete "$INSTDIR\ViGEmClient.dll"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\${APP_BAT}"
  Delete "$INSTDIR\docs\GAMEPAD.md"
  Delete "$INSTDIR\docs\PERFIS.md"
  Delete "$INSTDIR\docs\MINECRAFT-ATLAUNCHER.md"
  RMDir "$INSTDIR\docs"
  Delete "$INSTDIR\drivers\${VIGEM_SETUP}"
  RMDir "$INSTDIR\drivers"
  Delete "$INSTDIR\licenses\ViGEmBus-LICENSE.txt"
  Delete "$INSTDIR\licenses\ViGEmClient-LICENSE.txt"
  RMDir "$INSTDIR\licenses"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; ⚠️ O DRIVER ViGEmBus NÃO é desinstalado de propósito: ele é compartilhado
  ; por outros softwares (emuladores, ScpToolkit etc.). Quem quiser remover
  ; usa o próprio desinstalador dele em Configurações > Aplicativos.

  ; Registro (chave LEGADA de propósito — ver comentário no topo)
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\PokemonChatPlays"

  IfFileExists "$INSTDIR\*.*" 0 done
    MessageBox MB_OK|MB_ICONINFORMATION "Alguns arquivos seus ficaram em:$\r$\n$INSTDIR$\r$\n$\r$\n(.env e a pasta dados/ com suas estatísticas e caminho do emulador)$\r$\nApague a pasta manualmente se não quiser mais nada." /SD IDOK
  done:
SectionEnd
