@echo off
REM Fiyat Arastirma Sistemi - baslangic scripti
REM Bagimliliklari (ilk calistirmada) kurar, fiyat taramasini yapar,
REM dashboard verisini olusturur ve dashboard'u tarayicida acar.

cd /d "%~dp0"

if not exist node_modules (
    echo [pricetracker] Bagimliliklar kuruluyor, bu ilk calistirmada biraz surebilir...
    call npm install
    if errorlevel 1 goto :error
)

REM Playwright'in tarayici dosyalari node_modules'tan bagimsiz, ayri bir klasorde
REM (ms-playwright) tutuluyor ve npm install onlari kurmuyor. Bu yuzden node_modules
REM var olsa bile her calistirmada kontrol edilir -- zaten kuruluysa saniyeler
REM icinde hicbir sey yapmadan gecer, eksikse indirir.
echo [pricetracker] Playwright tarayicisi kontrol ediliyor...
call npx playwright install chromium
if errorlevel 1 goto :error

echo.
echo [pricetracker] Fiyat taramasi basliyor...
call npm run scrape
if errorlevel 1 goto :error

echo.
echo [pricetracker] Dashboard verisi hazirlaniyor...
call npm run build-dashboard
if errorlevel 1 goto :error

echo.
echo [pricetracker] Web sunucusu baslatiliyor (dashboard + urun ekleme + gecmis icin)...
start "Price Tracker Web" cmd /k npm run web
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo [pricetracker] Tamamlandi. Dashboard'a, yeni urun ekleme formuna ve ekleme
echo gecmisine http://localhost:5173 adresinden erisebilirsiniz. Sunucuyu
echo kapatmak icin acilan "Price Tracker Web" penceresini kapatin.
echo.
pause
exit /b 0

:error
echo.
echo [pricetracker] Bir hata olustu, yukaridaki ciktiya bakin.
pause
exit /b 1
