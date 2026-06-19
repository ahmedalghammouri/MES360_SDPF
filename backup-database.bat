@echo off
REM MES360° Database Backup Script
REM ================================

echo Starting MES360° database backup...
echo.

REM Set timestamp for backup file
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%-%datetime:~8,6%

REM Database connection details
set PGHOST=127.0.0.1
set PGPORT=5433
set PGUSER=mes_user
set PGPASSWORD=mes_password
set PGDATABASE=mes360

REM Backup directory and file
set BACKUP_DIR=%USERPROFILE%\Documents\MES360°-Backups
set BACKUP_FILE=%BACKUP_DIR%\backup-mes360-%TIMESTAMP%.backup

REM Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo Backup file: %BACKUP_FILE%
echo.

REM Execute pg_dump using Docker container
docker exec -e PGPASSWORD=%PGPASSWORD% mes-postgres pg_dump -U %PGUSER% -d %PGDATABASE% -Fc -b --schema public > "%BACKUP_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Backup completed successfully!
    echo Location: %BACKUP_FILE%
    echo ========================================
) else (
    echo.
    echo ========================================
    echo Backup FAILED with error code %ERRORLEVEL%
    echo ========================================
)

echo.
pause
