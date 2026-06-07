@echo off
setlocal

cd /d C:\Users\GUSEOYEONG\Desktop\frontend\safe-ticket
powershell -ExecutionPolicy Bypass -File "%CD%\scripts\prepare-preview-site.ps1"
if errorlevel 1 exit /b %errorlevel%

echo [safe-ticket] Serving preview site at http://127.0.0.1:3000
.\.venv\Scripts\python.exe -m http.server 3000 --directory .preview\site
