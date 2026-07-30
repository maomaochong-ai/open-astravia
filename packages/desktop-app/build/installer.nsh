!macro handlePreviousInstallResult
  ${if} $R0 == 2
    DetailPrint "Previous A/B installation could not be removed atomically; continuing the update."
  ${elseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customUnInstallCheck
  !insertmacro handlePreviousInstallResult
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro handlePreviousInstallResult
!macroend

!macro customInstall
  Delete "$LOCALAPPDATA\OpenVetta\Desktop\current.json"
!macroend
