@echo off
REM MES360° Database Schema Reset Script
REM ======================================

echo WARNING: This will DELETE ALL DATA in the mes360 database!
echo.
set /p CONFIRM="Type 'YES' to confirm: "

if not "%CONFIRM%"=="YES" (
    echo Operation cancelled.
    pause
    exit /b
)

echo.
echo Dropping and recreating public schema...
echo.

docker exec -i mes-postgres psql -U mes_user -d mes360 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO mes_user; GRANT ALL ON SCHEMA public TO public;"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Schema reset completed successfully!
    echo ========================================
) else (
    echo.
    echo ========================================
    echo Schema reset FAILED with error code %ERRORLEVEL%
    echo ========================================
)

echo.
pause
