import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newContext, randomDelay, withRetry } from "../core/browser.js";
import { throwIfCancelled } from "../core/search-cancel.js";
import * as genericSite from "./standalone/genericSite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "..", "..", "config", "research-sources.json");

let cachedCatalog = null;

export async function loadResearchCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const raw = JSON.parse(await readFile(CATALOG_PATH, "utf-8"));
  cachedCatalog = raw;
  return raw;
}

export function defaultCategoryIds(catalog) {
  return (catalog.categories ?? []).filter((c) => c.defaultEnabled).map((c) => c.id);
}

export function resolveSources(catalog, { categories = null, sourceIds = null } = {}) {
  const sources = catalog.sources ?? [];
  if (sourceIds?.length) {
    const set = new Set(sourceIds);
    return sources.filter((s) => set.has(s.id));
  }
  const cats = categories?.length ? new Set(categories) : new Set(defaultCategoryIds(catalog));
  return sources.filter((s) => cats.has(s.category));
}

/**
 * Arama sayfasinda domain'e ait ilk urun linkini bulur.
 */
export async function findFirstProductUrl(source, query) {
  if (!source.searchUrl) return null;
  const searchUrl = source.searchUrl.replaceAll("{q}", encodeURIComponent(query));
  const context = await newContext();
  try {
    const page = await context.newPage();
    await withRetry(
      async () => {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1200);
      },
      { label: `${source.id}-search`, retries: 1 }
    );

    const domain = source.domain;
    const needles = source.productLinkIncludes ?? ["/"];
    const href = await page.evaluate(
      ({ domain, needles }) => {
        const links = [...document.querySelectorAll("a[href]")];
        for (const a of links) {
          try {
            const u = new URL(a.href, location.origin);
            if (!u.hostname.includes(domain)) continue;
            const path = u.pathname + u.search;
            if (path === "/" || path.length < 3) continue;
            if (/arama|search|login|cart|sepet|hesap|account|yardim|help/i.test(path)) continue;
            const ok = needles.some((n) => path.includes(n) || u.href.includes(n));
            if (!ok) continue;
            // Cok genel "/" needle'inda en az bir urun benzeri path iste
            if (needles.length === 1 && needles[0] === "/" && path.split("/").filter(Boolean).length < 1) continue;
            return `${u.origin}${u.pathname}`;
          } catch {
            /* skip */
          }
        }
        return null;
      },
      { domain, needles }
    );
    return href;
  } finally {
    await context.close();
  }
}

/**
 * Katalogdaki generic kaynaklari tarar.
 * @param {{sku: string, query: string, sources: object[]}} opts
 */
export async function searchCatalogSources({ sku, query, sources }) {
  const offers = [];
  const errors = [];
  const genericSources = (sources ?? []).filter((s) => s.mode === "generic" && s.searchUrl);

  for (const source of genericSources) {
    throwIfCancelled();
    try {
      const productUrl = await findFirstProductUrl(source, query);
      throwIfCancelled();
      if (!productUrl) {
        errors.push({ platform: source.id, message: "arama sonucu urun bulunamadi" });
        continue;
      }
      console.log(`[${source.id}] katalog eslesmesi: ${productUrl}`);
      const offer = await genericSite.fetchOffer({
        sku,
        url: productUrl,
        platform: source.id,
      });
      // Marka/magaza adini daha okunur yap
      offers.push({ ...offer, seller_name: source.name });
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const message = err.message ?? String(err);
      console.warn(`[${source.id}] katalog aramasi basarisiz: ${message}`);
      errors.push({ platform: source.id, message: message.split("\n")[0].slice(0, 160) });
    }
    await randomDelay(800, 1800);
  }

  return { offers, errors };
}

export function catalogSummary(catalog) {
  const byMode = {};
  for (const s of catalog.sources ?? []) {
    byMode[s.mode] = (byMode[s.mode] ?? 0) + 1;
  }
  return {
    total: catalog.sources?.length ?? 0,
    categories: catalog.categories ?? [],
    byMode,
    sources: (catalog.sources ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      mode: s.mode,
      domain: s.domain,
    })),
  };
}
