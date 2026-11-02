; Only native-host manifests and extension files are prepared. Browser security
; and consent are not bypassed: no policies, profile edits or silent add-on installs.
!macro customInstall
  ; Only the installed NSIS Setup EXE participates in the GitHub updater.
  ; MSI, portable and Store installs intentionally have no marker.
  FileOpen $0 "$INSTDIR\resources\getanny-github-updates" w
  FileWrite $0 "nsis-github"
  FileClose $0
  DetailPrint "Provisioning GetANNY's secure local browser bridge for this user..."
  ; The helper is standalone: it never starts the download database/server and
  ; provisions every supported browser, including browsers installed later.
  ExecWait '"$INSTDIR\GetANNY.exe" --setup-browser-hosts --quiet' $0
  ${If} $0 != 0
    DetailPrint "Browser bridge provisioning failed; GetANNY will retry on first launch and show diagnostics in Browser integration."
  ${EndIf}
!macroend
!macro customUnInstall
  ${IfNot} ${isUpdated}
    DetailPrint "Removing GetANNY native messaging registrations for this user..."
    ; ExecWait tracks the actual GUI-subsystem Electron helper until it exits;
    ; the app records browser-uninstall-report.json in its own user-data root.
    ExecWait '"$INSTDIR\GetANNY.exe" --unregister-browser-hosts --quiet' $0
    ${If} $0 != 0
      DetailPrint "Some browser bridge files were locked. Close browsers to remove remaining files."
    ${EndIf}
  ${EndIf}
!macroend
