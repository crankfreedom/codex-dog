!macro DogGuardCli
  InitPluginsDir
  File /oname=$PLUGINSDIR\dog-cli-guard.ps1 "${BUILD_RESOURCES_DIR}\cli-file-guard.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\dog-cli-guard.ps1" -CliPath "$INSTDIR\resources\cli\codex-dog.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    SetErrorLevel 73
    Quit
  ${EndIf}
!macroend
!macro customInit
  !insertmacro DogGuardCli
!macroend
!macro customUnInit
  !insertmacro DogGuardCli
!macroend
