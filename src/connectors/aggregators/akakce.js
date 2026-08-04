import { makeOffer, todayDateString } from "../../core/offer.js";
import { newContext, randomDelay, withRetry } from "../../core/browser.js";

export const platform = "akakce";

const SELECTORS = {
  productLink: 'a[href*="-fiyati,"]',
  // Urun detay sayfasindaki mağaza kirilimi bir Astro island bilesenine
  // gomulu JSON olarak geliyor (canli inceleme ile dogrulandi): her eleman
  // {vdName (magaza), pgNick (magaza icindeki satici), price, shipPrice, stock, url, ...}
  astroIslandWithOffers: 'astro-island[props*="initialPgList"]',
};

function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Astro'nun kompakt "[0, value]" seri-hale-getirme bicimini duz degerlere indirger.
 */
function unwrapAstroValue(v) {
  if (Array.isArray(v) && v.length === 2 && v[0] === 0) return unwrapAstroValue(v[1]);
  if (Array.isArray(v)) return v.map(unwrapAstroValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = unwrapAstroValue(val);
    return out;
  }
  return v;
}

async function extractListingsFromDetailPage(page, detailUrl) {
  await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector(SELECTORS.astroIslandWithOffers, { timeout: 8000 }).catch(() => {});

  const propsRaw = await page.getAttribute(SELECTORS.astroIslandWithOffers, "props").catch(() => null);
  if (!propsRaw) return [];

  let parsed;
  try {
    parsed = JSON.parse(decodeHtmlEntities(propsRaw));
  } catch (err) {
    console.warn(`[akakce] props JSON parse edilemedi: ${err.message}`);
    return [];
  }

  // Astro'nun serilestirme bicimi: initialPgList = [tipEtiketi, [[0,{...}], [0,{...}], ...]]
  // -- disaridaki tip etiketini atlayip gercek listeyi (ikinci eleman) aliyoruz.
  const rawList = Array.isArray(parsed.initialPgList) ? parsed.initialPgList[1] : null;
  const pgList = Array.isArray(rawList) ? unwrapAstroValue(rawList) : null;
  if (!Array.isArray(pgList)) return [];

  return pgList
    .map((entry) => ({
      store_name: entry.vdName ?? null,
      seller_nick: entry.pgNick ?? null,
      price: typeof entry.price === "number" ? entry.price : null,
      shipPrice: entry.shipPrice ?? 0,
      stock: entry.stock ?? null,
      // Magaza ozel URL varsa onu kullan; yoksa urun detay sayfasina dus.
      product_url: typeof entry.url === "string" && entry.url.startsWith("http") ? entry.url : detailUrl,
    }))
    .filter((e) => e.store_name && e.price !== null);
}

/**
 * Urun adiyla akakce'de arar, ilk (en alakali) sonucun tum magaza kirilimini
 * Offer[] olarak dondurur. Akakce her istegi bot korumasiyla engelleyebildigi
 * icin Playwright kullaniliyor; duz fetch() 403 aliyor (dogrulandi).
 */
export async function search({ sku, query, limit = 1 }) {
  const date = todayDateString();
  const context = await newContext();
  try {
    const page = await context.newPage();
    const searchUrl = `https://www.akakce.com/arama/?q=${encodeURIComponent(query)}`;

    await withRetry(
      async () => {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForSelector(SELECTORS.productLink, { timeout: 8000 });
      },
      { label: "akakce-search" }
    );

    const links = await page.$$eval(SELECTORS.productLink, (nodes) => nodes.map((n) => n.href));
    const uniqueLinks = [...new Set(links)].slice(0, limit);
    if (uniqueLinks.length === 0) {
      console.warn(`[akakce] "${query}" icin sonuc bulunamadi`);
      return [];
    }

    const offers = [];
    for (const detailUrl of uniqueLinks) {
      await randomDelay();
      const listings = await extractListingsFromDetailPage(page, detailUrl).catch((err) => {
        console.warn(`[akakce] detay sayfasi cekilemedi (${detailUrl}): ${err.message}`);
        return [];
      });
      for (const listing of listings) {
        try {
          offers.push(
            makeOffer({
              sku,
              source_type: "aggregator",
              platform,
              seller_name: listing.seller_nick ? `${listing.store_name} (${listing.seller_nick})` : listing.store_name,
              price: listing.price,
              stock_status:
                listing.stock === 0 ? "out_of_stock" : typeof listing.stock === "number" && listing.stock > 0 ? "in_stock" : "unknown",
              shipping_info: listing.shipPrice > 0 ? null : "Ücretsiz Kargo",
              product_url: listing.product_url,
              date,
            })
          );
        } catch (err) {
          console.warn(`[akakce] gecersiz teklif atlandi: ${err.message}`);
        }
      }
    }
    return offers;
  } finally {
    await context.close();
  }
}
