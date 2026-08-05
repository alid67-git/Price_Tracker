import * as cheerio from "cheerio";
import { makeOffer, todayDateString } from "../../core/offer.js";
import { parseTurkishPrice, normalizeWhitespace } from "../../core/utils.js";
import { fetchRenderedHtml, randomDelay, withRetry, newContext } from "../../core/browser.js";

export const platform = "n11";

const SELECTORS = {
  featuredSellerName: ".sidebarSellerArea-top-name",
  featuredPrice: ".newPrice",
  soldOutText: /tükendi|stokta yok/i,
  freeShippingText: /ücretsiz kargo/i,
  otherSellerItem: ".otherSellers .unifiedProduct",
  otherSellerName: ".name",
  otherSellerPrice: ".priceDisplay",
  otherSellerFreeShipping: ".freeShipment",
};

export function canHandle(url) {
  return /(^|\.)n11\.com$/i.test(new URL(url).hostname);
}

async function fetchPage(url) {
  const html = await fetchRenderedHtml(url, { waitForNonEmptyText: SELECTORS.featuredPrice });
  return cheerio.load(html);
}

export async function fetchOffers({ sku, url }) {
  const date = todayDateString();
  const $ = await withRetry(() => fetchPage(url), { label: "n11" });

  const seller_name = normalizeWhitespace($(SELECTORS.featuredSellerName).first().text()) || null;
  const priceText = normalizeWhitespace($(SELECTORS.featuredPrice).first().text());
  const price = parseTurkishPrice(priceText);
  const bodyText = $("body").text();
  const in_stock = !SELECTORS.soldOutText.test(bodyText);

  if (!seller_name || price === null) {
    throw new Error(`n11: fiyat/satici cikarilamadi (${url})`);
  }

  const offers = [
    makeOffer({
      sku,
      source_type: "marketplace",
      platform,
      seller_name,
      price,
      stock_status: in_stock ? "in_stock" : "out_of_stock",
      shipping_info: SELECTORS.freeShippingText.test(bodyText) ? "Ücretsiz Kargo" : null,
      is_platform_official: false,
      product_url: url,
      date,
    }),
  ];

  $(SELECTORS.otherSellerItem).each((_, el) => {
    const $el = $(el);
    const otherName = normalizeWhitespace($el.find(SELECTORS.otherSellerName).first().text());
    const otherPrice = parseTurkishPrice($el.find(SELECTORS.otherSellerPrice).first().text());
    if (!otherName || otherPrice === null || otherName === seller_name) return;
    try {
      offers.push(
        makeOffer({
          sku,
          source_type: "marketplace",
          platform,
          seller_name: otherName,
          price: otherPrice,
          stock_status: "unknown",
          shipping_info: $el.find(SELECTORS.otherSellerFreeShipping).length > 0 ? "Ücretsiz Kargo" : null,
          product_url: url,
          date,
        })
      );
    } catch (err) {
      console.warn(`[n11] gecersiz satici satiri atlandi: ${err.message}`);
    }
  });

  // NOT: "Diger Magazalar" alani sitede bir swiper icinde kismi listelenir
  // ("Tumu(N)" linki tam listeyi bir modalda acar). Bu MVP swiper'da o an
  // goruntulenen sac ayaklari cekiyor; modal'in tam listesi Playwright ile
  // "Tumu" linkine tiklanip acilmasi gerekebilir -- ileride genisletilebilir.
  await randomDelay();
  return offers;
}

/**
 * Serbest metinle n11'de arar, ilk urun URL'sini dondurur.
 * @param {string} query
 * @returns {Promise<string|null>}
 */
export async function searchFirstProductUrl(query) {
  const context = await newContext();
  try {
    const page = await context.newPage();
    const searchUrl = `https://www.n11.com/arama?q=${encodeURIComponent(query)}`;
    await withRetry(
      async () => {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForSelector('a[href*="/urun/"]', { timeout: 10000 });
      },
      { label: "n11-search" }
    );
    return await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/urun/"]')];
      for (const a of links) {
        try {
          const u = new URL(a.href, location.origin);
          if (!/n11\.com$/i.test(u.hostname)) continue;
          if (!u.pathname.startsWith("/urun/")) continue;
          return `${u.origin}${u.pathname}`;
        } catch {
          /* skip */
        }
      }
      return null;
    });
  } finally {
    await context.close();
  }
}
