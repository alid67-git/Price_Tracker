import * as cheerio from "cheerio";
import { makeOffer, todayDateString } from "../../core/offer.js";
import { parseTurkishPrice, normalizeWhitespace } from "../../core/utils.js";
import { newContext, randomDelay, withRetry } from "../../core/browser.js";

export const platform = "trendyol";

// Selector/regex sabitleri tek yerde -- site guncellendiginde sadece burasi degisir.
const SELECTORS = {
  merchantName: ".merchant-name",
  priceWrapper: ".price-wrapper",
  // NOT: "Tükendi!" kelimesi sayfanin JS ceviri sozlugunde HER ZAMAN bulunuyor
  // (buton sablonu icin), gercek stok durumundan bagimsiz -- bu yuzden statik
  // metin aramasi yerine GORUNUR bir "Tukendi" rozetine bakiliyor (Playwright locator).
  soldOutBadge: "text=/^Tükendi!?$/",
  freeShippingText: /kargo bedava/i,
  otherSellersTrigger: "text=/diğer satıcı|tüm satıcı/i",
};

export function canHandle(url) {
  return /(^|\.)trendyol\.com$/i.test(new URL(url).hostname);
}

/**
 * Tek bir Playwright sayfasinda hem one cikan saticiyi hem de (varsa) "Diger
 * Saticilar" panelini cikarir. Duz fetch() 403 aldigi icin Playwright kullaniliyor
 * (bkz. core/browser.js aciklamasi).
 */
async function fetchAllOffers(url) {
  const context = await newContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector(SELECTORS.merchantName, { timeout: 8000 }).catch(() => {});

    const in_stock = (await page.locator(SELECTORS.soldOutBadge).count()) === 0;
    const html = await page.content();
    const $ = cheerio.load(html);

    let seller_name = null;
    try {
      seller_name = normalizeWhitespace($(SELECTORS.merchantName).first().text()) || null;
    } catch {
      /* asagida null kontrolu var */
    }

    let price = null;
    try {
      const priceText = normalizeWhitespace($(SELECTORS.priceWrapper).first().text());
      // Trendyol Plus banner'i ayni kutuda iki fiyat gosterebilir (Plus'a ozel + genel).
      // Genel musterinin odedigi fiyati almak icin bulunan TL tutarlarinin SONUNCUSU alinir.
      // NOT: Trendyol Plus arayuzu degisirse bu sezgisel kural canli bir urunle dogrulanmali.
      const matches = [...priceText.matchAll(/[\d.,]+\s*TL/g)].map((m) => parseTurkishPrice(m[0]));
      const valid = matches.filter((v) => v !== null);
      price = valid.length > 0 ? valid[valid.length - 1] : null;
    } catch {
      /* price null kalir */
    }

    const shipping_info = SELECTORS.freeShippingText.test($("body").text()) ? "Kargo Bedava" : null;

    // "Diger Saticilar" paneli varsa acmayi dene; yoksa/ acilmazsa sadece one cikan
    // teklif kullanilir (tek saticili urunlerde bu panel zaten yok).
    let others = [];
    try {
      const trigger = page.locator(SELECTORS.otherSellersTrigger).first();
      if ((await trigger.count()) > 0) {
        await trigger.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const rows = await page.$$eval(SELECTORS.merchantName, (nodes) =>
          nodes.map((n) => {
            const container = n.closest("li, div[class*='merchant'], div[class*='row']") ?? n.parentElement;
            return { name: n.textContent?.trim() ?? "", contextText: container?.textContent?.trim() ?? "" };
          })
        );
        others = rows
          .map((row) => {
            const priceMatch = row.contextText.match(/[\d.,]+\s*TL/);
            return { seller_name: row.name, price: priceMatch ? parseTurkishPrice(priceMatch[0]) : null };
          })
          .filter((r) => r.seller_name && r.price);
      }
    } catch (err) {
      console.warn(`[trendyol] diger saticilar cekilemedi: ${err.message}`);
    }

    return { seller_name, price, in_stock, shipping_info, others };
  } finally {
    await context.close();
  }
}

export async function fetchOffers({ sku, url }) {
  const date = todayDateString();
  const featured = await withRetry(() => fetchAllOffers(url), { label: "trendyol" });

  if (featured.price === null || !featured.seller_name) {
    throw new Error(`trendyol: fiyat/satici cikarilamadi (${url})`);
  }

  const offers = [
    makeOffer({
      sku,
      source_type: "marketplace",
      platform,
      seller_name: featured.seller_name,
      price: featured.price,
      stock_status: featured.in_stock ? "in_stock" : "out_of_stock",
      shipping_info: featured.shipping_info,
      is_platform_official: /^trendyol/i.test(featured.seller_name),
      product_url: url,
      date,
    }),
  ];

  for (const other of featured.others) {
    if (other.seller_name === featured.seller_name) continue; // ayni satici tekrar sayilmasin
    try {
      offers.push(
        makeOffer({
          sku,
          source_type: "marketplace",
          platform,
          seller_name: other.seller_name,
          price: other.price,
          stock_status: "unknown",
          product_url: url,
          date,
        })
      );
    } catch (err) {
      console.warn(`[trendyol] gecersiz satici satiri atlandi: ${err.message}`);
    }
  }

  await randomDelay();
  return offers;
}
