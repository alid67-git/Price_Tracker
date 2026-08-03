// Rekabet/fiyat metrikleri: spread, medyan, gunluk degisim (changes) ve basit trend hesaplama.
// Girdi: Offer[] (bkz. core/offer.js). Bir SKU'nun tek platformdaki teklifleri de,
// tum platformlardaki (pazaryeri+aggregator+standalone) birlesik teklifleri de olabilir --
// bu fonksiyonlar hangi gruplamayla cagrildigini bilmez, sadece verilen listeyi ozetler.

function median(sortedNumbers) {
  const n = sortedNumbers.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2 : sortedNumbers[mid];
}

/**
 * @param {import("./offer.js").Offer[]} offers
 */
export function computeAggregates(offers) {
  if (!offers || offers.length === 0) {
    return {
      seller_count: 0,
      min_price: null,
      max_price: null,
      price_spread: null,
      price_spread_pct: null,
      median_price: null,
    };
  }
  const prices = offers.map((o) => o.price).sort((a, b) => a - b);
  const min_price = prices[0];
  const max_price = prices[prices.length - 1];
  const price_spread = Number((max_price - min_price).toFixed(2));
  const price_spread_pct = min_price > 0 ? Number(((price_spread / min_price) * 100).toFixed(2)) : null;

  return {
    seller_count: offers.length,
    min_price,
    max_price,
    price_spread,
    price_spread_pct,
    median_price: median(prices),
  };
}

/**
 * Bir onceki gunun ve bugunun ayni SKU icin teklif listelerini karsilastirir.
 * Satici kimligi (platform + normalize edilmis seller_name) ile eslestirilir.
 * @param {import("./offer.js").Offer[]} previousOffers
 * @param {import("./offer.js").Offer[]} currentOffers
 * @param {{priceChangeThresholdPct?: number}} [opts]
 */
export function detectChanges(previousOffers, currentOffers, opts = {}) {
  const { priceChangeThresholdPct = 0 } = opts;

  const key = (o) => `${o.platform}::${o.seller_name}`.toLowerCase();
  const prevMap = new Map((previousOffers ?? []).map((o) => [key(o), o]));
  const currMap = new Map((currentOffers ?? []).map((o) => [key(o), o]));

  const newSellers = [];
  const removedSellers = [];
  const priceChanges = [];

  for (const [k, curr] of currMap) {
    const prev = prevMap.get(k);
    if (!prev) {
      newSellers.push(curr);
      continue;
    }
    const pctChange = prev.price > 0 ? ((curr.price - prev.price) / prev.price) * 100 : 0;
    if (Math.abs(pctChange) > priceChangeThresholdPct) {
      priceChanges.push({
        platform: curr.platform,
        seller_name: curr.seller_name,
        old_price: prev.price,
        new_price: curr.price,
        pct_change: Number(pctChange.toFixed(2)),
      });
    }
  }
  for (const [k, prev] of prevMap) {
    if (!currMap.has(k)) removedSellers.push(prev);
  }

  return { newSellers, removedSellers, priceChanges };
}

/** Gunluk min_price serisinden basit yon oku hesaplar. */
export function computeTrend(dailyMinPrices) {
  const values = (dailyMinPrices ?? []).filter((v) => v !== null && v !== undefined);
  if (values.length < 2) return "flat";
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return "flat";
  const changePct = ((last - first) / first) * 100;
  if (changePct > 1) return "up";
  if (changePct < -1) return "down";
  return "flat";
}

export function isHighSpread(spreadPct, thresholdPct = 20) {
  return spreadPct !== null && spreadPct !== undefined && spreadPct > thresholdPct;
}
