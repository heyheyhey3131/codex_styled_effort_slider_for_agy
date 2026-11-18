@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-asar.ps1" -Uninstall %*
if "%1"=="" pause
