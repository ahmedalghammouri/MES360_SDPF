@echo off
REM ============================================================
REM  MES360° Edge Gateway - install as a Windows service (NSSM)
REM ------------------------------------------------------------
REM  Run as Administrator from the folder containing edgegateway.exe.
REM  Requires nssm.exe on PATH or next to this script.
REM    Download: https://nssm.cc/download
REM ============================================================
setlocal
set SVC=Mes360EdgeGateway
set DIR=%~dp0
set EXE=%DIR%edgegateway.exe

where nssm >nul 2>nul
if errorlevel 1 (
  if exist "%DIR%nssm.exe" ( set NSSM="%DIR%nssm.exe" ) else (
    echo ERROR: nssm.exe not found on PATH or in this folder. Download from https://nssm.cc/download
    exit /b 1
  )
) else ( set NSSM=nssm )

echo Installing service %SVC% ...
%NSSM% install %SVC% "%EXE%"
%NSSM% set %SVC% AppDirectory "%DIR%"
%NSSM% set %SVC% AppStdout "%DIR%logs\out.log"
%NSSM% set %SVC% AppStderr "%DIR%logs\err.log"
%NSSM% set %SVC% AppRotateFiles 1
%NSSM% set %SVC% Start SERVICE_AUTO_START
%NSSM% set %SVC% AppExit Default Restart
%NSSM% set %SVC% DisplayName "MES360° Edge Gateway"
%NSSM% set %SVC% Description "Modbus acquisition + counters -> Job Orders / MQTT / InfluxDB"

echo Starting service ...
%NSSM% start %SVC%
echo Done. Dashboard: http://localhost:4900
endlocal
