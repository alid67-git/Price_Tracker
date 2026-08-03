import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMarketplaceConnectorForUrl } from "./connectors/marketplaces/index.js";
import { searchAllAggregators } from "./connectors/aggregators/index.js";
import * as genericSite from "./connectors/standalone/genericSite.js";
import { todayDateString } from "./core/offer.js";
import { closeBrowser, randomDelay } from "./core/browser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "config", "products.json");
const DATA_DIR = path.join(ROOT, "data");

async function loadProducts() {
  const raw = await readFile(PRODUCTS_PATH, "utf-8");
  return JSON.parse(raw);
}

/** Tek bir urun icin tum kaynaklardan (pazaryeri+aggregator+standalone) teklif toplar. */
async function scrapeProduct(product) {
  const offers = [];

  for (const [platformKey, url] of Object.entries(product.marketplaces ?? {})) {
    if (!url) continue;
    const connector = getMarketplaceConnectorForUrl(url);
    if (!connector) {
      console.warn(`[${product.sku}] "${platformKey}" icin bilinen bir connector yok (url: ${url})`);
      continue;
    }
    try {
      const result = await connector.fetchOffers({ sku: product.sku, url });
      offers.push(...result);
    } catch (err) {
      console.warn(`[${product.sku}] ${platformKey} cekilemedi: ${err.message}`);
    }
    await randomDelay();
  }

  if (product.aggregatorQuery) {
    try {
      const aggregatorOffers = await searchAllAggregators({ sku: product.sku, query: product.aggregatorQuery });
      offers.push(...aggregatorOffers);
    } catch (err) {
      console.warn(`[${product.sku}] aggregator aramasi basarisiz: ${err.message}`);
    }
  }

  for (const entry of product.standalone ?? []) {
    try {
      const offer = await genericSite.fetchOffer({
        sku: product.sku,
        url: entry.url,
        platform: entry.platform,
        override: entry.override,
      });
      offers.push(offer);
    } catch (err) {
      console.warn(`[${product.sku}] bagimsiz site cekilemedi (${entry.url}): ${err.message}`);
    }
    await randomDelay();
  }

  return offers;
}

async function writeProductData(sku, date, offers) {
  const dayDir = path.join(DATA_DIR, date);
  await mkdir(dayDir, { recursive: true });
  const filePath = path.join(dayDir, `${sku}.json`);
  await writeFile(filePath, JSON.stringify({ sku, date, offers }, null, 2), "utf-8");
  return filePath;
}

async function main() {
  const products = await loadProducts();
  const date = todayDateString();
  console.log(`[run-scrape] ${products.length} urun icin tarama basliyor (${date})`);

  let successCount = 0;
  let failCount = 0;

  for (const product of products) {
    console.log(`\n--- ${product.sku} (${product.name}) ---`);
    const offers = await scrapeProduct(product);
    if (offers.length === 0) {
      console.warn(`[${product.sku}] hicbir kaynaktan teklif alinamadi, gun icin bos kayit atlaniyor`);
      failCount++;
      continue;
    }
    const filePath = await writeProductData(product.sku, date, offers);
    console.log(`[${product.sku}] ${offers.length} teklif yazildi -> ${path.relative(ROOT, filePath)}`);
    successCount++;
  }

  await closeBrowser();
  console.log(`\n[run-scrape] tamamlandi: ${successCount} basarili, ${failCount} basarisiz urun`);
  // Bireysel urun/kaynak hatalari zaten yukarida loglanip atlandi -- tum
  // urunler basarisiz olmadikca (gercek bir alt yapi sorunu) exit code 0.
  if (successCount === 0 && products.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[run-scrape] beklenmeyen hata:", err);
  process.exitCode = 1;
});
