@echo off
title Matajer — منصة المتاجر
cd /d "%~dp0"
echo ==========================================
echo   Matajer — منصة المتاجر
echo   التشغيل على: http://localhost:3000
echo   لإيقاف الخادم: أغلق هذه النافذة
echo ==========================================
node server.js
pause