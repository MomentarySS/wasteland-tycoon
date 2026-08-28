@echo off
chcp 65001 >nul
title 废土大亨：末世大富翁
cd /d "%~dp0"

set "NODE_EXE=%~dp0runtime\node.exe"
if exist "%NODE_EXE%" goto RUN

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_EXE=node"
  goto RUN
)

echo.
echo   [错误] 未找到 Node.js
echo   请安装 Node.js: https://nodejs.org/
echo.
pause
goto END

:RUN
echo.
echo   ============================================
echo     废土大亨：末世大富翁
echo   ============================================
echo     本地地址: http://127.0.0.1:8824/
echo.
echo     如端口被占用，请先关闭旧的服务器窗口
echo     [ 关闭此窗口即停止服务器 ]
echo   ============================================
echo.
"%NODE_EXE%" scripts/start.mjs
if errorlevel 1 pause

:END
