import { getMarketplaceConnectorForUrl, searchAllMarketplaces } from "../connectors/marketplaces/index.js";
import { searchAllAggregators } from "../connectors/aggregators/index.js";
import * as genericSite from "../connectors/standalone/genericSite.js";
import {
  loadResearchCatalog,
  resolveSources,
  searchCatalogSources,
  defaultCategoryIds,
} from "../connectors/catalog-search.js";
import { todayDateString } from "./offer.js";
import { randomDelay } from "./browser.js";
import { computeAggregates, markOutlierOffers } from "./metrics.js";
import { throwIfCancelled } from "./search-cancel.js";

/**
 * Ayni platform+satici+fiyat mukerrerlerini ayiklar.
 * @param {import("./offer.js").Offer[]} offers
 */
export function dedupeOffers(offers) {
  const seen = new Set();
  const result = [];
  for (const o of offers ?? []) {
    const key = `${o.platform}::${o.seller_name}::${o.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(o);
  }
  return result;
}

/** Arama metninden guvenli SKU uretir. */
export function skuFromQuery(query) {
  const slug = String(query ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9ğüşıöç]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug ? `SEARCH-${slug.toUpperCase()}` : `SEARCH-${Date.now()}`;
}

/**
 * Config urunu icin tum kaynaklardan teklif toplar (pazaryeri + aggregator + standalone).
 * @param {{sku: string, name?: string, marketplaces?: Record<string,string>, aggregatorQuery?: string, standalone?: Array<{url:string, platform?: string, override?: object}>}} product
 */
export async function scrapeProduct(product) {
  const offers = [];
  const sku = product.sku;

  const warnings = [];

  for (const [platformKey, url] of Object.entries(product.marketplaces ?? {})) {
    throwIfCancelled();
    if (!url) continue;
    const connector = getMarketplaceConnectorForUrl(url);
    if (!connector) {
      const msg = `"${platformKey}" icin bilinen bir connector yok (url: ${url})`;
      console.warn(`[${sku}] ${msg}`);
      warnings.push(msg);
      continue;
    }
    try {
      const result = await connector.fetchOffers({ sku, url });
      offers.push(...result);
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const msg = `${platformKey} cekilemedi: ${err.message}`;
      console.warn(`[${sku}] ${msg}`);
      warnings.push(msg);
    }
    await randomDelay();
  }

  if (product.aggregatorQuery) {
    throwIfCancelled();
    try {
      const { offers: aggregatorOffers, errors } = await searchAllAggregators({ sku, query: product.aggregatorQuery });
      offers.push(...aggregatorOffers);
      for (const err of errors ?? []) {
        warnings.push(`${err.platform}: ${shortenBrowserError(err.message)}`);
      }
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const msg = `aggregator aramasi basarisiz: ${err.message}`;
      console.warn(`[${sku}] ${msg}`);
      warnings.push(msg);
    }
  }

  for (const entry of product.standalone ?? []) {
    throwIfCancelled();
    try {
      const offer = await genericSite.fetchOffer({
        sku,
        url: entry.url,
        platform: entry.platform,
        override: entry.override,
      });
      offers.push(offer);
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const msg = `bagimsiz site cekilemedi (${entry.url}): ${err.message}`;
      console.warn(`[${sku}] ${msg}`);
      warnings.push(msg);
    }
    await randomDelay();
  }

  return { offers, warnings };
}

function shortenBrowserError(message) {
  if (/Executable doesn't exist|playwright install/i.test(message)) {
    return "Playwright tarayicisi eksik — `npx playwright install chromium` calistirin";
  }
  return String(message).split("\n")[0].slice(0, 180);
}

/**
 * Manuel web aramasi: katalog kategorileri + dedicated connector'lar + istege bagli URL.
 * @param {{query: string, sku?: string, marketplaceUrls?: string[], categories?: string[], maxGeneric?: number}} input
 */
export async function runSearchSession(input) {
  const query = String(input.query ?? "").trim();
  if (!query) {
    throw new Error("Arama sorgusu bos olamaz");
  }

  const sku = input.sku?.trim() || skuFromQuery(query);
  const marketplaceUrls = (input.marketplaceUrls ?? [])
    .map((u) => String(u).trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const catalog = await loadResearchCatalog();
  const categories = Array.isArray(input.categories) && input.categories.length
    ? input.categories
    : defaultCategoryIds(catalog);
  const selectedSources = resolveSources(catalog, { categories });
  const maxGeneric = Number.isFinite(input.maxGeneric) ? input.maxGeneric : 25;

  const marketplaces = {};
  for (const url of marketplaceUrls) {
    const connector = getMarketplaceConnectorForUrl(url);
    const key = connector?.platform ?? new URL(url).hostname;
    marketplaces[key] = url;
  }

  const product = {
    sku,
    name: query,
    marketplaces,
    // Aggregator'lar her zaman (kategori bagimsiz) — genis satici kapsami icin
    aggregatorQuery: query,
    standalone: [],
  };

  const { offers: fromUrlsAndAggregators, warnings } = await scrapeProduct(product);
  throwIfCancelled();

  // Dedicated pazaryeri connector'lari (Trendyol/HB/n11/Amazon) — pazaryeri kategorisi aciksa
  let marketplaceSearchOffers = [];
  const runDedicatedMp = categories.includes("pazaryeri");
  if (runDedicatedMp) {
    const excludePlatforms = Object.keys(marketplaces);
    try {
      const { offers, errors } = await searchAllMarketplaces({ sku, query, excludePlatforms });
      marketplaceSearchOffers = offers;
      for (const err of errors ?? []) {
        warnings.push(`${err.platform}: ${shortenBrowserError(err.message)}`);
      }
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      warnings.push(`pazaryeri aramasi: ${shortenBrowserError(err.message)}`);
    }
  }

  throwIfCancelled();

  // Katalogdaki generic siteler (secili kategoriler)
  let catalogOffers = [];
  const genericPool = selectedSources
    .filter((s) => s.mode === "generic" && s.searchUrl)
    .slice(0, maxGeneric);
  if (genericPool.length) {
    try {
      const { offers, errors } = await searchCatalogSources({ sku, query, sources: genericPool });
      catalogOffers = offers;
      for (const err of errors ?? []) {
        warnings.push(`${err.platform}: ${shortenBrowserError(err.message)}`);
      }
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      warnings.push(`katalog aramasi: ${shortenBrowserError(err.message)}`);
    }
  }

  const plannedSkipped = selectedSources.filter((s) => s.mode === "planned").map((s) => s.name);
  if (plannedSkipped.length) {
    warnings.push(`Henuz otomatik degil (atlaniyor): ${plannedSkipped.slice(0, 8).join(", ")}${plannedSkipped.length > 8 ? "…" : ""}`);
  }

  const rawOffers = [...fromUrlsAndAggregators, ...marketplaceSearchOffers, ...catalogOffers];
  const offers = markOutlierOffers(dedupeOffers(rawOffers)).sort((a, b) => a.price - b.price);
  const aggregate = computeAggregates(offers);

  const platformMap = new Map();
  for (const o of offers) {
    platformMap.set(o.platform, (platformMap.get(o.platform) ?? 0) + 1);
  }
  const platforms = [...platformMap.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);

  return {
    id: `${todayDateString()}_${Date.now()}`,
    query,
    sku,
    mode: "tr",
    region: "TR",
    generatedAt: new Date().toISOString(),
    date: todayDateString(),
    marketplaceUrls,
    categories,
    searchedSources: [
      ...selectedSources.filter((s) => s.mode === "dedicated").map((s) => s.id),
      ...genericPool.map((s) => s.id),
    ],
    offers,
    aggregate,
    platforms,
    warnings,
  };
}
