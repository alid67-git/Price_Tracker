import * as akakce from "./akakce.js";
import * as cimri from "./cimri.js";
import { throwIfCancelled } from "../../core/search-cancel.js";

// Yeni bir karsilastirma sitesi eklemek icin: search({sku, query}) -> Offer[]
// disa aktaran yeni bir dosya yaz, sonra burada listeye ekle.
export const aggregatorConnectors = [akakce, cimri];

export async function searchAllAggregators({ sku, query, onSource } = {}) {
  const results = [];
  const errors = [];
  for (const connector of aggregatorConnectors) {
    throwIfCancelled();
    onSource?.({
      id: connector.platform,
      name: connector.platform,
      status: "scanning",
    });
    try {
      const offers = await connector.search({ sku, query });
      results.push(...offers);
      onSource?.({
        id: connector.platform,
        name: connector.platform,
        status: offers.length ? "found" : "missing",
        offerCount: offers.length,
        error: offers.length ? null : "teklif yok",
      });
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const message = err.message ?? String(err);
      console.warn(`[${connector.platform}] arama basarisiz: ${message}`);
      errors.push({ platform: connector.platform, message });
      onSource?.({
        id: connector.platform,
        name: connector.platform,
        status: "missing",
        offerCount: 0,
        error: message.split("\n")[0].slice(0, 160),
      });
    }
  }
  return { offers: results, errors };
}
