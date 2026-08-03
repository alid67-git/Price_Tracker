import { makeOffer, todayDateString } from "../../core/offer.js";
import { newContext, randomDelay, withRetry } from "../../core/browser.js";
import { parseTurkishPrice } from "../../core/utils.js";

export const platform = "cimri";

// Cimri React/CSS-modules tabanli, siniflar derlemeden derlemeye degisiyor (hash'li).
// Bu yuzden sabit bir CSS selector yerine sayfa metnindeki "X dk/saat once
// guncellendi" ifadesi capa alinip o satirin cevresindeki metinden magaza
// adi+fiyat cikariliyor -- daha kirilgan ama siteler-arasi en dayanikli secenek
// (canli inceleme ile bu ifadenin sadece gercek fiyat satirlarinda goruldugu,
// ilgili urun kartlarinda gorulmedigi dogrulandi).
const SELECTORS = {
  searchResultDetailButton: 'button:has-text("fiyatı incele")',
  updatedAgoText: /önce güncellendi/,
};

async function extractOfferRows(page) {
  const rows = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("body *"));
    const updateLeafNodes = all.filter(
      (el) => el.children.length === 0 && /önce güncellendi/.test(el.textContent || "")
    );
    const results = [];
    for (const node of updateLeafNodes) {
      let el = node;
      let rowText = null;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        const text = el.textContent || "";
        if (/TL/.test(text) && text.length < 600) rowText = text;
        if (text.length > 600) break;
      }
      if (rowText) results.push(rowText.replace(/\s+/g, " ").trim());
    }
    return results;
  });
  return rows;
}

// DOM metin dugumleri arasinda bosluk olmadigi icin promosyon banner metni
// dogrudan satici adiyla birlesebiliyor (ornegin "...varan indirimylmzhome17.296,85 TL"
// -- "indirim" ile "ylmzhome" arasinda hicbir ayrac yok). Bilinen kalip sonlarini
// once temizleyip geri kalan harf dizisini satici adi olarak aliyoruz. Yeni
// promosyon kaliplari canli sitede gorulduk oldukca buraya eklenmeli.
const KNOWN_PROMO_SUFFIXES = [/.*varan indirim/i, /.*Fırsatlarıyla Aradığınız Her Şey [^,]*'d[ae]/i];

function parseRow(rowText) {
  const priceMatch = rowText.match(/(\d[\d.]*,\d{2})\s*TL/);
  if (!priceMatch) return null;
  const price = parseTurkishPrice(`${priceMatch[1]} TL`);
  if (!price) return null;

  let before = rowText.slice(0, priceMatch.index);
  for (const pattern of KNOWN_PROMO_SUFFIXES) {
    before = before.replace(pattern, "");
  }
  const nameMatch = before.match(/([A-Za-zÇĞİÖŞÜçğıöşü]{2,30})$/);
  if (!nameMatch) return null;

  const shipping_info = /Ücretsiz/i.test(rowText) ? "Ücretsiz Kargo" : null;
  return { seller_name: nameMatch[1], price, shipping_info };
}

/**
 * Urun adiyla cimri'de arar, ilk sonucun magaza kirilimini Offer[] olarak
 * dondurur. Site tamamen istemci tarafinda render edildigi icin Playwright
 * gerekiyor (SSR/JSON-LD yok, canli inceleme ile dogrulandi).
 */
export async function search({ sku, query }) {
  const date = todayDateString();
  const context = await newContext();
  try {
    const page = await context.newPage();
    const searchUrl = `https://www.cimri.com/arama?q=${encodeURIComponent(query)}`;

    await withRetry(
      async () => {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForSelector(SELECTORS.searchResultDetailButton, { timeout: 8000 });
      },
      { label: "cimri-search" }
    );

    const detailButton = page.locator(SELECTORS.searchResultDetailButton).first();
    if ((await detailButton.count()) === 0) {
      console.warn(`[cimri] "${query}" icin sonuc bulunamadi`);
      return [];
    }
    await detailButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector(`text=/önce güncellendi/`, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);

    const rows = await extractOfferRows(page);
    const offers = [];
    const seenSellers = new Set();
    for (const rowText of rows) {
      const parsed = parseRow(rowText);
      if (!parsed || seenSellers.has(parsed.seller_name)) continue;
      seenSellers.add(parsed.seller_name);
      try {
        offers.push(
          makeOffer({
            sku,
            source_type: "aggregator",
            platform,
            seller_name: parsed.seller_name,
            price: parsed.price,
            stock_status: "unknown",
            shipping_info: parsed.shipping_info,
            product_url: page.url(),
            date,
          })
        );
      } catch (err) {
        console.warn(`[cimri] gecersiz teklif atlandi: ${err.message}`);
      }
    }

    await randomDelay();
    return offers;
  } finally {
    await context.close();
  }
}
