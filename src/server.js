import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { closeBrowser } from "./core/browser.js";
import { runSearchSession } from "./core/search-session.js";
import { buildPdfReport } from "./report/pdf-report.js";
import { loadResearchCatalog, catalogSummary } from "./connectors/catalog-search.js";
import { beginSearch, requestCancel, endSearch } from "./core/search-cancel.js";
import { APP_VERSION, versionLabel } from "./core/version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const SEARCHES_DIR = path.join(ROOT, "data", "searches");
const PRODUCTS_PATH = path.join(ROOT, "config", "products.json");
const HISTORY_PATH = path.join(ROOT, "data", "product-history.json");
const INTL_MARKETS_PATH = path.join(ROOT, "config", "international-markets.json");
const MARKETPLACE_PLATFORMS = ["trendyol", "hepsiburada", "n11", "amazon_tr"];
const PORT = Number(process.env.PORT) || 3456;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(DASHBOARD_DIR));

/** Ayni anda tek arama — Playwright kaynaklarini korumak icin. */
let searchLock = false;
let activeGeneration = 0;
/** Son basarili arama (PDF icin bellek onbellegi). */
let lastSearch = null;

async function persistSearch(result) {
  await mkdir(SEARCHES_DIR, { recursive: true });
  const filePath = path.join(SEARCHES_DIR, `${result.id}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2), "utf-8");
  return filePath;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    searching: searchLock,
    version: APP_VERSION,
    label: versionLabel(),
  });
});

app.get("/api/version", (_req, res) => {
  res.json({ version: APP_VERSION, label: versionLabel() });
});

app.get("/api/international-markets", async (_req, res) => {
  try {
    res.json(await readJsonFile(INTL_MARKETS_PATH, { regions: [], status: "missing" }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Arama sonucundan takip listesine kaydet (istege bagli). */
app.post("/api/search/save-tracked", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const skuRaw = typeof req.body?.sku === "string" ? req.body.sku.trim() : "";
  const offers = Array.isArray(req.body?.offers) ? req.body.offers : [];
  if (!query && !skuRaw) {
    res.status(400).json({ error: "query veya sku gerekli" });
    return;
  }

  const sku = skuRaw || `TR-${Date.now().toString(36).toUpperCase()}`;
  const products = await readJsonFile(PRODUCTS_PATH, []);
  if (products.some((p) => p.sku === sku)) {
    res.status(409).json({ error: `"${sku}" zaten takip listesinde` });
    return;
  }

  const marketplaces = {};
  for (const platform of MARKETPLACE_PLATFORMS) {
    const hit = offers.find((o) => o?.platform === platform && o?.product_url);
    if (hit?.product_url) marketplaces[platform] = hit.product_url;
  }

  const product = {
    sku,
    name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : query || sku,
    marketplaces,
    aggregatorQuery: query || undefined,
    standalone: [],
  };

  try {
    products.push(product);
    await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2), "utf-8");
    const history = await readJsonFile(HISTORY_PATH, []);
    history.push({ ...product, addedAt: new Date().toISOString(), source: "search-save" });
    await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
    await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- urun ekleme / ekleme gecmisi ---------- */

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

function sanitizeMarketplaces(input) {
  const marketplaces = {};
  for (const platform of MARKETPLACE_PLATFORMS) {
    const url = typeof input?.[platform] === "string" ? input[platform].trim() : "";
    if (url) marketplaces[platform] = url;
  }
  return marketplaces;
}

function sanitizeStandalone(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => ({
      url: typeof entry?.url === "string" ? entry.url.trim() : "",
      platform: typeof entry?.platform === "string" ? entry.platform.trim() : "",
    }))
    .filter((entry) => entry.url)
    .map((entry) => (entry.platform ? entry : { url: entry.url }));
}

app.get("/api/product-history", async (_req, res) => {
  res.json(await readJsonFile(HISTORY_PATH, []));
});

app.post("/api/products", async (req, res) => {
  const sku = typeof req.body?.sku === "string" ? req.body.sku.trim() : "";
  if (!sku) {
    res.status(400).json({ error: "SKU zorunludur" });
    return;
  }

  const products = await readJsonFile(PRODUCTS_PATH, []);
  if (products.some((p) => p.sku === sku)) {
    res.status(409).json({ error: `"${sku}" zaten mevcut` });
    return;
  }

  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : sku;
  const marketplaces = sanitizeMarketplaces(req.body?.marketplaces);
  const aggregatorQuery = typeof req.body?.aggregatorQuery === "string" ? req.body.aggregatorQuery.trim() : "";
  const standalone = sanitizeStandalone(req.body?.standalone);

  const product = { sku, name, marketplaces, aggregatorQuery: aggregatorQuery || undefined, standalone };

  try {
    products.push(product);
    await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2), "utf-8");

    const history = await readJsonFile(HISTORY_PATH, []);
    history.push({ ...product, addedAt: new Date().toISOString() });
    await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
    await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");

    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sources", async (_req, res) => {
  try {
    const catalog = await loadResearchCatalog();
    res.json(catalogSummary(catalog));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/search/cancel", (_req, res) => {
  const state = requestCancel();
  console.log("[web] arama iptal istendi");
  res.json({ ok: true, ...state, searching: searchLock });
});

app.post("/api/search", async (req, res) => {
  if (searchLock) {
    res.status(409).json({
      error: "Su anda baska bir arama devam ediyor.",
      code: "SEARCH_IN_PROGRESS",
      searching: true,
    });
    return;
  }

  const query = String(req.body?.query ?? "").trim();
  if (!query) {
    res.status(400).json({ error: "query zorunlu" });
    return;
  }

  const marketplaceUrls = Array.isArray(req.body?.marketplaceUrls)
    ? req.body.marketplaceUrls
    : String(req.body?.marketplaceUrlsText ?? "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

  const categories = Array.isArray(req.body?.categories) ? req.body.categories : undefined;
  const maxGeneric = req.body?.maxGeneric;

  searchLock = true;
  activeGeneration = beginSearch();
  const started = Date.now();
  console.log(`[web] arama basladi: "${query}" (+${marketplaceUrls.length} URL, cats=${(categories ?? ["default"]).join(",")})`);

  // Istek iptal edilirse (AbortController) sunucu tarafinda da iptal bayragini kaldir
  req.on("close", () => {
    if (searchLock) {
      requestCancel();
      console.log("[web] istemci baglantisi kapandi — iptal bayragi set");
    }
  });

  try {
    const result = await runSearchSession({
      query,
      sku: req.body?.sku,
      marketplaceUrls,
      categories,
      maxGeneric,
    });
    lastSearch = result;
    const saved = await persistSearch(result).catch((err) => {
      console.warn(`[web] arama kaydedilemedi: ${err.message}`);
      return null;
    });
    console.log(`[web] arama bitti: ${result.offers.length} teklif, ${Date.now() - started}ms${saved ? ` -> ${path.relative(ROOT, saved)}` : ""}`);
    if (!res.writableEnded) res.json(result);
  } catch (err) {
    if (err.code === "SEARCH_CANCELLED") {
      console.log(`[web] arama iptal edildi (${Date.now() - started}ms)`);
      if (!res.writableEnded) res.status(499).json({ error: "Arama iptal edildi", code: "SEARCH_CANCELLED" });
    } else {
      console.error("[web] arama hatasi:", err);
      if (!res.writableEnded) res.status(500).json({ error: err.message ?? "Arama basarisiz" });
    }
  } finally {
    endSearch(activeGeneration);
    searchLock = false;
    await closeBrowser().catch(() => {});
  }
});

app.post("/api/report.pdf", async (req, res) => {
  try {
    let report = req.body?.report ?? null;
    if (!report && req.body?.searchId) {
      const filePath = path.join(SEARCHES_DIR, `${req.body.searchId}.json`);
      report = JSON.parse(await readFile(filePath, "utf-8"));
    }
    if (!report && lastSearch) report = lastSearch;
    if (!report?.offers) {
      res.status(400).json({ error: "Rapor icin once arama yapin veya report/searchId gonderin." });
      return;
    }

    const pdf = await buildPdfReport(report);
    const safeName = String(report.query ?? "rapor")
      .replace(/[^\w\-ğüşıöçĞÜŞİÖÇ]+/gi, "_")
      .slice(0, 40);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="fiyat-raporu-${safeName}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[web] PDF hatasi:", err);
    res.status(500).json({ error: err.message ?? "PDF olusturulamadi" });
  }
});

app.listen(PORT, () => {
  console.log(`[web] Fiyat Arastirma ${versionLabel()} — http://localhost:${PORT}`);
  console.log(`[web] Mod 1: Turkiye arastirma | Mod 2 (v2): uluslararasi (yakinda)`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[web] Port ${PORT} dolu. Onceki sunucuyu kapatin veya PORT=3457 npm run web`);
  } else {
    console.error("[web] sunucu hatasi:", err);
  }
  process.exitCode = 1;
});
