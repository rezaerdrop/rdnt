@echo off
set URL=%~1
if "%URL%"=="" (
    echo [ERROR] Masukkan URL RedNote / Xiaohongshu!
    echo Penggunaan: rednote.bat "https://www.xiaohongshu.com/explore/xxxxxx"
    pause
    exit /b 1
)
node C:\Users\rezaf\automation\rednote_downloader.js "%URL%"
pause
