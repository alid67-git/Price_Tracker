import test from "node:test";
import assert from "node:assert/strict";
import { computeAggregates, detectChanges, computeTrend, isHighSpread } from "./metrics.js";

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
