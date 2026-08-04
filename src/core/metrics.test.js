import test from "node:test";
import assert from "node:assert/strict";
import { computeAggregates, detectChanges, computeTrend, isHighSpread, detectOutlierPrices, markOutlierOffers } from "./metrics.js";

function offer(overrides) {
  return {
    sku: "TEST-SKU",
    source_type: "marketplace",
    platform: "trendyol",
    seller_name: "Satici A",
    price: 100,
    currency: "TRY",
    stock_status: "in_stock",
    shipping_info: null,
    is_platform_official: false,
    product_url: "https://example.com",
    date: "2026-08-03",
    scraped_at: "2026-08-03T06:00:00.000Z",
    ...overrides,
  };
}

test("computeAggregates: bos liste", () => {
  const result = computeAggregates([]);
  assert.equal(result.seller_count, 0);
  assert.equal(result.min_price, null);
  assert.equal(result.outlier_count, 0);
});

test("computeAggregates: spread ve medyan dogru hesaplanir", () => {
  const offers = [offer({ price: 100 }), offer({ price: 120 }), offer({ price: 150 })];
  const result = computeAggregates(offers);
  assert.equal(result.seller_count, 3);
  assert.equal(result.min_price, 100);
  assert.equal(result.max_price, 150);
  assert.equal(result.price_spread, 50);
  assert.equal(result.price_spread_pct, 50);
  assert.equal(result.median_price, 120);
  assert.equal(result.outlier_count, 0);
});

test("detectOutlierPrices: ekstrem fiyatlar IQR ile isaretlenir", () => {
  const prices = [4859, 5127, 5159, 5370, 5618, 5699, 5720, 6424, 8768, 17297, 27869];
  const outliers = detectOutlierPrices(prices);
  assert.equal(outliers.has(27869), true);
  assert.equal(outliers.has(17297), true);
  assert.equal(outliers.has(4859), false);
  assert.equal(outliers.has(8768), false);
});

test("computeAggregates: outlier haric spread hesaplanir", () => {
  const prices = [4859, 5127, 5159, 5370, 5618, 5699, 5720, 6424, 8768, 17297, 27869];
  const offers = prices.map((price, i) => offer({ price, seller_name: `S${i}` }));
  const cleaned = computeAggregates(offers);
  assert.equal(cleaned.outlier_count, 2);
  assert.equal(cleaned.seller_count, 11);
  assert.equal(cleaned.min_price, 4859);
  assert.equal(cleaned.max_price, 8768);
  assert.ok(cleaned.price_spread_pct < 100);

  const raw = computeAggregates(offers, { excludeOutliers: false });
  assert.equal(raw.max_price, 27869);
  assert.ok(raw.price_spread_pct > 400);
});

test("markOutlierOffers: is_outlier bayragi set edilir", () => {
  const offers = [5000, 5100, 5200, 5300, 5400, 25000].map((price, i) => offer({ price, seller_name: `S${i}` }));
  const marked = markOutlierOffers(offers);
  assert.equal(marked.filter((o) => o.is_outlier).length >= 1, true);
  assert.equal(marked.find((o) => o.price === 25000).is_outlier, true);
});

test("detectChanges: yeni satici tespit edilir", () => {
  const prev = [offer({ seller_name: "Satici A", price: 100 })];
  const curr = [offer({ seller_name: "Satici A", price: 100 }), offer({ seller_name: "Satici B", price: 110 })];
  const { newSellers, removedSellers, priceChanges } = detectChanges(prev, curr);
  assert.equal(newSellers.length, 1);
  assert.equal(newSellers[0].seller_name, "Satici B");
  assert.equal(removedSellers.length, 0);
  assert.equal(priceChanges.length, 0);
});

test("detectChanges: satici cikisi ve fiyat degisimi tespit edilir", () => {
  const prev = [offer({ seller_name: "Satici A", price: 100 }), offer({ seller_name: "Satici B", price: 110 })];
  const curr = [offer({ seller_name: "Satici A", price: 130 })];
  const { newSellers, removedSellers, priceChanges } = detectChanges(prev, curr);
  assert.equal(newSellers.length, 0);
  assert.equal(removedSellers.length, 1);
  assert.equal(removedSellers[0].seller_name, "Satici B");
  assert.equal(priceChanges.length, 1);
  assert.equal(priceChanges[0].old_price, 100);
  assert.equal(priceChanges[0].new_price, 130);
});

test("computeTrend: yon dogru belirlenir", () => {
  assert.equal(computeTrend([100, 90]), "down");
  assert.equal(computeTrend([100, 110]), "up");
  assert.equal(computeTrend([100, 100.5]), "flat");
  assert.equal(computeTrend([100]), "flat");
});

test("isHighSpread: esik kontrolu", () => {
  assert.equal(isHighSpread(25), true);
  assert.equal(isHighSpread(15), false);
  assert.equal(isHighSpread(null), false);
});
