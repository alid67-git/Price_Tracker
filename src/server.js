import express from "express";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { closeBrowser } from "./core/browser.js";
import { runSearchSession } from "./core/search-session.js";
import { buildPdfReport } from "./report/pdf-report.js";
import { loadResearchCatalog, catalogSummary } from "./connectors/catalog-search.js";
import { beginSearch, requestCancel, endSearch } from "./core/search-cancel.js";
import { APP_VERSION, versionLabel } from "./core/version.js";
import { todayDateString } from "./core/offer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const SEARCHES_DIR = path.join(ROOT, "data", "searches");
const PRODUCTS_PATH = path.join(ROOT, "config", "products.json");
const HISTORY_PATH = path.join(ROOT, "data", "product-history.json");
const INTL_MARKETS_PATH = path.join(ROOT, "config", "international-markets.json");
const MARKETPLACE_PLATFORMS = ["trendyol", "hepsiburada", "n11", "amazon_tr"];
const PORT = Number(process.env.PORT) || 3456;
const IS_RENDER = process.env.RENDER === "true";
const DEFAULT_MAX_GENERIC = Number(process.env.MAX_GENERIC) || (IS_RENDER ? 12 : 25);

const app = express();

/** Telefondan / baska origin'den API cagrisi (tunnel veya LAN proxy) icin CORS */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(DASHBOARD_DIR));

/** Ayni anda tek arama — Playwright kaynaklarini korumak icin. */
let searchLock = false;
let activeGeneration = 0;
let currentJobId = null;
const searchJobs = new Map();
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
    jobId: currentJobId,
    version: APP_VERSION,
    label: versionLabel(),
    cloud: IS_RENDER,
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

app.get("/api/search-history", async (_req, res) => {
  try {
    await mkdir(SEARCHES_DIR, { recursive: true });
    const names = (await readdir(SEARCHES_DIR)).filter((f) => f.endsWith(".json"));
    const entries = [];
    for (const name of names) {
      try {
        const raw = JSON.parse(await readFile(path.join(SEARCHES_DIR, name), "utf-8"));
        entries.push({
          id: raw.id || name.replace(/\.json$/, ""),
          query: raw.query,
          sku: raw.sku,
          generatedAt: raw.generatedAt,
          date: raw.date,
          offerCount: Array.isArray(raw.offers) ? raw.offers.length : 0,
          categories: raw.categories ?? [],
          mode: raw.mode || "tr",
        });
      } catch {
        /* skip corrupt */
      }
    }
    entries.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/search-history/:id", async (req, res) => {
  try {
    const safe = String(req.params.id).replace(/[^a-zA-Z0-9_\-]/g, "");
    const filePath = path.join(SEARCHES_DIR, `${safe}.json`);
    const raw = await readFile(filePath, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") res.status(404).json({ error: "Arama kaydi bulunamadi" });
    else res.status(500).json({ error: err.message });
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
  res.json({ ok: true, ...state, searching: searchLock, jobId: currentJobId });
});

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    query: job.query,
    error: job.error ?? null,
    marketplaceUrlStatuses: job.marketplaceUrlStatuses ?? [],
    result: job.status === "done" ? job.result : undefined,
  };
}

async function executeSearchJob(job) {
  searchLock = true;
  currentJobId = job.id;
  activeGeneration = beginSearch();
  const started = Date.now();
  console.log(`[web] arama basladi: "${job.query}" id=${job.id}`);
  try {
    const result = await runSearchSession(
      {
        query: job.query,
        sku: job.sku,
        marketplaceUrls: job.marketplaceUrls,
        categories: job.categories,
        maxGeneric: job.maxGeneric,
      },
      {
        onProgress: ({ marketplaceUrlStatuses }) => {
          job.marketplaceUrlStatuses = marketplaceUrlStatuses;
        },
      }
    );
    result.id = job.id;
    job.marketplaceUrlStatuses = result.marketplaceUrlStatuses ?? job.marketplaceUrlStatuses ?? [];
    lastSearch = result;
    await persistSearch(result).catch((err) => {
      console.warn(`[web] arama kaydedilemedi: ${err.message}`);
    });
    job.status = "done";
    job.result = result;
    console.log(`[web] arama bitti: ${result.offers.length} teklif, ${Date.now() - started}ms`);
  } catch (err) {
    if (err.code === "SEARCH_CANCELLED") {
      job.status = "cancelled";
      job.error = "Arama iptal edildi";
      console.log(`[web] arama iptal edildi (${Date.now() - started}ms)`);
    } else {
      job.status = "error";
      job.error = err.message ?? "Arama basarisiz";
      console.error("[web] arama hatasi:", err);
    }
  } finally {
    endSearch(activeGeneration);
    searchLock = false;
    currentJobId = null;
    await closeBrowser().catch(() => {});
  }
}

app.get("/api/search/jobs/:id", (req, res) => {
  const id = String(req.params.id || "").replace(/[^a-zA-Z0-9_\-]/g, "");
  const job = searchJobs.get(id);
  if (!job) {
    res.status(404).json({ error: "Arama isi bulunamadi", status: "missing" });
    return;
  }
  res.json(publicJob(job));
});

app.post("/api/search", (req, res) => {
  if (searchLock) {
    res.status(409).json({
      error: "Su anda baska bir arama devam ediyor.",
      code: "SEARCH_IN_PROGRESS",
      searching: true,
      jobId: currentJobId,
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
  const maxGeneric = Number.isFinite(req.body?.maxGeneric) ? req.body.maxGeneric : DEFAULT_MAX_GENERIC;

  const id = `${todayDateString()}_${Date.now()}`;
  const job = {
    id,
    status: "running",
    query,
    sku: req.body?.sku,
    marketplaceUrls,
    marketplaceUrlStatuses: marketplaceUrls.map((url) => {
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* keep */
      }
      return { url, host, platform: null, status: "pending", offerCount: 0, error: null };
    }),
    categories,
    maxGeneric,
    startedAt: Date.now(),
    result: null,
    error: null,
  };
  searchJobs.set(id, job);
  executeSearchJob(job);
  res.status(202).json({ id, status: "running", query });
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

function lanListenUrls(port) {
  const urls = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (v4 && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[web] Fiyat Arastirma ${versionLabel()}`);
  console.log(`[web] PC:      http://localhost:${PORT}`);
  for (const url of lanListenUrls(PORT)) {
    console.log(`[web] Telefon: ${url}  (ayni WiFi)`);
  }
  console.log(`[web] Not: Telefondan arama icin Render URL veya ayni WiFi LAN adresi kullan.`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[web] Port ${PORT} dolu. Onceki sunucuyu kapatin veya PORT=3457 npm run web`);
  } else {
    console.error("[web] sunucu hatasi:", err);
  }
  process.exitCode = 1;
});
