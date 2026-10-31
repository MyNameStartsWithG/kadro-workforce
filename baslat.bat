@echo off
chcp 65001 >nul 2>&1
title KADRO Belge Yonetim Sistemi
cd /d "%~dp0"

echo.
echo   ACME MUHENDISLIK - Belge Yonetim Sistemi
echo   ----------------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [HATA] Node.js kurulu degil.
  echo.
  echo   Once https://nodejs.org adresinden "LTS" surumunu indirip kurun,
  echo   sonra bu dosyayi tekrar cift tiklayin.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   Ilk calistirma: gerekli paketler kuruluyor, birkac dakika surebilir...
  echo.
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo   [HATA] Paketler kurulamadi. Internet baglantinizi kontrol edin.
    pause
    exit /b 1
  )
  echo.
)

node server.js

echo.
echo   Sunucu durdu.
pause
