@echo off
REM Opens Job Inbox (http://localhost:4317), starting its server if needed.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:4317/api/state -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  wscript.exe "%~dp0job-inbox-hidden.vbs"
  timeout /t 3 /nobreak > nul
)
start "" http://localhost:4317
