@echo off
cd /d "%~dp0"
set "NODE_EXE=C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE_EXE%" (
  "%NODE_EXE%" server.js
) else (
  node server.js
)
