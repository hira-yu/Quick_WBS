@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul

set "PHP_EXE=C:\php\php.exe"
set "MYSQL_EXE=C:\xampp\mysql\bin\mysql.exe"
set "MYSQLD_EXE=C:\xampp\mysql\bin\mysqld.exe"
set "MYSQL_INI=C:\xampp\mysql\bin\my.ini"
set "LOCAL_CONFIG=public_html\api\config\config.local.php"

if not exist "%PHP_EXE%" (
  echo [ERROR] PHP was not found: %PHP_EXE%
  echo Update scripts\start-dev.bat if PHP is installed elsewhere.
  exit /b 1
)

if not exist "%MYSQL_EXE%" (
  echo [ERROR] MySQL client was not found: %MYSQL_EXE%
  echo Update scripts\start-dev.bat if XAMPP is installed elsewhere.
  exit /b 1
)

if not exist "%MYSQLD_EXE%" (
  echo [ERROR] MySQL server was not found: %MYSQLD_EXE%
  echo Update scripts\start-dev.bat if XAMPP is installed elsewhere.
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  exit /b 1
)

if not exist "%LOCAL_CONFIG%" (
  echo [INFO] Creating local API config: %LOCAL_CONFIG%
  > "%LOCAL_CONFIG%" echo ^<?php
  >> "%LOCAL_CONFIG%" echo.
  >> "%LOCAL_CONFIG%" echo return [
  >> "%LOCAL_CONFIG%" echo     'db' =^> [
  >> "%LOCAL_CONFIG%" echo         'dsn' =^> 'mysql:host=127.0.0.1;dbname=quick_wbs;charset=utf8mb4',
  >> "%LOCAL_CONFIG%" echo         'user' =^> 'root',
  >> "%LOCAL_CONFIG%" echo         'password' =^> '',
  >> "%LOCAL_CONFIG%" echo     ],
  >> "%LOCAL_CONFIG%" echo     'security' =^> [
  >> "%LOCAL_CONFIG%" echo         'require_agent_token' =^> false,
  >> "%LOCAL_CONFIG%" echo     ],
  >> "%LOCAL_CONFIG%" echo ];
)

tasklist /FI "IMAGENAME eq mysqld.exe" 2>nul | find /I "mysqld.exe" >nul
if errorlevel 1 (
  echo [INFO] Starting MySQL...
  start "Quick WBS MySQL" /min "%MYSQLD_EXE%" --defaults-file="%MYSQL_INI%" --standalone
  timeout /t 3 /nobreak >nul
) else (
  echo [INFO] MySQL is already running.
)

echo [INFO] Ensuring database exists...
"%MYSQL_EXE%" -uroot -e "CREATE DATABASE IF NOT EXISTS quick_wbs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if errorlevel 1 (
  echo [ERROR] Could not connect to MySQL. Check XAMPP MySQL settings.
  exit /b 1
)

"%MYSQL_EXE%" -uroot -N -B quick_wbs -e "SHOW TABLES LIKE 'projects';" 2>nul | find "projects" >nul
if errorlevel 1 (
  echo [INFO] Importing database schema...
  "%MYSQL_EXE%" -uroot quick_wbs < database\schema.sql
  if errorlevel 1 (
    echo [ERROR] Schema import failed.
    exit /b 1
  )
) else (
  echo [INFO] Database schema already exists.
)

netstat -ano | find ":8080" | find "LISTENING" >nul
if errorlevel 1 (
  echo [INFO] Starting PHP API server on http://127.0.0.1:8080
  start "Quick WBS API" cmd /k ""%PHP_EXE%" -S 127.0.0.1:8080 -t public_html public_html/dev-router.php"
) else (
  echo [INFO] Port 8080 is already in use. Skipping PHP API server start.
)

netstat -ano | find ":5173" | find "LISTENING" >nul
if errorlevel 1 (
  echo [INFO] Starting Vite dev server on http://127.0.0.1:5173
  start "Quick WBS Web" cmd /k "npm.cmd run dev -- --host 127.0.0.1"
) else (
  echo [INFO] Port 5173 is already in use. Skipping Vite start.
)

echo.
echo Quick WBS local environment is starting.
echo Open http://127.0.0.1:5173/
echo.

popd >nul
endlocal
