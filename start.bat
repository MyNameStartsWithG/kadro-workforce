@echo off
chcp 65001 >nul 2>&1
title Kadro - Workforce Management
cd /d "%~dp0"

echo.
echo   ACME ENGINEERING - Kadro Workforce Management
echo   ---------------------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [ERROR] Node.js is not installed.
  echo.
  echo   First download and install the "LTS" version from https://nodejs.org,
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First run: installing the required packages, this can take a few minutes...
  echo.
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo   [ERROR] The packages could not be installed. Check your internet connection.
    pause
    exit /b 1
  )
  echo.
)

node server.js

echo.
echo   The server stopped.
pause
