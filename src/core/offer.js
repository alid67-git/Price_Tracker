// Ortak "Offer" (teklif) sekli. Her connector (pazaryeri/aggregator/standalone)
// bu sekli dondurur; UI ve metrics katmani hangi connector'dan geldigini bilmez.

/**
 * @typedef {Object} Offer
 * @property {string} sku
 * @property {"marketplace"|"aggregator"|"standalone"} source_type
 * @property {string} platform            // "trendyol" | "hepsiburada" | "n11" | "amazon_tr" | "akakce" | "cimri" | "<domain>"
 * @property {string} seller_name
 * @property {number} price
 * @property {string} currency
 * @property {"in_stock"|"out_of_stock"|"unknown"} stock_status
 * @property {string|null} shipping_info
 * @property {boolean} is_platform_official
 * @property {string} product_url
 * @property {string} date                // YYYY-MM-DD
 * @property {string} scraped_at           // ISO timestamp
 */

const REQUIRED_FIELDS = ["sku", "source_type", "platform", "seller_name", "price", "product_url", "date"];
const VALID_SOURCE_TYPES = new Set(["marketplace", "aggregator", "standalone"]);
const VALID_STOCK_STATUSES = new Set(["in_stock", "out_of_stock", "unknown"]);

/**
 * Ham connector ciktisini standart Offer seklinde normalize eder ve dogrular.
 * @param {Partial<Offer>} raw
 * @returns {Offer}
 */
export function makeOffer(raw) {
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null || raw[field] === "") {
      throw new Error(`Offer eksik alan: "${field}" (sku=${raw.sku ?? "?"}, platform=${raw.platform ?? "?"})`);
    }
  }
  if (!VALID_SOURCE_TYPES.has(raw.source_type)) {
    throw new Error(`Gecersiz source_type: ${raw.source_type}`);
  }
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Gecersiz fiyat: ${raw.price} (sku=${raw.sku}, platform=${raw.platform})`);
  }

  return {
    sku: raw.sku,
    source_type: raw.source_type,
    platform: raw.platform,
    seller_name: raw.seller_name,
    price,
    currency: raw.currency ?? "TRY",
    stock_status: VALID_STOCK_STATUSES.has(raw.stock_status) ? raw.stock_status : "unknown",
    shipping_info: raw.shipping_info ?? null,
    is_platform_official: Boolean(raw.is_platform_official),
    product_url: raw.product_url,
    date: raw.date,
    scraped_at: raw.scraped_at ?? new Date().toISOString(),
  };
}

export function todayDateString(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
