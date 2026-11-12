@echo off
title PolyEdge AI - Asistente de Polymarket
color 0A
echo ========================================================
echo       PolyEdge AI - Asistente y Bot de Polymarket
echo ========================================================
echo.
echo Iniciando el servidor y asistente cuantitativo...
echo Accede en tu navegador a: http://localhost:5050
echo.
cd /d "%~dp0"
python app.py
pause
