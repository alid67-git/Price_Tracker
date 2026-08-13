@echo off
REM Fiyat Arastirma Sistemi
REM [1] Web arastirma (manuel arama + PDF) — varsayilan
REM [2] Toplu tarama (config urunleri + summary.json)

cd /d "%~dp0"

if not exist node_modules (
    echo [pricetracker] Bagimliliklar kuruluyor, bu ilk calistirmada biraz surebilir...
    call npm install
    if errorlevel 1 goto :error
)

echo [pricetracker] Playwright tarayicisi kontrol ediliyor...
call npx playwright install chromium
if errorlevel 1 goto :error

echo.
echo  [1] Arastirma web     (manuel arama + PDF)     [varsayilan]
echo  [2] Toplu tarama      (config urunleri)
echo  [3] GitHub'dan cek    (telefon/Actions -^> lokal)
echo.
echo  Telefon paneli: https://alid67-git.github.io/Price_Tracker/
echo.
set /p CHOICE="Secim (1/2/3, Enter=1): "
if "%CHOICE%"=="" set CHOICE=1
if "%CHOICE%"=="2" goto :batch
if "%CHOICE%"=="3" goto :sync
goto :web

:web
echo.
echo [pricetracker] Web sunucusu baslatiliyor...
echo [pricetracker] Tarayici http://localhost:3456 adresinde acilacak.
echo [pricetracker] Durdurmak icin bu pencerede Ctrl+C basin.
start "" "http://localhost:3456"
call npm run web
if errorlevel 1 goto :error
exit /b 0

:batch
echo.
echo [pricetracker] Fiyat taramasi basliyor...
call npm run scrape
if errorlevel 1 goto :error

echo.
echo [pricetracker] Dashboard verisi hazirlaniyor...
call npm run build-dashboard
if errorlevel 1 goto :error

echo.
echo [pricetracker] Tamamlandi. Sonuclari gormek icin secenek [1] ile web'i acin:
echo     http://localhost:3456  (Takip edilenler sekmesi)
echo.
pause
exit /b 0

:sync
echo.
call "%~dp0sync-from-github.bat"
exit /b %ERRORLEVEL%

:error
echo.
echo [pricetracker] Bir hata olustu, yukaridaki ciktiya bakin.
pause
exit /b 1
