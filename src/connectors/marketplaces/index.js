import * as trendyol from "./trendyol.js";
import * as hepsiburada from "./hepsiburada.js";
import * as n11 from "./n11.js";
import * as amazonTr from "./amazonTr.js";

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
