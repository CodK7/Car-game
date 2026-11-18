@echo off
title Wahiba Sands Off-Road
cd /d "%~dp0"
if not exist "%~dp0game\index.html" (
  echo Extract the whole zip first ^(right-click the zip, "Extract All"^), then run Play.bat from the extracted folder.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
