; Only an installed copy may replace itself with a future NSIS release.
; Portable ZIPs never get this marker.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\installed-release" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend
