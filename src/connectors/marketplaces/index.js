import * as trendyol from "./trendyol.js";
import * as hepsiburada from "./hepsiburada.js";
import * as n11 from "./n11.js";
import * as amazonTr from "./amazonTr.js";
import { randomDelay } from "../../core/browser.js";
import { throwIfCancelled } from "../../core/search-cancel.js";

// Yeni bir pazaryeri eklemek icin: yeni bir dosya yaz (canHandle+fetchOffers+platform
// disa aktarsin), sonra burada listeye ekle. Baska hicbir yer degismez.
export const marketplaceConnectors = [trendyol, hepsiburada, n11, amazonTr];

export function getMarketplaceConnectorForUrl(url) {
  return marketplaceConnectors.find((c) => {
    try {
      return c.canHandle(url);
    } catch {
      return false;
    }
  });
}

/**
 * Serbest metinle tum pazaryerlerinde arar: her sitede ilk urunu bulur,
 * sonra o urunun satici/teklif listesini ceker.
 * @param {{sku: string, query: string, excludePlatforms?: string[]}} opts
 */
export async function searchAllMarketplaces({ sku, query, excludePlatforms = [], onSource } = {}) {
  const offers = [];
  const errors = [];
  const skip = new Set(excludePlatforms.map((p) => String(p).toLowerCase()));

  for (const connector of marketplaceConnectors) {
    throwIfCancelled();
    if (skip.has(connector.platform.toLowerCase())) continue;
    if (typeof connector.searchFirstProductUrl !== "function") continue;

    onSource?.({
      id: connector.platform,
      name: connector.platform,
      status: "scanning",
    });

    try {
      const productUrl = await connector.searchFirstProductUrl(query);
      throwIfCancelled();
      if (!productUrl) {
        console.warn(`[${connector.platform}] "${query}" icin urun bulunamadi`);
        errors.push({ platform: connector.platform, message: "arama sonucu urun bulunamadi" });
        onSource?.({
          id: connector.platform,
          name: connector.platform,
          status: "missing",
          offerCount: 0,
          error: "urun bulunamadi",
        });
        continue;
      }
      console.log(`[${connector.platform}] arama eslesmesi: ${productUrl}`);
      const result = await connector.fetchOffers({ sku, url: productUrl });
      offers.push(...result);
      onSource?.({
        id: connector.platform,
        name: connector.platform,
        url: productUrl,
        status: result.length ? "found" : "missing",
        offerCount: result.length,
        error: result.length ? null : "teklif yok",
      });
    } catch (err) {
      if (err.code === "SEARCH_CANCELLED") throw err;
      const message = err.message ?? String(err);
      console.warn(`[${connector.platform}] arama/cekme basarisiz: ${message}`);
      errors.push({ platform: connector.platform, message });
      onSource?.({
        id: connector.platform,
        name: connector.platform,
        status: "missing",
        offerCount: 0,
        error: message.split("\n")[0].slice(0, 160),
      });
    }
    await randomDelay();
  }

  return { offers, errors };
}
