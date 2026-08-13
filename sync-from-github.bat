@echo off
REM Telefondan / GitHub Actions'tan gelen degisiklikleri lokale ceker.
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  if exist "C:\Program Files\Git\cmd\git.exe" (
    set "PATH=C:\Program Files\Git\cmd;%PATH%"
  ) else (
    echo [sync] Git bulunamadi. https://git-scm.com/download/win
    pause
    exit /b 1
  )
)

echo [sync] GitHub'dan cekiliyor (git pull)...
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo [sync] Fast-forward basarisiz. Yerelde commit'lenmemis degisiklik olabilir.
  echo        Durumu gormek icin: git status
  echo        Elle birlestirmek icin: git pull --no-rebase origin main
  pause
  exit /b 1
)

echo.
echo [sync] Tamam. Yerel klasor artik GitHub ile ayni.
echo        Telefondan ekledigin urunler config\products.json icinde.
echo        Dashboard: pricetracker.bat -^> [1] veya
echo        https://alid67-git.github.io/Price_Tracker/
echo.
pause
exit /b 0
