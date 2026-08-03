import * as cheerio from "cheerio";
import { makeOffer, todayDateString } from "../../core/offer.js";
import { parseTurkishPrice, normalizeWhitespace } from "../../core/utils.js";
import { fetchRenderedHtml, randomDelay, withRetry } from "../../core/browser.js";

export const platform = "amazon_tr";

const SELECTORS = {
  // NOT: bilerek sadece buybox/corePrice konteynerleriyle SINIRLI tutuluyor.
  // Canli testte genel `.a-price .a-offscreen` selectoru (kapsam sinirlamasiz)
  // sayfadaki "sponsorlu urunler" karusel fiyatlarini yanlislikla yakalayip
  // tamamen alakasiz bir fiyat dondurdu -- bu yuzden kapsamsiz fallback YOK.
  // Bu ID'lerin hicbiri sayfada bulunamazsa (bazi urunlerde tek "kazanan"
  // buybox olmuyor, "Satın Alma Seçeneklerini Gör" akisina dusuyor), ana
  // sayfadan fiyat cikarilmaz ve tamamen offer-listing sayfasina guvenilir.
  priceCandidates: [
    "#corePrice_feature_div .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-offscreen",
    "#apex_desktop .a-offscreen",
    "#buybox .a-offscreen",
  ],
  byline: "#bylineInfo",
  availability: "#availability",
  outOfStockText: /stokta yok|tükendi|şu anda mevcut değil/i,
  // Amazon'un "Satın Alma Seçeneklerini Gör" (AOD - All Offers Display) widget'i
  // canli testte dogrulandi: her teklif ".aod-information-block" icinde, satici
  // adi "[id^=aod-offer-soldBy]" icinde guvenilir sekilde geliyor. Fiyat ise ayni
  // sayfada JS ile GEC ve tutarsiz doluyor (bazen hic dolmuyor) -- bu yuzden
  // fiyati bulunamayan tekliflerin atlanmasi (asagida) beklenen bir durum,
  // hata degil.
  offerListingRow: ".aod-information-block",
  offerSellerName: '[id^="aod-offer-soldBy"]',
  offerPrice: ".a-offscreen",
};

export function canHandle(url) {
  return /(^|\.)amazon\.com\.tr$/i.test(new URL(url).hostname);
}

function extractAsin(url) {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/i) ?? url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  return match ? match[1] : null;
}

function cleanSellerName(text) {
  let t = normalizeWhitespace(text);
  // "Cudy Store'u ziyaret edin" gibi TR iyelik ekleri ("'u", "'nu", "'yu"...)
  // cok bicimli oldugu icin -- "ziyaret edin" varsa ilk kesme isaretinden
  // once kalan kismi al, tum ek varyasyonlarini tek tek eslestirmeye calisma.
  // Amazon bazen duz (') yerine "akilli" tirnak (') kullaniyor, ikisi de kontrol edilir.
  if (/ziyaret edin/i.test(t)) t = t.split(/['’]/)[0];
  // AOD widget'inda "Satıcı <ad> Satıcı puanı 5 yıldız üzerinden ..." bicimi
  // geliyor -- ad kismi "Satıcı" ile "Satıcı puanı" arasinda.
  const soldByMatch = t.match(/^Satıcı\s+(.+?)\s+Satıcı puanı/i);
  if (soldByMatch) return soldByMatch[1].trim();
  t = t.replace(/tarafından (satılıyor|gönderiliyor).*/i, "").replace(/^satıcı[: ]*/i, "");
  return t.trim();
}

async function fetchMainOffer(url) {
  const html = await fetchRenderedHtml(url, { waitForSelector: SELECTORS.priceCandidates[0] });
  const $ = cheerio.load(html);

  let price = null;
  for (const sel of SELECTORS.priceCandidates) {
    const text = $(sel).first().text();
    price = parseTurkishPrice(text);
    if (price !== null) break;
  }

  const bylineRaw = $(SELECTORS.byline).first().text();
  const seller_name = bylineRaw ? cleanSellerName(bylineRaw) || "Amazon" : "Amazon";
  const availabilityText = $(SELECTORS.availability).first().text();
  const in_stock = !SELECTORS.outOfStockText.test(availabilityText);

  return { price, seller_name, in_stock };
}

async function fetchOtherOffers(asin) {
  if (!asin) return [];
  try {
    const html = await fetchRenderedHtml(`https://www.amazon.com.tr/gp/offer-listing/${asin}/`, {
      waitUntil: "networkidle",
      waitForSelector: SELECTORS.offerListingRow,
    });
    const $ = cheerio.load(html);
    const results = [];
    $(SELECTORS.offerListingRow).each((_, el) => {
      const $el = $(el);
      const name = cleanSellerName($el.find(SELECTORS.offerSellerName).first().text());
      const price = parseTurkishPrice($el.find(SELECTORS.offerPrice).first().text());
      if (name && price !== null) results.push({ seller_name: name, price });
    });
    return results;
  } catch (err) {
    console.warn(`[amazon_tr] diger satici sayfasi cekilemedi: ${err.message}`);
    return [];
  }
}

export async function fetchOffers({ sku, url }) {
  const date = todayDateString();
  const main = await withRetry(() => fetchMainOffer(url), { label: "amazon_tr-main" });

  const offers = [];
  if (main.price !== null) {
    offers.push(
      makeOffer({
        sku,
        source_type: "marketplace",
        platform,
        seller_name: main.seller_name,
        price: main.price,
        stock_status: main.in_stock ? "in_stock" : "out_of_stock",
        is_platform_official: /^amazon$/i.test(main.seller_name),
        product_url: url,
        date,
      })
    );
  }

  await randomDelay();
  const asin = extractAsin(url);
  const others = await fetchOtherOffers(asin);
  for (const other of others) {
    if (other.seller_name === main.seller_name) continue;
    try {
      offers.push(
        makeOffer({
          sku,
          source_type: "marketplace",
          platform,
          seller_name: other.seller_name,
          price: other.price,
          stock_status: "unknown",
          product_url: `https://www.amazon.com.tr/gp/offer-listing/${asin}/`,
          date,
        })
      );
    } catch (err) {
      console.warn(`[amazon_tr] gecersiz satici satiri atlandi: ${err.message}`);
    }
  }

  if (offers.length === 0) {
    throw new Error(`amazon_tr: hicbir teklif cikarilamadi (${url})`);
  }
  return offers;
}
