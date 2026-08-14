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
 * @param {{onProgress?: (p: object) => void}} [hooks]
 */
export async function runSearchSession(input, hooks = {}) {
  const onProgress = typeof hooks.onProgress === "function" ? hooks.onProgress : null;
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
  const runDedicatedMp = categories.includes("pazaryeri");
  const genericPool = selectedSources
    .filter((s) => s.mode === "generic" && s.searchUrl)
    .slice(0, maxGeneric);

  /** @type {Array<{id:string, name:string, url:string|null, kind:string, status:string, offerCount:number, error:string|null}>} */
  const siteStatuses = [];

  const pushSite = (entry) => {
    siteStatuses.push({
      id: entry.id,
      name: entry.name || entry.id,
      url: entry.url ?? null,
      kind: entry.kind,
      status: entry.status || "pending",
      offerCount: entry.offerCount ?? 0,
      error: entry.error ?? null,
    });
  };

  for (const url of marketplaceUrls) {
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep */
    }
    pushSite({ id: `url:${url}`, name: host, url, kind: "marketplace-url", status: "pending" });
  }
  for (const agg of ["akakce", "cimri"]) {
    pushSite({ id: agg, name: agg, url: null, kind: "aggregator", status: "pending" });
  }
  if (runDedicatedMp) {
    for (const c of ["trendyol", "hepsiburada", "n11", "amazon_tr"]) {
      pushSite({ id: c, name: c, url: null, kind: "marketplace", status: "pending" });
    }
  }
  for (const source of genericPool) {
    const searchUrl = source.searchUrl.replaceAll("{q}", encodeURIComponent(query));
    pushSite({
      id: source.id,
      name: source.name || source.id,
      url: searchUrl,
      kind: "catalog",
      status: "pending",
    });
  }

  const findSite = (id) => siteStatuses.find((s) => s.id === id);
  const emitProgress = (currentId = null) => {
    const current = currentId ? findSite(currentId) : siteStatuses.find((s) => s.status === "scanning") || null;
    onProgress?.({
      siteStatuses: siteStatuses.map((e) => ({ ...e })),
      marketplaceUrlStatuses: siteStatuses
        .filter((e) => e.kind === "marketplace-url")
        .map((e) => ({
          url: e.url,
          host: e.name,
          platform: e.id.startsWith("url:") ? null : e.id,
          status: e.status,
          offerCount: e.offerCount,
          error: e.error,
        })),
      currentSite: current
        ? { id: current.id, name: current.name, url: current.url, status: current.status }
        : null,
    });
  };
  emitProgress();

  const warnings = [];
  const urlOffers = [];

  for (const url of marketplaceUrls) {
    throwIfCancelled();
    const entry = findSite(`url:${url}`);
    if (!entry) continue;
    entry.status = "scanning";
    emitProgress(entry.id);

    const connector = getMarketplaceConnectorForUrl(url);
    if (!connector) {
      entry.status = "missing";
      entry.error = "bilinen connector yok";
      warnings.push(`"${entry.name}" icin bilinen bir connector yok`);
      emitProgress();
      continue;
    }

    try {
      const result = await connector.fetchOffers({ sku, url });
      urlOffers.push(...result);
      entry.offerCount = result.length;
      entry.status = result.length > 0 ? "found" : "missing";
      if (!result.length) entry.error = "teklif yok";
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      entry.status = "missing";
      entry.offerCount = 0;
      entry.error = shortenBrowserError(err.message);
      warnings.push(`${connector.platform} cekilemedi: ${entry.error}`);
    }
    emitProgress();
    await randomDelay();
  }

  const marketplaces = {};
  for (const url of marketplaceUrls) {
    const connector = getMarketplaceConnectorForUrl(url);
    if (connector) marketplaces[connector.platform] = url;
  }

  throwIfCancelled();
  let fromAggregators = [];
  try {
    const { offers, errors } = await searchAllAggregators({
      sku,
      query,
      onSource: (update) => {
        const entry = findSite(update.id);
        if (!entry) return;
        entry.status = update.status;
        entry.offerCount = update.offerCount ?? 0;
        entry.error = update.error ?? null;
        if (update.status === "scanning") emitProgress(entry.id);
        else emitProgress();
      },
    });
    fromAggregators = offers;
    for (const err of errors ?? []) {
      warnings.push(`${err.platform}: ${shortenBrowserError(err.message)}`);
    }
  } catch (err) {
    if (err.code === "SEARCH_CANCELLED") throw err;
    warnings.push(`aggregator aramasi: ${shortenBrowserError(err.message)}`);
  }

  throwIfCancelled();

  let marketplaceSearchOffers = [];
  if (runDedicatedMp) {
    const excludePlatforms = Object.keys(marketplaces);
    for (const id of excludePlatforms) {
      const entry = findSite(id);
      if (entry && entry.kind === "marketplace") {
        entry.status = "found";
        entry.error = "ek URL ile tarandi";
      }
    }
    try {
      const { offers, errors } = await searchAllMarketplaces({
        sku,
        query,
        excludePlatforms,
        onSource: (update) => {
          const entry = findSite(update.id);
          if (!entry) return;
          entry.status = update.status;
          entry.offerCount = update.offerCount ?? 0;
          entry.error = update.error ?? null;
          if (update.url) entry.url = update.url;
          if (update.status === "scanning") emitProgress(entry.id);
          else emitProgress();
        },
      });
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

  let catalogOffers = [];
  if (genericPool.length) {
    try {
      const { offers, errors } = await searchCatalogSources({
        sku,
        query,
        sources: genericPool,
        onSource: (update) => {
          const entry = findSite(update.id);
          if (!entry) return;
          entry.status = update.status;
          entry.offerCount = update.offerCount ?? 0;
          entry.error = update.error ?? null;
          if (update.url) entry.url = update.url;
          if (update.status === "scanning") emitProgress(entry.id);
          else emitProgress();
        },
      });
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

  const rawOffers = [...urlOffers, ...fromAggregators, ...marketplaceSearchOffers, ...catalogOffers];
  const offers = markOutlierOffers(dedupeOffers(rawOffers)).sort((a, b) => a.price - b.price);
  const aggregate = computeAggregates(offers);

  const platformMap = new Map();
  for (const o of offers) {
    platformMap.set(o.platform, (platformMap.get(o.platform) ?? 0) + 1);
  }
  const platforms = [...platformMap.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);

  emitProgress();

  return {
    id: `${todayDateString()}_${Date.now()}`,
    query,
    sku,
    mode: "tr",
    region: "TR",
    generatedAt: new Date().toISOString(),
    date: todayDateString(),
    marketplaceUrls,
    marketplaceUrlStatuses: siteStatuses
      .filter((e) => e.kind === "marketplace-url")
      .map((e) => ({
        url: e.url,
        host: e.name,
        platform: null,
        status: e.status,
        offerCount: e.offerCount,
        error: e.error,
      })),
    siteStatuses: siteStatuses.map((e) => ({ ...e })),
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
