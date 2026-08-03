@echo off
REM Fiyat Arastirma Sistemi - baslangic scripti
REM Bagimliliklari (ilk calistirmada) kurar, fiyat taramasini yapar,
REM dashboard verisini olusturur ve dashboard'u tarayicida acar.

cd /d "%~dp0"

if not exist node_modules (
    echo [pricetracker] Bagimliliklar kuruluyor, bu ilk calistirmada biraz surebilir...
    call npm install
    if errorlevel 1 goto :error
    call npx playwright install chromium
    if errorlevel 1 goto :error
)

echo.
echo [pricetracker] Fiyat taramasi basliyor...
call npm run scrape
if errorlevel 1 goto :error

echo.
echo [pricetracker] Dashboard verisi hazirlaniyor...
call npm run build-dashboard
if errorlevel 1 goto :error

echo.
echo [pricetracker] Dashboard aciliyor...
start "" "%~dp0dashboard\index.html"

echo.
echo [pricetracker] Tamamlandi. Dashboard'in "summary.json" verisini gorebilmesi
echo icin taraycinizin dosya erisim kisitlamalarina takilirsa, su komutla
echo lokal bir sunucu baslatip http://localhost:8080 adresini acabilirsiniz:
echo     npx serve dashboard
echo.
pause
exit /b 0

:error
echo.
echo [pricetracker] Bir hata olustu, yukaridaki ciktiya bakin.
pause
exit /b 1
