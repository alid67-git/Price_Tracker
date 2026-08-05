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
İlk çalıştırmada bağımlılıkları kurar, sonra iki seçenek sunar:

- **[1] Araştırma web** (varsayılan): `npm run web` ile `src/server.js`'i başlatıp
  `http://localhost:3456`'ı açar. Dashboard'da dört sekme vardır:
  - **Araştırma**: anlık, manuel arama (bir ürünü tüm kaynaklardan tara, PDF rapor indir).
  - **Takip edilenler**: `npm run scrape` ile toplanan günlük veriden rekabet tablosu ve fiyat geçmişi.
  - **Ürün Ekle**: `npm run scrape`'in düzenli takip edeceği ürünleri forma girerek `config/products.json`'a ekleme (bkz. aşağıdaki bölüm).
  - **Geçmiş**: Ürün Ekle'den ne zaman ne eklendiğinin kaydı.
- **[2] Toplu tarama**: `npm run scrape` + `npm run build-dashboard` çalıştırıp "Takip edilenler" verisini günceller.

Elle çalıştırmak isterseniz:

```bash
npm run scrape            # tum urunleri tum kaynaklardan tara (Takip edilenler sekmesi icin)
npm run build-dashboard    # dashboard/summary.json'u guncelle
npm run web                # http://localhost:3456 -- arama + takip + urun ekleme + gecmis
npm run add-product        # config/products.json'a yeni urun eklemek icin interaktif CLI (alternatif)
```

### Dashboard'ı görüntüleme

`dashboard/index.html` doğrudan çift tıklanarak (`file://`) açılırsa Araştırma
sekmesi ve Ürün Ekle/Geçmiş'in yerel-sunucu modu çalışmaz (sunucuya ihtiyaç
duyarlar). Önerilen yol `npm run web` (veya `pricetracker.bat` → [1]) ile
`http://localhost:3456`'ı açmaktır.

`dashboard/` klasörü ayrıca `.github/workflows/pages.yml` ile otomatik olarak
GitHub Pages'e de yayınlanır (bkz. aşağıdaki "GitHub Actions" bölümü). Orada
"Takip edilenler" sekmesi `summary.json`'u statik olarak gösterir; "Ürün Ekle" ve
"Geçmiş" ise sunucu bulunamayınca otomatik olarak GitHub'a doğrudan commit atan
moda geçer (bir GitHub token gerekir, bkz. Ürün Ekle sekmesindeki ayarlar).
"Araştırma" sekmesi (canlı arama + PDF) ise her zaman `npm run web` sunucusunu
gerektirir, GitHub Pages'te çalışmaz.

## Yeni ürün ekleme

En pratik yol: `npm run web` (ya da `pricetracker.bat` → [1]) ile açılan
`http://localhost:3456` üzerinde **Ürün Ekle** sekmesi. SKU, ürün adı, pazaryeri
URL'leri, Akakçe/Cimri arama terimi ve bağımsız site bilgilerini bir formdan
girip `config/products.json`'a ekler -- eklenen ürün bir sonraki `npm run scrape`
çalışmasında (günlük otomatik ya da elle `workflow_dispatch`) dahil edilir.
Ne zaman hangi ürünün eklendiği **Geçmiş** sekmesinden görülebilir.

PC/yerel sunucu yoksa (örn. GitHub Pages üzerinden telefondan açıldığında) aynı
form otomatik olarak GitHub'ın Contents API'sine geçip doğrudan commit atar; bunun
için Ürün Ekle sekmesindeki ayarlar bölümünden, sadece bu repo için
**Contents: Read and write** izniyle sınırlı bir
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
girmeniz gerekir. Token yalnızca o cihazın tarayıcısında (`localStorage`) saklanır.

Alternatif olarak `npm run add-product` çalıştırıp SKU, ürün adı, her pazaryeri
için URL (boş bırakılabilir), Akakçe/Cimri arama terimi ve varsa bağımsız site
bilgilerini terminalden de girebilirsiniz. Elle düzenlemek isterseniz
`config/products.json`'daki şu şekli takip edin:

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
4. `.github/workflows/pages.yml`, `dashboard/` klasörü her değiştiğinde (yukarıdaki
   günlük tarama commit'i dahil) GitHub Pages'e otomatik deploy eder. İlk kullanımda
   bir kerelik **Settings → Pages → Build and deployment → Source → "GitHub Actions"**
   seçilmesi gerekir; sonrasında dashboard'a `https://<kullanici>.github.io/<repo>/`
   adresinden internetten de erişebilirsiniz (bkz. yukarıdaki "Dashboard'ı görüntüleme").

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
