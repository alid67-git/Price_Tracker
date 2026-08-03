import * as akakce from "./akakce.js";
import * as cimri from "./cimri.js";

// Yeni bir karsilastirma sitesi eklemek icin: search({sku, query}) -> Offer[]
// disa aktaran yeni bir dosya yaz, sonra burada listeye ekle.
export const aggregatorConnectors = [akakce, cimri];

export async function searchAllAggregators({ sku, query }) {
  const results = [];
  for (const connector of aggregatorConnectors) {
    try {
      const offers = await connector.search({ sku, query });
      results.push(...offers);
    } catch (err) {
      console.warn(`[${connector.platform}] arama basarisiz: ${err.message}`);
    }
  }
  return results;
}
