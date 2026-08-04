import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(ROOT_DIR, "dashboard");
const PRODUCTS_PATH = path.join(ROOT_DIR, "config", "products.json");
const HISTORY_PATH = path.join(ROOT_DIR, "data", "product-history.json");
const PORT = Number(process.env.PORT) || 5173;
const MARKETPLACE_PLATFORMS = ["trendyol", "hepsiburada", "n11", "amazon_tr"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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

async function handleAddProduct(req, res) {
  const body = await readBody(req);
  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  if (!sku) return sendJson(res, 400, { error: "SKU zorunludur" });

  const products = await readJson(PRODUCTS_PATH, []);
  if (products.some((p) => p.sku === sku)) {
    return sendJson(res, 409, { error: `"${sku}" zaten mevcut` });
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : sku;
  const marketplaces = sanitizeMarketplaces(body.marketplaces);
  const aggregatorQuery = typeof body.aggregatorQuery === "string" ? body.aggregatorQuery.trim() : "";
  const standalone = sanitizeStandalone(body.standalone);

  const product = { sku, name, marketplaces, aggregatorQuery: aggregatorQuery || undefined, standalone };
  products.push(product);
  await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2), "utf-8");

  const history = await readJson(HISTORY_PATH, []);
  history.push({ ...product, addedAt: new Date().toISOString() });
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");

  sendJson(res, 201, product);
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(DASHBOARD_DIR, relPath));

  if (filePath !== DASHBOARD_DIR && !filePath.startsWith(DASHBOARD_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const st = await stat(filePath);
    if (st.isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/product-history") {
      return sendJson(res, 200, await readJson(HISTORY_PATH, []));
    }
    if (req.method === "POST" && req.url === "/api/products") {
      return await handleAddProduct(req, res);
    }
    if (req.method === "GET") {
      return await serveStatic(req, res);
    }
    res.writeHead(405);
    res.end("Method not allowed");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[web-server] http://localhost:${PORT} adresinde calisiyor`);
});
