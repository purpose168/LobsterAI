!macro customInit
  ; 尽力而为：在安装/卸载前终止正在运行的应用程序实例
  ; 以避免升级过程中出现 NSIS "应用程序无法关闭" 错误
  nsExec::ExecToLog 'taskkill /IM "${APP_EXECUTABLE_FILENAME}" /F /T'
  Pop $0
  Sleep 800
!macroend
