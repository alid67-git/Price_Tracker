import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeAggregates, detectChanges, computeTrend, markOutlierOffers } from "./core/metrics.js";
import { dedupeOffers } from "./core/search-session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PRODUCTS_PATH = path.join(ROOT, "config", "products.json");
const SELLER_ALIASES_PATH = path.join(ROOT, "config", "seller_aliases.json");
const OUTPUT_PATH = path.join(ROOT, "dashboard", "summary.json");
const HISTORY_DAYS = 30;

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function applyAliases(offers, aliasMap) {
  return offers.map((o) => ({ ...o, seller_name: aliasMap[o.seller_name] ?? o.seller_name }));
}

/** data/YYYY-MM-DD/<sku>.json dosyalarinin tamamini SKU bazinda gruplayarak okur. */
async function loadAllDailyData() {
  const bySku = new Map();
  let dateDirs = [];
  try {
    dateDirs = (await readdir(DATA_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return bySku;
  }

  for (const date of dateDirs) {
    const dayDir = path.join(DATA_DIR, date);
    const files = (await readdir(dayDir)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const record = await readJson(path.join(dayDir, file), null);
      if (!record?.sku) continue;
      if (!bySku.has(record.sku)) bySku.set(record.sku, []);
      bySku.get(record.sku).push({ date: record.date ?? date, offers: record.offers ?? [] });
    }
  }
  for (const entries of bySku.values()) entries.sort((a, b) => a.date.localeCompare(b.date));
  return bySku;
}

function buildProductSummary(sku, name, dailyEntries, aliasMap) {
  const normalized = dailyEntries.map((e) => ({ date: e.date, offers: dedupeOffers(applyAliases(e.offers, aliasMap)) }));
  const recentHistory = normalized.slice(-HISTORY_DAYS);
  const latest = normalized[normalized.length - 1];
  const previous = normalized.length > 1 ? normalized[normalized.length - 2] : null;

  const latestOffers = markOutlierOffers(latest.offers).sort((a, b) => a.price - b.price);
  const aggregate = computeAggregates(latest.offers);
  const changes = previous ? detectChanges(previous.offers, latest.offers) : { newSellers: [], removedSellers: [], priceChanges: [] };
  const history = recentHistory.map((e) => ({ date: e.date, ...computeAggregates(e.offers) }));
  const trend = computeTrend(history.map((h) => h.min_price));

  return {
    sku,
    name: name ?? sku,
    latestDate: latest.date,
    latestOffers,
    aggregate,
    trend,
    history,
    changes: {
      newSellers: changes.newSellers.map((o) => ({ seller_name: o.seller_name, platform: o.platform, price: o.price })),
      removedSellers: changes.removedSellers.map((o) => ({ seller_name: o.seller_name, platform: o.platform, price: o.price })),
      priceChanges: changes.priceChanges,
    },
  };
}

async function main() {
  const [products, aliasConfig, bySku] = await Promise.all([
    readJson(PRODUCTS_PATH, []),
    readJson(SELLER_ALIASES_PATH, { aliases: {} }),
    loadAllDailyData(),
  ]);
  const aliasMap = aliasConfig.aliases ?? {};
  const nameBySkuFromConfig = new Map(products.map((p) => [p.sku, p.name]));

  const summaries = [];
  for (const [sku, entries] of bySku) {
    if (entries.length === 0) continue;
    summaries.push(buildProductSummary(sku, nameBySkuFromConfig.get(sku), entries, aliasMap));
  }
  summaries.sort((a, b) => (b.aggregate.price_spread_pct ?? 0) - (a.aggregate.price_spread_pct ?? 0));

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), products: summaries }, null, 2), "utf-8");
  console.log(`[build-dashboard-data] ${summaries.length} urun icin ozet yazildi -> ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error("[build-dashboard-data] beklenmeyen hata:", err);
  process.exitCode = 1;
});
