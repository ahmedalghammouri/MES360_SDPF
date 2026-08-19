@echo off
REM ============================================================
REM  MES360(deg) Edge Gateway - upgrade an installed service in place
REM ------------------------------------------------------------
REM  Run as Administrator from the INSTALLED folder:
REM
REM      update-service.bat D:\path\to\new\build
REM
REM  Upgrading is not a copy. The running service holds edgegateway.exe
REM  open, so copying over it fails with a sharing violation - and the
REM  half-written folder that leaves behind is worse than not having
REM  started. This stops the service first, keeps the previous build so a
REM  bad one can be put back in seconds, and never touches .env or
REM  gateway-config.json: those are the plant's configuration, not the
REM  build's, and replacing them takes the gateway off the line.
REM ============================================================
setlocal EnableExtensions
set SVC=Mes360EdgeGateway

set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

set "SRC=%~1"
if "%SRC%"=="" (
  echo Usage: update-service.bat ^<path-to-new-build-folder^>
  echo   e.g. update-service.bat D:\drop\build
  exit /b 1
)
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"

if not exist "%SRC%\edgegateway.exe" (
  echo ERROR: no edgegateway.exe in "%SRC%".
  exit /b 1
)
if /i "%SRC%"=="%DIR%" (
  echo ERROR: source and destination are the same folder.
  exit /b 1
)

where nssm >nul 2>nul
if errorlevel 1 (
  if exist "%DIR%\nssm.exe" ( set "NSSM=%DIR%\nssm.exe" ) else (
    echo ERROR: nssm.exe not found on PATH or in this folder.
    exit /b 1
  )
) else ( set "NSSM=nssm" )

REM Not installed yet - installing is a different operation, and guessing
REM which one was meant is how a service ends up registered twice.
sc query %SVC% >nul 2>nul
if errorlevel 1 (
  echo Service %SVC% is not installed. Run install-service.bat instead.
  exit /b 1
)

echo Stopping %SVC% ...
"%NSSM%" stop %SVC%
REM NSSM returns while the process is still winding down, so the exe can stay
REM locked for a moment after "stop" reports success.
timeout /t 5 /nobreak >nul

REM ---- Keep the build that is being replaced -------------------------------
REM Named, not timestamped: at 02:00 with the line down, one obvious file to
REM copy back beats a folder of dated ones to choose between.
set "PREV=%DIR%\previous-build"
if exist "%PREV%" rmdir /s /q "%PREV%"
mkdir "%PREV%"
copy /y "%DIR%\edgegateway.exe" "%PREV%\" >nul
if exist "%DIR%\public" xcopy /e /i /y /q "%DIR%\public" "%PREV%\public" >nul
echo Previous build kept in %PREV%

REM ---- Copy the new build --------------------------------------------------
REM Everything the build produces, and nothing the plant configured.
echo Copying new build ...
copy /y "%SRC%\edgegateway.exe" "%DIR%\" >nul || goto :failcopy
if exist "%SRC%\public"        xcopy /e /i /y /q "%SRC%\public" "%DIR%\public" >nul
if exist "%SRC%\prebuilds"     xcopy /e /i /y /q "%SRC%\prebuilds" "%DIR%\prebuilds" >nul
if exist "%SRC%\schema.prisma" copy /y "%SRC%\schema.prisma" "%DIR%\" >nul
copy /y "%SRC%\query_engine-windows*.node" "%DIR%\" >nul 2>nul
for %%F in (install-service.bat uninstall-service.bat update-service.bat README.md) do (
  if exist "%SRC%\%%F" copy /y "%SRC%\%%F" "%DIR%\" >nul
)

echo Starting %SVC% ...
"%NSSM%" start %SVC%
if errorlevel 1 goto :failstart

echo.
echo Done.
echo   Dashboard:   http://localhost:4900
echo   Confirm it took:  Signal Rules -^> "Pulse detector - live" reports a
echo                     sample rate. An older build has no such card.
echo   Logs:        %DIR%\logs\out.log  and  err.log
echo.
endlocal
exit /b 0

:failcopy
echo.
echo ERROR: could not copy edgegateway.exe - is the service really stopped?
echo The old build is still in place; start the service to carry on as before.
endlocal
exit /b 1

:failstart
echo.
echo ERROR: the service did not start. See %DIR%\logs\err.log
echo.
echo To go back:
echo   copy /y "%PREV%\edgegateway.exe" "%DIR%\"
echo   "%NSSM%" start %SVC%
endlocal
exit /b 1
