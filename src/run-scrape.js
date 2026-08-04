import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayDateString } from "./core/offer.js";
import { closeBrowser } from "./core/browser.js";
import { scrapeProduct } from "./core/search-session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "config", "products.json");
const DATA_DIR = path.join(ROOT, "data");

async function loadProducts() {
  const raw = await readFile(PRODUCTS_PATH, "utf-8");
  return JSON.parse(raw);
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
    const { offers } = await scrapeProduct(product);
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
  if (successCount === 0 && products.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[run-scrape] beklenmeyen hata:", err);
  process.exitCode = 1;
});
