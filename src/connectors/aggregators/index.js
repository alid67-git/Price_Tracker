import * as akakce from "./akakce.js";
import * as cimri from "./cimri.js";
import { throwIfCancelled } from "../../core/search-cancel.js";

// Yeni bir karsilastirma sitesi eklemek icin: search({sku, query}) -> Offer[]
// disa aktaran yeni bir dosya yaz, sonra burada listeye ekle.
export const aggregatorConnectors = [akakce, cimri];

export async function searchAllAggregators({ sku, query }) {
  const results = [];
  const errors = [];
  for (const connector of aggregatorConnectors) {
    throwIfCancelled();
    try {
      const offers = await connector.search({ sku, query });
      results.push(...offers);
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const message = err.message ?? String(err);
      console.warn(`[${connector.platform}] arama basarisiz: ${message}`);
      errors.push({ platform: connector.platform, message });
    }
  }
  return { offers: results, errors };
}
