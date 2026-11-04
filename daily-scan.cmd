@echo off
REM Daily career-ops run (France, English-only data roles) — Task Scheduler, 08:00.
REM Priority sources (Allianz France) first, then full scan, CV scoring, alerts.
REM Log: data\daily-scan.log
cd /d "%~dp0"
echo ===== %date% %time% ===== >> "data\daily-scan.log"
"C:\Program Files\nodejs\node.exe" daily-run.mjs >> "data\daily-scan.log" 2>&1
echo exit code %errorlevel% >> "data\daily-scan.log"
