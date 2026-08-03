import * as cheerio from "cheerio";
import { makeOffer, todayDateString } from "../../core/offer.js";
import { fetchHtml, parseTurkishPrice, normalizeWhitespace } from "../../core/utils.js";
import { fetchRenderedHtml, randomDelay } from "../../core/browser.js";

export const sourceType = "standalone";

/**
 * Sayfadaki schema.org Product/Offer JSON-LD blogunu bulur. Coğu duzgun
 * kurulmus e-ticaret sitesinde bu SEO icin zaten mevcuttur -- CSS selector'dan
 * cok daha dayanikli bir kaynak.
 */
function extractJsonLdOffer($) {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const script of scripts) {
    let data;
    try {
      data = JSON.parse($(script).contents().text());
    } catch {
      continue;
    }
    const candidates = Array.isArray(data) ? data : data["@graph"] ?? [data];
    for (const node of candidates) {
      const type = node?.["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      const offerNode = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      if (!offerNode) continue;
      const price = Number(offerNode.price ?? offerNode.lowPrice);
      if (!Number.isFinite(price) || price <= 0) continue;
      return {
        name: node.name ?? null,
        price,
        currency: offerNode.priceCurrency ?? "TRY",
        in_stock: !/OutOfStock/i.test(offerNode.availability ?? ""),
      };
    }
  }
  return null;
}

/** config/products.json'da tanimli override selector'larla cheerio fallback. */
function extractWithOverrideSelectors($, override) {
  if (!override) return null;
  const priceText = override.price ? $(override.price).first().text() : "";
  const price = parseTurkishPrice(priceText);
  if (price === null) return null;
  const name = override.name ? normalizeWhitespace($(override.name).first().text()) : null;
  const in_stock = override.outOfStock ? $(override.outOfStock).length === 0 : true;
  return { name, price, currency: "TRY", in_stock };
}

/**
 * Bagimsiz/tekil satici siteleri icin jenerik scraper. Once hafif fetch()
 * dener; basarisiz olursa (403/bot-korumasi) Playwright ile render edilmis
 * HTML'e duser. Once JSON-LD, sonra (config'te tanimliysa) override selector'lar
 * denenir.
 * @param {{sku: string, url: string, platform: string, override?: {price?: string, name?: string, outOfStock?: string}}} params
 */
export async function fetchOffer({ sku, url, platform, override }) {
  const date = todayDateString();

  let html;
  try {
    html = await fetchHtml(url);
  } catch {
    html = await fetchRenderedHtml(url);
  }
  let $ = cheerio.load(html);
  let extracted = extractJsonLdOffer($) ?? extractWithOverrideSelectors($, override);

  if (!extracted) {
    // JSON-LD/override basarisizsa bir kez de render edilmis sayfayla dene
    // (JS ile gec yuklenen fiyat olabilir).
    html = await fetchRenderedHtml(url);
    $ = cheerio.load(html);
    extracted = extractJsonLdOffer($) ?? extractWithOverrideSelectors($, override);
  }

  if (!extracted) {
    throw new Error(`genericSite: fiyat cikarilamadi, JSON-LD veya override selector eksik/gecersiz (${url})`);
  }

  await randomDelay();
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return makeOffer({
    sku,
    source_type: sourceType,
    platform: platform ?? hostname,
    seller_name: hostname,
    price: extracted.price,
    currency: extracted.currency,
    stock_status: extracted.in_stock ? "in_stock" : "out_of_stock",
    is_platform_official: true,
    product_url: url,
    date,
  });
}
