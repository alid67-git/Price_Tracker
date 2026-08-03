import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = path.resolve(__dirname, "..", "config", "products.json");

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const products = JSON.parse(await readFile(PRODUCTS_PATH, "utf-8"));

    const sku = (await rl.question("SKU (benzersiz kisa kod, ornek CUDY-WR300): ")).trim();
    if (!sku) throw new Error("SKU bos olamaz");
    if (products.some((p) => p.sku === sku)) throw new Error(`"${sku}" zaten mevcut`);

    const name = (await rl.question("Urun adi: ")).trim();
    const marketplaces = {};
    for (const platform of ["trendyol", "hepsiburada", "n11", "amazon_tr"]) {
      const url = (await rl.question(`${platform} urun URL'si (yoksa bos birak): `)).trim();
      if (url) marketplaces[platform] = url;
    }
    const aggregatorQuery = (await rl.question("Akakce/Cimri arama terimi (yoksa bos birak): ")).trim();

    const standalone = [];
    let addMore = (await rl.question("Bagimsiz/tekil bir satici sitesi eklemek ister misin? (e/h): ")).trim().toLowerCase();
    while (addMore === "e") {
      const url = (await rl.question("  Site URL'si: ")).trim();
      const platform = (await rl.question("  Platform adi (bos birakilirsa domain kullanilir): ")).trim();
      if (url) standalone.push(platform ? { url, platform } : { url });
      addMore = (await rl.question("Baska bir tane eklemek ister misin? (e/h): ")).trim().toLowerCase();
    }

    products.push({ sku, name: name || sku, marketplaces, aggregatorQuery: aggregatorQuery || undefined, standalone });
    await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2), "utf-8");
    console.log(`\n"${sku}" config/products.json'a eklendi.`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("Hata:", err.message);
  process.exitCode = 1;
});
