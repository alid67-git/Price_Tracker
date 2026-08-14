# Changelog

SemVer: `MAJOR.MINOR.PATCH`

| Alan | Ne zaman artar |
|------|----------------|
| **MAJOR** | Kırıcı değişiklik veya yeni ana ürün hattı (örn. uluslararası arama) |
| **MINOR** | Geriye uyumlu yeni özellik |
| **PATCH** | Hata düzeltmesi, küçük iyileştirme |

Her anlamlı gelişmede `package.json` → `version` güncellenir, bu dosyaya satır eklenir,
dashboard üstünde görünür. Uluslararası fiyat modu hedefi: **2.0.0**.

## [1.3.4] — 2026-08-14

### Added
- Arama sırasında tüm siteler sırayla listelenir (ek URL + Akakçe/Cimri + pazaryeri + katalog)
- Üstte “Şu an: …” satırı; bulundu mavi / yok kırmızı; bitince tam liste

## [1.3.3] — 2026-08-14

### Added
- Ek pazaryeri URL’leri arama sırasında sırayla görünür: bulundu (mavi) / yok (kırmızı), bitince liste

## [1.3.2] — 2026-08-14

### Added
- Arama sonuçlarında teklif adresleri tablo altında sıra ile listelenir (tıklanabilir)

## [1.3.1] — 2026-08-14

### Fixed
- `api-config.json` güncel Render URL: `price-tracker-api-leyb.onrender.com`
- Render host’unda arama aynı origin’e gider (eski askıdaki URL’ye kaçmaz)

## [1.3.0] — 2026-08-14

### Added
- Render deploy: `Dockerfile` + `render.yaml` (Playwright Chromium)
- Telefondaki GitHub Pages, `dashboard/api-config.json` ile Render API’ye bağlanır
- Arama arka planda iş olarak çalışır; istemci sonucu poll eder (uzun tarama kopmaz)

## [1.2.2] — 2026-08-14


### Fixed
- Telefonda GitHub Pages üzerinden aramada HTTP 405: Pages arama API’si sunmaz
- Form native POST engellendi; net hata mesajı
- Sunucu `0.0.0.0` dinler; konsola telefon WiFi adresi yazılır

## [1.2.1] — 2026-08-14

### Changed
- Üst sekmeler: Araştırma / Takip / Geçmiş (Ürün Ekle kaldırıldı)
- Takip salt görüntüleme (pasif)
- Geçmiş = yapılan aramalar (`/api/search-history`)
- Platform grupları tıklanabilir chip + Tümünü seç/kaldır
- Mobil/online açıklama banner’ı kaldırıldı
- Platform listesi `sources-meta.json` ile sunucusuz da yüklenir

## [1.2.0] — 2026-08-14

### Added
- SemVer kurgusu (`CHANGELOG`, `/api/health` version, UI rozeti)
- Araştırma: **Türkiye** / **Uluslararası** mod seçimi
- Türkiye sonuçlarında sıralama (fiyat ↑↓, platform) ve sıra numarası
- Sonuçlardan isteğe bağlı **Takibe kaydet**
- Uluslararası pazar iskeleti (`config/international-markets.json`) — arama henüz yok

### Notes
- Bu sürüm önceliği: girilen ürünü Türkiye’deki seçili platformlarda araştırıp sıralamak
- Mod 2 (uluslararası) UI’da görünür; connector’lar 2.0.0’da gelecek

## [1.1.0] — 2026-08-14

### Added
- Telefon (GitHub Pages) + lokal sync (`sync-from-github.bat`)
- Mobil banner, PWA manifest, varsayılan Takip sekmesi

## [1.0.0] — 2026-08

### Added
- Web araştırma, katalog siteleri, PDF rapor, ürün ekleme, günlük Actions tarama
