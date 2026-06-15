@echo off
setlocal

echo [INFO] Stopping Quick WBS local servers on ports 5173 and 8080...

for /f "tokens=5" %%a in ('netstat -ano ^| find ":5173" ^| find "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>nul
)

for /f "tokens=5" %%a in ('netstat -ano ^| find ":8080" ^| find "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>nul
)

echo [INFO] Web and API servers stopped.
echo [INFO] MySQL is left running because it may be used by XAMPP or other projects.

endlocal

