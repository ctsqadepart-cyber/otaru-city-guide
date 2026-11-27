@echo off
chcp 65001 >nul
rem 從此批次檔所在位置啟動本機服務。
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo 請先從 https://nodejs.org/ 安裝 Node.js 22 或更新版本，再重新啟動。
  pause
  exit /b 1
)
node.exe "scripts\serve.mjs" --open
if errorlevel 1 pause
