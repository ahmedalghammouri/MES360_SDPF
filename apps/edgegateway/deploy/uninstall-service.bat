@echo off
REM Remove the MES360° Edge Gateway Windows service. Run as Administrator.
setlocal
set SVC=Mes360EdgeGateway
set DIR=%~dp0
where nssm >nul 2>nul
if errorlevel 1 ( set NSSM="%DIR%nssm.exe" ) else ( set NSSM=nssm )
%NSSM% stop %SVC%
%NSSM% remove %SVC% confirm
echo Service %SVC% removed.
endlocal
