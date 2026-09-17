@echo off
title Matajer — منصة المتاجر
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
if "%DISABLE_SAMPLES%"=="" set DISABLE_SAMPLES=1
echo ==========================================
echo   Matajer — منصة المتاجر
echo   التشغيل على: http://localhost:%PORT%
echo   لإيقاف الخادم: أغلق هذه النافذة
echo ==========================================
node server.js
pause