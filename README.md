# Fiyat Araştırma Sistemi

Trendyol, Hepsiburada, N11 ve Amazon.com.tr'deki **tüm alt satıcıları**, Akakçe/Cimri
fiyat karşılaştırma sitelerini ve istediğiniz bağımsız satıcı sitelerini takip edip
rekabet yoğunluğu (satıcı sayısı, fiyat aralığı/spread, trend) analiz eden bir sistem.

## Nasıl çalışır

- `config/products.json` içinde takip edilecek ürünler tanımlanır (SKU, isim, her
  pazaryeri için ürün URL'si, Akakçe/Cimri için arama terimi, varsa bağımsız site linkleri).
- `npm run scrape` bu listedeki her ürün için tüm kaynaklardan fiyat çeker ve
  `data/YYYY-AA-GG/<SKU>.json` altına o günün ham verisini yazar (üzerine yazılmaz,
  geçmiş korunur).
- `npm run build-dashboard` tüm günlerin verisini okuyup `dashboard/summary.json`
  özet dosyasını üretir (spread %, medyan, 30 günlük trend, bir önceki güne göre
  değişenler).
- `dashboard/index.html` bu özet dosyasını okuyup rekabet tablosu, ürün detayı ve
  fiyat geçmişi grafiği gösterir.
- `.github/workflows/scrape.yml` bunu her gün otomatik çalıştırıp sonuçları repoya
  commit'ler (GitHub Actions bir sunucuya ihtiyaç duymadan zamanlanmış çalışmayı sağlar).

## Kurulum

```bash
npm install
npx playwright install chromium
```

## Kullanım

En kolay yol: proje klasöründeki **`pricetracker.bat`** dosyasına çift tıklamak.
İlk çalıştırmada bağımlılıkları kurar, taramayı yapar, dashboard verisini üretir
ve dashboard'u tarayıcıda açar. Sonraki çalıştırmalarda sadece tarama+dashboard
adımlarını tekrarlar.

Elle çalıştırmak isterseniz:

```bash
npm run scrape            # tüm urunleri tum kaynaklardan tara
npm run build-dashboard    # dashboard/summary.json'u guncelle
npm run web                # dashboard + urun ekleme + gecmis web arayuzunu baslat (http://localhost:5173)
npm run add-product        # config/products.json'a yeni urun eklemek icin interaktif CLI (alternatif)
```

### Dashboard'ı görüntüleme

`dashboard/index.html` doğrudan çift tıklanarak (`file://`) açılırsa tarayıcılar
güvenlik nedeniyle yerel `summary.json` dosyasını `fetch()` ile okumaya izin
vermeyebilir, ayrıca ürün ekleme/geçmiş sayfaları da çalışmaz. Bu yüzden önerilen
yol `npm run web` ile yerel sunucuyu başlatmaktır. Alternatif olarak:

```bash
npx serve dashboard
```

(salt okunur görüntüleme, ürün ekleme/geçmiş API'leri çalışmaz) veya GitHub Pages
üzerinden `dashboard/` klasörünü yayınlayabilirsiniz (fetch http(s) üzerinden
sorunsuz çalışır, ama ürün ekleme yine sunucu gerektirir).

## Web arayüzünden ürün ekleme ve geçmiş

`npm run web` çalıştırıp `http://localhost:5173` adresini açın (pricetracker.bat
zaten tarama sonrası bunu otomatik başlatıp tarayıcıyı açar). Bu adres altında:

- **Panel**: mevcut dashboard (rekabet tablosu, fiyat geçmişi).
- **Ürün Ekle**: SKU, ürün adı, pazaryeri URL'leri, Akakçe/Cimri arama terimi ve
  bağımsız site bilgilerini bir formdan girip `config/products.json`'a ekleyebilirsiniz
  -- terminalden komut çalıştırmaya gerek kalmaz. Eklenen ürün bir sonraki
  `npm run scrape` çalışmasında otomatik dahil edilir.
- **Geçmiş**: web arayüzünden hangi ürünün ne zaman eklendiğini `data/product-history.json`
  üzerinden listeler.

Not: bu sayfalar `fetch()` ile API çağrısı yaptığından `dashboard/index.html`'i
doğrudan çift tıklayarak (`file://`) değil, `npm run web` ile başlatılan sunucu
üzerinden açmanız gerekir.

## Terminalden ürün ekleme (alternatif)

`npm run add-product` çalıştırıp SKU, ürün adı, her pazaryeri için URL (boş
bırakılabilir), Akakçe/Cimri arama terimi ve varsa bağımsız site bilgilerini girin.
Elle düzenlemek isterseniz `config/products.json`'daki şu şekli takip edin:

```json
{
  "sku": "ORNEK-SKU",
  "name": "Örnek Ürün",
  "marketplaces": {
    "trendyol": "https://www.trendyol.com/...",
    "hepsiburada": "https://www.hepsiburada.com/...",
    "n11": "https://www.n11.com/...",
    "amazon_tr": "https://www.amazon.com.tr/..."
  },
  "aggregatorQuery": "örnek ürün arama terimi",
  "standalone": [
    { "url": "https://bagimsiz-magaza.com/urun", "platform": "bagimsiz-magaza" }
  ]
}
```

`marketplaces` altındaki her alan opsiyoneldir -- sadece takip etmek istediğiniz
siteleri doldurun.

## Yeni bir site/connector ekleme

- Pazaryeri (link ile takip, tüm alt satıcılar): `src/connectors/marketplaces/`
  altına yeni bir dosya (`canHandle(url)`, `fetchOffers({sku, url})` dışa aktarsın),
  sonra `src/connectors/marketplaces/index.js`'teki listeye ekleyin.
- Fiyat karşılaştırma sitesi: `src/connectors/aggregators/` altına yeni bir dosya
  (`search({sku, query})` dışa aktarsın), sonra `index.js`'teki listeye ekleyin.
- Bağımsız/tekil satıcı sitesi: `config/products.json`'daki `standalone` dizisine
  URL eklemeniz yeterli, `genericSite.js` schema.org JSON-LD'den otomatik okur.
  JSON-LD yoksa/eksikse `override: {price: "css-selector", name: "css-selector"}`
  ile manuel selector tanımlayabilirsiniz.

## GitHub Actions ile otomatik tarama

1. Repoyu GitHub'a push edin.
2. `.github/workflows/scrape.yml` varsayılan olarak her gün 06:00 UTC'de (TR
   saatiyle ~09:00) çalışır; `workflow_dispatch` ile elle de tetiklenebilir
   (Actions sekmesinden "Run workflow").
3. Workflow, `data/` ve `dashboard/summary.json` değişikliklerini otomatik commit+push eder.
4. `dashboard/` klasörünü GitHub Pages'e bağlarsanız dashboard'a internetten de
   erişebilirsiniz.

## Bilinen kısıtlar

- **Hepsiburada**: canlı testte, temiz bir Playwright headless oturumunun bazen
  Hepsiburada'nın bot koruması ("Güvenlik" ara sayfası) tarafından engellendiği
  gözlemlendi. Connector kodu doğru (gerçek `window.productModel` verisiyle
  doğrulandı) ama bu korumaya takılırsa o ürün için o günkü veri atlanır ve
  hata loglanır -- sistem çökmez. Gerekirse ileride bir stealth eklentisi veya
  kalıcı/doğrulanmış tarayıcı oturumu eklenmesi gerekebilir.
- **Amazon.com.tr "Diğer Satıcılardan Satın Al" (AOD) widget'ı**: bazı ürünlerde
  satıcı adları güvenilir şekilde çekiliyor ama fiyat alanı JS ile çok geç/tutarsız
  doluyor; bu durumda o teklif atlanır (hata değil, sessizce dışlanır). Normal
  "tek kazanan" buybox'ı olan ürünlerde ana sayfa fiyatı sorunsuz çalışıyor.
- **Akakçe arama eşleştirmesi**: arama teriminize en alakalı ilk sonuç kullanılır;
  çok genel bir terim girerseniz yanlış ürünün fiyatları gelebilir, arama terimini
  spesifik tutun (marka + model gibi).
- Site yapıları zamanla değişebilir -- her connector'da selector'lar dosya başında
  ayrı bir blokta tutuluyor, biri bozulursa sadece o alan etkilenir.

## Test

```bash
npm test
```

`core/metrics.js` (spread/medyan/değişim tespiti) ve `core/utils.js` (TL fiyat
parse) için birim testleri çalıştırır.
