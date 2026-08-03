import test from "node:test";
import assert from "node:assert/strict";
import { parseTurkishPrice } from "./utils.js";

test("parseTurkishPrice: binlik ayirici ve virgul", () => {
  assert.equal(parseTurkishPrice("1.234,56 TL"), 1234.56);
  assert.equal(parseTurkishPrice("8.768,03 TL"), 8768.03);
  assert.equal(parseTurkishPrice("634,80 TL"), 634.8);
});

test("parseTurkishPrice: tam sayi", () => {
  assert.equal(parseTurkishPrice("690 TL"), 690);
});

test("parseTurkishPrice: gecersiz girdi null doner", () => {
  assert.equal(parseTurkishPrice(""), null);
  assert.equal(parseTurkishPrice(null), null);
  assert.equal(parseTurkishPrice("Stokta Yok"), null);
});
